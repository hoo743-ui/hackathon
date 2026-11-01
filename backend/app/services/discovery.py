"""서버 자동 탐색 신호 (UDP 브로드캐스트).

맥북 IP 는 Wi-Fi·핫스팟을 바꿀 때마다 달라진다. 서버가 같은 네트워크에 2초마다
{"service": "smart-recycle", "api_port": 8000} 을 방송하면, 카메라 컴퓨터는 받은 패킷의 '보낸 주소'로
서버를 찾아 자동으로 접속 주소를 바꾼다 (edge/smartrecycle_edge/discovery.py).
같은 서브넷 안에서만 동작한다 (라우터를 넘지 않음). 기기 간 통신을 막는 Wi-Fi 에서는 어차피 접속 불가.
"""
import asyncio
import json
import logging
import socket

from app.core.config import settings

logger = logging.getLogger(__name__)


def current_ip() -> str | None:
    """기본 경로로 나가는 인터페이스의 IP (패킷을 실제로 보내지 않음)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


async def beacon_loop() -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.setblocking(False)
    last_ip = None
    logger.info("discovery beacon: UDP %d 방송 시작", settings.discovery_port)
    try:
        while True:
            ip = current_ip()
            if ip != last_ip:
                logger.info("discovery: 현재 서버 IP %s → 카메라 컴퓨터는 http://%s:%d 로 자동 접속", ip, ip, settings.api_port)
                last_ip = ip
            payload = json.dumps({"service": "smart-recycle", "api_port": settings.api_port, "ip": ip}).encode()
            for target in ("255.255.255.255", _subnet_broadcast(ip)):
                if target:
                    try:
                        sock.sendto(payload, (target, settings.discovery_port))
                    except OSError:
                        pass  # 네트워크 전환 중 — 다음 주기에 재시도
            await asyncio.sleep(settings.discovery_interval_sec)
    finally:
        sock.close()


def _subnet_broadcast(ip: str | None) -> str | None:
    # 마스크를 모르므로 /24 가정 (핫스팟·가정용 공유기 대부분). 255.255.255.255 와 함께 보낸다.
    if not ip:
        return None
    a, b, c, _ = ip.split(".")
    return f"{a}.{b}.{c}.255"
