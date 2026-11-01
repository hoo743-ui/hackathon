"""진단 도구 공통: .env 읽기, PASS/FAIL/NOT TESTED/SKIPPED 출력."""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv

    load_dotenv(HERE / ".env")
except ImportError:  # python-dotenv 미설치여도 환경변수로 동작
    pass

PASS, FAIL, NOT_TESTED, SKIPPED, WARN = "PASS", "FAIL", "NOT TESTED", "SKIPPED", "WARN"
_MARK = {PASS: "[ OK ]", FAIL: "[FAIL]", NOT_TESTED: "[ -- ]", SKIPPED: "[SKIP]", WARN: "[WARN]"}
results: list[tuple[str, str, str]] = []

# Windows 콘솔에서 한글이 깨지지 않도록
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass


def env(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return v.strip() if v is not None and v.strip() != "" else default


def report(name: str, status: str, detail: str = "") -> None:
    if len(detail) > 240:
        detail = detail[:237] + "..."
    results.append((name, status, detail))
    print(f"{_MARK.get(status, '      ')} {status:<10} {name:<26} {detail}", flush=True)


def summary() -> int:
    count = {s: sum(1 for r in results if r[1] == s) for s in (PASS, FAIL, NOT_TESTED, SKIPPED, WARN)}
    print("\n요약: " + " · ".join(f"{k} {v}" for k, v in count.items()))
    return 1 if count[FAIL] else 0


def model_path() -> Path:
    p = Path(env("MODEL_PATH", "models/best_model.pt"))
    return p if p.is_absolute() else HERE / p
