"""테스트 전용 DB(smartbin_test)를 사용한다. 실행 전 scripts/infra-up.sh 로 PostgreSQL이 떠 있어야 한다."""
import os

os.environ["POSTGRES_DB"] = "smartbin_test"
os.environ["DB_NULL_POOL"] = "true"
os.environ["MQTT_ENABLED"] = "false"
os.environ["AI_API_TOKEN"] = "test-ai-token"
os.environ["HARDWARE_MODE"] = "SIMULATOR"  # 루트 .env(EDGE_SERIAL)와 무관하게 기존 시험은 시뮬레이터 기준
os.environ["EDGE_SENSOR_BIN_ID"] = ""
os.environ["DISCOVERY_ENABLED"] = "false"

import asyncio  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

import asyncpg  # noqa: E402
import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.database.seed import seed  # noqa: E402
from app.database.session import SessionLocal  # noqa: E402
from app.hardware.base import BaseHardwareAdapter  # noqa: E402
from app.hardware.interfaces import HardwareMode, HardwareUnavailable  # noqa: E402
from app.main import app  # noqa: E402
from app.websocket.manager import ws_manager  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


async def _ensure_test_db() -> None:
    conn = await asyncpg.connect(
        user=settings.postgres_user,
        password=settings.postgres_password,
        host=settings.postgres_host,
        port=settings.postgres_port,
        database="postgres",
    )
    try:
        exists = await conn.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", settings.postgres_db)
        if not exists:
            await conn.execute(f'CREATE DATABASE "{settings.postgres_db}"')
    finally:
        await conn.close()


def pytest_sessionstart(session):
    asyncio.run(_ensure_test_db())
    # 실제 Alembic 마이그레이션으로 스키마 생성 (마이그레이션 자체도 검증)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, check=True, env=os.environ.copy())


class FakeHardware(BaseHardwareAdapter):
    """HAL 테스트 더블: 전송된 명령을 (topic, payload)로 기록한다."""

    def __init__(self):
        super().__init__(HardwareMode.SIMULATOR)
        self.messages: list[tuple[str, dict]] = []
        self.fail = False
        self.connected = True

    async def execute_servo_command(self, message) -> None:
        if self.fail:
            raise HardwareUnavailable("broker down")
        self.messages.append((f"smartbin/{message.device_id}/command", message.model_dump(mode="json")))

    async def start(self): ...
    async def disconnect(self): ...
    async def reconnect(self): ...


class EventRecorder:
    def __init__(self):
        self.events: list[tuple[str, object]] = []

    def types(self) -> list[str]:
        return [t for t, _ in self.events]


@pytest.fixture(autouse=True)
async def clean_db():
    async with SessionLocal() as s:
        await s.execute(
            text("TRUNCATE sensor_logs, edge_telemetry, detection_logs, maintenance_logs, device_commands, bins, devices RESTART IDENTITY CASCADE")
        )
        await s.commit()
        await seed(s)
    yield


@pytest.fixture
def publisher() -> FakeHardware:
    hw = FakeHardware()
    app.state.hardware = hw
    return hw


@pytest.fixture
def events(monkeypatch) -> EventRecorder:
    rec = EventRecorder()

    async def fake_broadcast(event_type, data):
        rec.events.append((event_type, data))

    monkeypatch.setattr(ws_manager, "broadcast", fake_broadcast)
    return rec


@pytest.fixture
async def client(publisher, events):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {settings.api_control_token}"}


@pytest.fixture
async def session():
    async with SessionLocal() as s:
        yield s
