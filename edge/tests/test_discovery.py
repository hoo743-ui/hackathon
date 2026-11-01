"""서버 자동 탐색: 서버 신호(UDP)를 받으면 http://<보낸IP>:<api_port> 를 알아낸다."""
import json
import socket
import time

from smartrecycle_edge.discovery import Discovery


def test_discovery_receives_beacon():
    d = Discovery(port=50599)
    d.start()
    time.sleep(0.3)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for msg in (b"garbage", json.dumps({"service": "other"}).encode(),
                json.dumps({"service": "smart-recycle", "api_port": 8000}).encode()):
        s.sendto(msg, ("127.0.0.1", 50599))
    s.close()
    end = time.time() + 3
    while time.time() < end and not d.fresh_url():
        time.sleep(0.05)
    assert d.fresh_url() == "http://127.0.0.1:8000"
    assert d.fresh_url(max_age=-1) is None  # 오래된 신호는 쓰지 않음
    d.stop()
