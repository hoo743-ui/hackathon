import asyncio
import contextlib
import logging
from typing import Any

from fastapi import WebSocket

from app.core.time import utcnow

logger = logging.getLogger(__name__)


class ConnectionManager:
    """프로세스 내 WebSocket 브로드캐스트 (단일 워커 전제, ARCHITECTURE D8)."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    @property
    def count(self) -> int:
        return len(self._connections)

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._connections.discard(ws)

    async def broadcast(self, event_type: str, data: Any) -> None:
        message = {"type": event_type, "event": event_type, "data": data, "sent_at": utcnow().isoformat()}
        for ws in list(self._connections):
            try:
                await asyncio.wait_for(ws.send_json(message), timeout=2)
            except Exception:
                # 닫아야 클라이언트가 onclose → 재연결 → REST 재동기화를 수행한다
                logger.info("dropping websocket client after send failure")
                self.disconnect(ws)
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(ws.close(code=1011), timeout=1)


ws_manager = ConnectionManager()
