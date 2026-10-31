"""[SIM] 통합 검증. 실행 중인 백엔드(scripts/backend.sh)와 인프라가 필요하다.

시뮬레이터를 하위 프로세스로 띄워 MQTT → FastAPI → PostgreSQL → REST/WebSocket → 명령/ACK 경로를 검사한다.
주의: BIN 보정값을 시뮬레이터 값(40/5cm)으로 덮어쓴다. 실제 하드웨어 보정 후에는 실행하지 말 것.
"""
import asyncio
import json
import os
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

import httpx
import websockets

ROOT = Path(__file__).resolve().parents[1]
SIM = [sys.executable, str(ROOT / "scripts/simulator/simulator.py")]
env = {}
for line in (ROOT / ".env").read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
API = os.environ.get("E2E_API", f"http://localhost:{env.get('API_PORT', '8000')}")
WS = API.replace("http", "ws", 1) + "/ws/dashboard"
AUTH = {"Authorization": f"Bearer {env['API_CONTROL_TOKEN']}"}
AI = {"Authorization": f"Bearer {env['AI_API_TOKEN']}"}
CMD_URL = f"{API}/api/devices/DEVICE_001/commands"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'✅' if ok else '❌'} {name} {detail}")


def wait_for(fn, timeout=15.0, interval=0.5):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(interval)
    return last


def start_sim(*args) -> subprocess.Popen:
    return subprocess.Popen(SIM + ["--interval", "1", "--force", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop(p: subprocess.Popen, sig=signal.SIGINT) -> None:
    if p.poll() is None:
        p.send_signal(sig)
        try:
            p.wait(5)
        except subprocess.TimeoutExpired:
            p.kill()


def command(c: httpx.Client, body: dict) -> httpx.Response:
    return c.post(CMD_URL, json={**body, "command_id": str(uuid.uuid4())}, headers=AUTH)


def wait_status(c: httpx.Client, cid: str, timeout=15.0) -> str:
    def final():
        s = c.get(f"{CMD_URL}/{cid}").json()["status"]
        return s if s in ("SUCCEEDED", "FAILED", "TIMEOUT") else None
    return wait_for(final, timeout) or "PENDING"


async def ws_receive(event_type: str, timeout=10.0) -> dict | None:
    async with websockets.connect(WS) as ws:
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout))
            if msg["type"] == event_type:
                return msg
    return None


def main() -> int:
    c = httpx.Client(timeout=10)
    h = c.get(f"{API}/health").json()
    check("health: DB + MQTT 연결", h["database"] and h["mqtt"], str(h))
    if not h["mqtt"]:
        return 1
    if h.get("hardware_mode") != "SIMULATOR" or h.get("simulator_running"):
        print("❌ e2e는 HARDWARE_MODE=SIMULATOR, SIMULATOR_AUTOSTART=false 백엔드가 필요합니다:\n"
              "   SIMULATOR_AUTOSTART=false scripts/backend.sh")
        return 1

    sim = start_sim("--scenario", "normal", "--calibrate", "--seed", "1")
    try:
        online = wait_for(lambda: c.get(f"{API}/api/devices/DEVICE_001").json()["connection_status"] == "online")
        check("시뮬레이터 접속 → 장치 online", bool(online))
        bins = wait_for(lambda: (b := c.get(f"{API}/api/bins").json()) and all(x["current_fill_percent"] is not None for x in b) and b)
        check("4개 bin 적재율 계산·저장", bool(bins) and len(bins) == 4,
              str({b["bin_id"]: b["current_fill_percent"] for b in bins or []}))
        dev = c.get(f"{API}/api/devices/DEVICE_001").json()
        check("데이터 출처 simulator 표시", dev["data_source"] == "simulator")
        hist = c.get(f"{API}/api/bins/BIN_001/history?limit=5").json()["items"]
        check("sensor_logs 이력 저장", len(hist) >= 1 and hist[-1]["source"] == "simulator", f"{len(hist)} rows")

        msg = asyncio.run(ws_receive("bins.updated"))
        check("WebSocket bins.updated 수신", bool(msg) and len(msg["data"]) == 4)

        r = command(c, {"command": "SET_MODE", "target": "MANUAL"})
        check("SET_MODE MANUAL → ACK", r.status_code == 202 and wait_status(c, r.json()["command_id"]) == "SUCCEEDED")
        r = command(c, {"command": "OPEN_BIN", "target": "plastic"})
        sent = r.json().get("status")
        check("OPEN_BIN 접수 시 상태 SENT(ACK 전)", r.status_code == 202 and sent == "SENT", sent or r.text)
        busy = command(c, {"command": "OPEN_BIN", "target": "metal"})
        check("동작 중 중복 명령 차단", busy.status_code == 409 and busy.json()["error"]["code"] == "DEVICE_BUSY")
        check("OPEN_BIN → 시뮬레이터 ACK SUCCEEDED", wait_status(c, r.json()["command_id"]) == "SUCCEEDED")

        r = command(c, {"command": "EMERGENCY_STOP"})
        check("긴급정지 ACK", wait_status(c, r.json()["command_id"]) == "SUCCEEDED")
        r = command(c, {"command": "OPEN_BIN", "target": "plastic"})
        check("긴급정지 중 OPEN_BIN 거부", r.status_code == 409 and r.json()["error"]["code"] == "ESTOP_ACTIVE")
        r = command(c, {"command": "RESET_ESTOP"})
        check("긴급정지 해제", wait_status(c, r.json()["command_id"]) == "SUCCEEDED")
        r = command(c, {"command": "OPEN_BIN", "target": "glass"})
        check("잘못된 target 차단", r.status_code == 422)
        cid = str(uuid.uuid4())
        r1 = c.post(CMD_URL, json={"command": "GET_STATUS", "command_id": cid}, headers=AUTH)
        r2 = c.post(CMD_URL, json={"command": "GET_STATUS", "command_id": cid}, headers=AUTH)
        check("같은 command_id 재요청 → 중복 생성 없음(200)", r1.status_code == 202 and r2.status_code == 200
              and r2.json()["command_id"] == cid)
        wait_status(c, cid)
        r = c.post(f"{API}/api/commands", json={"device_id": "DEVICE_001", "command": "OPEN_BIN", "bin_id": "BIN_002",
                                                "command_id": str(uuid.uuid4())}, headers=AUTH)
        ok = r.status_code == 202 and r.json()["target"] == "metal"
        final = wait_status(c, r.json()["command_id"]) if ok else "-"
        check("POST /api/commands (bin_id 지정) → v1.1 ACK SUCCEEDED", ok and final == "SUCCEEDED", final)

        # --- AI 분류 → 자동 배출 → ACK → 처리 결과 ---
        def detect(**body):
            return c.post(f"{API}/api/detections", json={"source": "simulator", "model": "e2e", **body}, headers=AI).json()

        d = detect(waste_type="metal", confidence=0.9)
        check("수동 모드 AI 분류 → 기록만 (모터 동작 없음)", d["outcome"] == "MANUAL_MODE" and d["command_id"] is None)
        r = command(c, {"command": "SET_MODE", "target": "AUTO"})
        check("자동 모드 전환 ACK", wait_status(c, r.json()["command_id"]) == "SUCCEEDED")
        d = detect(waste_type="paper", confidence=0.88)
        sorted_ = wait_for(lambda: (x := c.get(f"{API}/api/detections?limit=1").json()["items"][0])["outcome"] == "SORTED" and x)
        check("자동 모드 AI 분류 → 배출(origin=auto) → ACK → SORTED", bool(sorted_) and sorted_["id"] == d["id"],
              sorted_ and sorted_["outcome_detail"])
        r = command(c, {"command": "OPEN_BIN", "target": "metal"})
        check("자동 모드에서 관리자 수동 배출 거부", r.status_code == 409 and r.json()["error"]["code"] == "MODE_CONFLICT")
        d = detect(waste_type="plastic", confidence=0.3)
        check("낮은 신뢰도 → 동작 안 함", d["outcome"] == "LOW_CONFIDENCE" and d["command_id"] is None)
        r = command(c, {"command": "SET_MODE", "target": "MANUAL"})
        wait_status(c, r.json()["command_id"])
    finally:
        stop(sim)

    sim = start_sim("--scenario", "no-ack")
    try:
        wait_for(lambda: c.get(f"{API}/api/devices/DEVICE_001").json()["connection_status"] == "online")
        r = command(c, {"command": "GET_STATUS"})
        status = wait_status(c, r.json()["command_id"], timeout=float(env.get("COMMAND_ACK_TIMEOUT_SEC", 10)) + 5)
        check("ACK 미수신 → TIMEOUT", status == "TIMEOUT", status)
    finally:
        stop(sim)

    sim = start_sim("--scenario", "sensor-fail")
    try:
        b2 = wait_for(lambda: (b := c.get(f"{API}/api/bins/BIN_002").json())["sensor_status"] == "timeout" and b)
        check("센서 실패: 상태 timeout + 마지막 정상값 유지",
              bool(b2) and b2["current_fill_percent"] is not None, str(b2 and b2["current_fill_percent"]))
    finally:
        stop(sim, signal.SIGKILL)  # DISCONNECT 없이 종료 → LWT

    offline = wait_for(lambda: c.get(f"{API}/api/devices/DEVICE_001").json()["connection_status"] == "offline", 30)
    check("비정상 종료 → LWT로 offline 전환", bool(offline))
    r = command(c, {"command": "OPEN_BIN", "target": "plastic"})
    check("offline 장치에 배출구 명령 거부 (성공처럼 표시되지 않음)", r.status_code == 409
          and r.json()["error"]["code"] == "DEVICE_OFFLINE")

    sim = start_sim("--scenario", "normal")
    try:
        back = wait_for(lambda: c.get(f"{API}/api/devices/DEVICE_001").json()["connection_status"] == "online", 20)
        check("재연결 → online 복구", bool(back))
    finally:
        stop(sim)

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n[SIM] {len(results) - len(failed)}/{len(results)} 통과")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
