from fastapi.testclient import TestClient

from app.main import app
from app.websocket.manager import ConnectionManager


def test_ws_handshake_and_ping():
    client = TestClient(app)  # lifespan 미실행 → MQTT 미접속
    with client.websocket_connect("/ws/dashboard") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "connected"
        ws.send_text("ping")
        assert ws.receive_text() == "pong"


class FakeWS:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    async def accept(self):
        pass

    async def send_json(self, msg):
        if self.fail:
            raise RuntimeError("closed")
        self.sent.append(msg)


async def test_broadcast_delivers_and_drops_dead_clients():
    mgr = ConnectionManager()
    good, dead = FakeWS(), FakeWS(fail=True)
    await mgr.connect(good)
    await mgr.connect(dead)
    await mgr.broadcast("bins.updated", [{"bin_id": "BIN_001"}])
    assert good.sent[0]["type"] == "bins.updated" and good.sent[0]["data"] == [{"bin_id": "BIN_001"}]
    assert mgr.count == 1
