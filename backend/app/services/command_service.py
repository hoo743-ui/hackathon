"""제어 명령 생명주기: 검증 → PENDING → (MQTT 발행) SENT → ACK(SUCCEEDED/FAILED) 또는 TIMEOUT."""
import logging
import uuid
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.enums import (
    IN_FLIGHT_STATUSES,
    CommandOrigin,
    CommandStatus,
    CommandType,
    DetectionOutcome,
    ConnectionStatus,
    OperatingMode,
    WasteType,
)
from app.core.errors import APIError
from app.core.time import utcnow
from app.hardware.interfaces import HardwareAdapter
from app.models import Bin, DetectionLog, Device, DeviceCommand
from app.schemas.api import CommandCreate
from app.schemas.mqtt import AckPayload, CommandMessage
from app.services.serializers import broadcast_detection, command_out, device_out_with_busy
from app.websocket.manager import ws_manager

logger = logging.getLogger(__name__)

# 긴급정지 상태에서도 허용되는 명령
ESTOP_ALLOWED = {CommandType.EMERGENCY_STOP, CommandType.RESET_ESTOP, CommandType.GET_STATUS}


def validate_target(command: CommandType, target: str | None) -> str | None:
    if command == CommandType.OPEN_BIN:
        allowed = {w.value for w in WasteType}
    elif command == CommandType.SET_MODE:
        allowed = {m.value for m in OperatingMode}
    else:
        if target is not None:
            raise APIError(422, "INVALID_TARGET", f"{command} does not take a target")
        return None
    if target not in allowed:
        raise APIError(422, "INVALID_TARGET", f"target must be one of {', '.join(sorted(allowed))}")
    return target


async def _broadcast_command(cmd: DeviceCommand) -> None:
    await ws_manager.broadcast("command.updated", command_out(cmd).model_dump(mode="json"))


async def sync_detection_outcome(session: AsyncSession, cmd: DeviceCommand) -> None:
    """자동 분류 명령이 최종 상태가 되면 연결된 분류 기록의 처리 결과를 갱신한다 (커밋은 호출자)."""
    if cmd.origin != CommandOrigin.AUTO or cmd.status in IN_FLIGHT_STATUSES:
        return
    det = await session.scalar(select(DetectionLog).where(DetectionLog.command_id == cmd.command_id))
    if det is None:
        return
    if cmd.status == CommandStatus.SUCCEEDED:
        det.outcome, det.outcome_detail = DetectionOutcome.SORTED, cmd.result_message
    else:
        det.outcome, det.outcome_detail = DetectionOutcome.SORT_FAILED, (cmd.error_message or cmd.status)[:64]
    return det


async def _resolve_bin(session: AsyncSession, device_id: str, req: CommandCreate, target: str | None) -> tuple[str | None, str | None]:
    """OPEN_BIN의 대상 칸을 (target, bin_id)로 확정한다. bin_id만 주면 target을 채우고, 둘 다 주면 일치해야 한다."""
    if req.command != CommandType.OPEN_BIN:
        if req.bin_id is not None:
            raise APIError(422, "INVALID_TARGET", f"{req.command} does not take a bin_id")
        return target, None
    if req.bin_id is not None:
        b = await session.scalar(select(Bin).where(Bin.bin_id == req.bin_id, Bin.device_id == device_id))
        if b is None:
            raise APIError(422, "INVALID_TARGET", f"bin {req.bin_id} does not belong to {device_id}")
        if target is not None and target != b.waste_type:
            raise APIError(422, "INVALID_TARGET", "bin_id and target refer to different bins")
        return b.waste_type, b.bin_id
    b = await session.scalar(select(Bin).where(Bin.device_id == device_id, Bin.waste_type == target))
    if b is None:
        raise APIError(422, "INVALID_TARGET", f"{device_id} has no {target} bin")
    return target, b.bin_id


async def create_command(
    session: AsyncSession,
    hardware: HardwareAdapter,
    device_id: str,
    req: CommandCreate,
    requested_by: str,
    origin: CommandOrigin = CommandOrigin.MANUAL,
) -> tuple[DeviceCommand, bool]:
    """반환: (명령, 새로 생성 여부). 같은 command_id 재요청이면 기존 명령을 반환한다."""
    if req.command_id is not None:
        existing = await session.scalar(select(DeviceCommand).where(DeviceCommand.command_id == req.command_id))
        if existing is not None:
            if existing.device_id != device_id:
                raise APIError(409, "COMMAND_ID_CONFLICT", "command_id already used for another device")
            return existing, False

    # 장치 행 잠금으로 동시 요청을 직렬화 → 진행 중 명령 검사가 경쟁 상태 없이 동작
    device = await session.scalar(select(Device).where(Device.device_id == device_id).with_for_update())
    if device is None:
        raise APIError(404, "DEVICE_NOT_FOUND", f"device {device_id} not found")

    if req.command == CommandType.OPEN_BIN and req.target is None and req.bin_id is not None:
        target = None  # bin_id로 대상 지정
    else:
        target = validate_target(req.command, req.target)
    target, bin_id = await _resolve_bin(session, device_id, req, target)

    # 서버의 online 판정은 추정값이므로 긴급정지는 offline이어도 최선 노력으로 발행한다.
    if device.connection_status != ConnectionStatus.ONLINE and req.command != CommandType.EMERGENCY_STOP:
        raise APIError(409, "DEVICE_OFFLINE", "device is not connected")

    if req.command != CommandType.EMERGENCY_STOP:
        if device.estop_active and req.command not in ESTOP_ALLOWED:
            raise APIError(409, "ESTOP_ACTIVE", "emergency stop is active; send RESET_ESTOP first")
        in_flight = await session.scalar(
            select(func.count())
            .select_from(DeviceCommand)
            .where(DeviceCommand.device_id == device_id, DeviceCommand.status.in_(IN_FLIGHT_STATUSES))
        )
        if in_flight:
            raise APIError(409, "DEVICE_BUSY", "another command is in progress")
        # 자동 모드: AI 분류에 따른 동작만 허용 / 수동 모드: 관리자 조작만 허용
        if req.command == CommandType.OPEN_BIN:
            expected = CommandOrigin.AUTO if device.operating_mode == OperatingMode.AUTO else CommandOrigin.MANUAL
            if origin != expected:
                raise APIError(
                    409, "MODE_CONFLICT",
                    f"{origin} OPEN_BIN is not allowed in {device.operating_mode} mode",
                )

    now = utcnow()
    cmd = DeviceCommand(
        command_id=req.command_id or uuid.uuid4(),
        device_id=device_id,
        command=req.command,
        target=target,
        bin_id=bin_id,
        origin=origin,
        status=CommandStatus.PENDING,
        requested_by=requested_by,
        requested_at=now,
        expires_at=now + timedelta(seconds=settings.command_expires_sec),
    )
    session.add(cmd)
    try:
        await session.commit()
    except IntegrityError:
        # 같은 command_id 동시 요청: 먼저 저장된 명령을 반환 (멱등)
        await session.rollback()
        existing = await session.scalar(select(DeviceCommand).where(DeviceCommand.command_id == req.command_id))
        if existing is None or existing.device_id != device_id:
            raise APIError(409, "COMMAND_ID_CONFLICT", "command_id already used")
        return existing, False

    message = CommandMessage(
        command_id=cmd.command_id,
        device_id=device_id,
        command=req.command,
        target=target,
        bin_id=bin_id,
        origin=origin,
        requested_at=cmd.requested_at,
        expires_at=cmd.expires_at,
    )
    try:
        await hardware.execute_servo_command(message)
    except Exception as exc:
        logger.error("failed to publish command %s: %s", cmd.command_id, exc)
        cmd.status = CommandStatus.FAILED
        cmd.error_message = "MQTT_PUBLISH_FAILED"
        detection = await sync_detection_outcome(session, cmd)
        await session.commit()
        if detection is not None:
            await broadcast_detection(detection)
        await _broadcast_command(cmd)
        raise APIError(503, "MQTT_UNAVAILABLE", "could not deliver command to broker") from exc

    # ACK가 먼저 도착했을 수 있으므로 PENDING일 때만 SENT로 전이
    await session.execute(
        update(DeviceCommand)
        .where(DeviceCommand.id == cmd.id, DeviceCommand.status == CommandStatus.PENDING)
        .values(status=CommandStatus.SENT)
    )
    await session.commit()
    await session.refresh(cmd)
    await _broadcast_command(cmd)
    return cmd, True


async def handle_ack(session: AsyncSession, ack: AckPayload) -> None:
    cmd = await session.scalar(
        select(DeviceCommand).where(DeviceCommand.command_id == ack.command_id).with_for_update()
    )
    if cmd is None or cmd.device_id != ack.device_id:
        logger.warning("ack for unknown command %s from %s", ack.command_id, ack.device_id)
        return
    if cmd.status not in IN_FLIGHT_STATUSES:
        if cmd.status == CommandStatus.TIMEOUT and not (cmd.error_message or "").startswith("LATE_ACK"):
            # 상태는 TIMEOUT 유지, 장치가 늦게라도 실행했음을 기록 (운영자 확인용)
            cmd.error_message = f"LATE_ACK:{ack.message}"
            await session.commit()
            await _broadcast_command(cmd)
        logger.warning("late/duplicate ack for command %s in final state %s", cmd.command_id, cmd.status)
        return

    cmd.status = CommandStatus.SUCCEEDED if ack.success else CommandStatus.FAILED
    cmd.executed_at = ack.completed_at or utcnow()
    cmd.result_message = ack.message
    cmd.error_message = None if ack.success else ack.error_code

    detection = await sync_detection_outcome(session, cmd)
    device = await session.scalar(select(Device).where(Device.device_id == cmd.device_id))
    device_changed = False
    if ack.success and device is not None:
        if cmd.command == CommandType.SET_MODE:
            device.operating_mode = cmd.target
            device_changed = True
        elif cmd.command == CommandType.EMERGENCY_STOP:
            device.estop_active = True
            device_changed = True
        elif cmd.command == CommandType.RESET_ESTOP:
            device.estop_active = False
            device_changed = True
    await session.commit()

    await _broadcast_command(cmd)
    if detection is not None:
        await broadcast_detection(detection)
    if device is not None:
        # busy 상태가 바뀌었으므로 항상 장치 상태도 전파
        await ws_manager.broadcast("device.status", (await device_out_with_busy(session, device)).model_dump(mode="json"))
    if device_changed:
        logger.info("device %s state updated by %s", cmd.device_id, cmd.command)


async def expire_timed_out_commands(session: AsyncSession) -> list[DeviceCommand]:
    cutoff = utcnow() - timedelta(seconds=settings.command_ack_timeout_sec)
    result = await session.scalars(
        update(DeviceCommand)
        .where(DeviceCommand.status.in_(IN_FLIGHT_STATUSES), DeviceCommand.requested_at < cutoff)
        .values(status=CommandStatus.TIMEOUT, error_message="ACK_TIMEOUT")
        .returning(DeviceCommand)
    )
    expired = list(result)
    detections = [d for cmd in expired if (d := await sync_detection_outcome(session, cmd)) is not None]
    await session.commit()
    for cmd in expired:
        logger.warning("command %s timed out", cmd.command_id)
        await _broadcast_command(cmd)
    for d in detections:
        await broadcast_detection(d)
    return expired


async def get_command(session: AsyncSession, device_id: str, command_id: uuid.UUID) -> DeviceCommand:
    cmd = await session.scalar(
        select(DeviceCommand).where(DeviceCommand.command_id == command_id, DeviceCommand.device_id == device_id)
    )
    if cmd is None:
        raise APIError(404, "COMMAND_NOT_FOUND", "command not found")
    return cmd


async def recent_commands(session: AsyncSession, limit: int = 10, device_id: str | None = None) -> list[DeviceCommand]:
    stmt = select(DeviceCommand).order_by(DeviceCommand.requested_at.desc()).limit(limit)
    if device_id:
        stmt = stmt.where(DeviceCommand.device_id == device_id)
    return list(await session.scalars(stmt))
