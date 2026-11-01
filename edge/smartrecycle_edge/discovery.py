"""맥북 서버 자동 탐색 — 서버가 방송하는 UDP 신호를 듣고 현재 서버 주소를 알아낸다.

서버(backend/app/services/discovery.py)가 2초마다 {"service":"smart-recycle","api_port":8000} 를 방송한다.
'보낸 주소(IP)' + api_port 로 http://IP:8000 을 만든다 → 맥북 IP 가 바뀌어도 설정을 고칠 필요가 없다.
Windows 첫 실행 시 방화벽 허용 창이 뜨면 '허용'을 눌러야 신호를 받을 수 있다.
"""
from __future__ import annotations

import json
import logging
import socket
import threading
import time

log = logging.getLogger("edge.discovery")


class Discovery(threading.Thread):
    def __init__(self, port: int = 50505):
        super().__init__(name="discovery", daemon=True)
        self.port = port
        self.latest_url: str | None = None
        self.latest_at = 0.0
        self.error: str | None = None
        self._stop = threading.Event()

    def run(self) -> None:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("", self.port))
            sock.settimeout(1.0)
        except OSError as exc:
            self.error = f"UDP {self.port} 수신 불가: {exc}"
            log.warning("서버 자동 탐색 비활성: %s", self.error)
            return
        log.info("서버 자동 탐색 대기 (UDP %d)", self.port)
        while not self._stop.is_set():
            try:
                data, (ip, _) = sock.recvfrom(1024)
            except socket.timeout:
                continue
            except OSError:
                time.sleep(1)
                continue
            try:
                msg = json.loads(data.decode())
            except (ValueError, UnicodeDecodeError):
                continue
            if msg.get("service") != "smart-recycle":
                continue
            url = f"http://{ip}:{int(msg.get('api_port', 8000))}"
            if url != self.latest_url:
                log.info("서버 신호 수신: %s", url)
            self.latest_url, self.latest_at = url, time.monotonic()
        sock.close()

    def fresh_url(self, max_age: float = 10.0) -> str | None:
        if self.latest_url and time.monotonic() - self.latest_at <= max_age:
            return self.latest_url
        return None

    def stop(self) -> None:
        self._stop.set()
