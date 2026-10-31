"""계약 산출물 생성: MQTT JSON Schema (docs/mqtt-schemas/) + OpenAPI (docs/openapi.json).

단일 출처는 백엔드 코드(Pydantic 모델, FastAPI 라우트)다. 스키마나 API를 바꾸면 이 스크립트를 다시 실행한다.
`--check` 옵션은 파일이 최신인지 검사만 한다 (CI/scripts/test.sh 용).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402
from app.schemas.mqtt import AckPayload, CommandMessage, StatusPayload, TelemetryPayload  # noqa: E402

OUT = ROOT / "docs"
BASE = "https://smart-recycle.local/schemas"


def schemas() -> dict[Path, dict]:
    files: dict[Path, dict] = {}
    # 장치 → 서버: 서버가 "수락하는" 형식 (validation), 서버 → 장치: 서버가 "보내는" 형식 (serialization)
    for name, model, mode, topic in [
        ("telemetry", TelemetryPayload, "validation", "smartbin/{device_id}/telemetry"),
        ("status", StatusPayload, "validation", "smartbin/{device_id}/status"),
        ("ack", AckPayload, "validation", "smartbin/{device_id}/ack"),
        ("command", CommandMessage, "serialization", "smartbin/{device_id}/command"),
    ]:
        s = model.model_json_schema(mode=mode)
        s = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": f"{BASE}/{name}.schema.json",
             "description": f"MQTT topic {topic} — protocol v1.1 (docs/MQTT_PROTOCOL.md)", **s}
        files[OUT / "mqtt-schemas" / f"{name}.schema.json"] = s
    files[OUT / "openapi.json"] = app.openapi()
    return files


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for path, data in schemas().items():
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(str(path.relative_to(ROOT)))
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            print(f"wrote {path.relative_to(ROOT)}")
    if stale:
        print("계약 파일이 코드와 다릅니다. scripts/export_contracts.sh 실행 필요:", *stale, sep="\n  ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
