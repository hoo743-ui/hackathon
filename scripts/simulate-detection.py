"""가상 AI 분류 발생기 (AI 노트북 없이 시연·테스트용). 모든 분류는 source=simulator 로 표시된다."""
import argparse
import json
import random
import sys
import time
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TYPES = ["plastic", "metal", "paper", "glass"]


def env() -> dict[str, str]:
    out = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def send(base: str, token: str, waste: str, conf: float) -> str:
    body = {"waste_type": waste, "confidence": conf, "source": "simulator", "model": "simulated-classifier",
            "detection_id": str(uuid.uuid4())}
    req = urllib.request.Request(f"{base}/api/detections", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.load(r)["outcome"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--interval", type=float, default=10)
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--waste-type", choices=TYPES)
    ap.add_argument("--confidence", type=float)
    a = ap.parse_args()
    e = env()
    base = f"http://localhost:{e.get('API_PORT', '8000')}"
    while True:
        waste = a.waste_type or random.choice(TYPES)
        conf = a.confidence if a.confidence is not None else round(random.triangular(0.35, 0.99, 0.9), 2)
        try:
            print(f"[SIM-AI] {waste} {conf:.2f} → {send(base, e['AI_API_TOKEN'], waste, conf)}", flush=True)
        except Exception as exc:
            print(f"[SIM-AI] 전송 실패: {exc}", file=sys.stderr)
        if a.once:
            return 0
        time.sleep(a.interval)


if __name__ == "__main__":
    raise SystemExit(main())
