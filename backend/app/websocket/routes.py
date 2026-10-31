from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.time import utcnow
from app.websocket.manager import ws_manager

router = APIRouter()


@router.websocket("/ws")
@router.websocket("/ws/dashboard")
async def dashboard_ws(ws: WebSocket) -> None:
    await ws_manager.connect(ws)
    try:
        await ws.send_json(
            {"type": "connected", "event": "connected", "data": {"clients": ws_manager.count}, "sent_at": utcnow().isoformat()}
        )
        while True:
            # 서버→클라이언트 단방향. 클라이언트의 'ping'에만 응답한다.
            if await ws.receive_text() == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws)
