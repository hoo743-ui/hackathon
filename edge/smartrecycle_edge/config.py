"""카메라 노트북(A) 설정. 모든 값은 edge/.env (또는 환경변수)에서 읽는다. IP·포트를 코드에 하드코딩하지 않는다."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

# EXE(PyInstaller)로 실행하면 실행 파일이 있는 폴더의 .env·models·logs 를 사용한다
EDGE_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]

try:  # python-dotenv가 없으면 환경변수만 사용
    from dotenv import load_dotenv

    load_dotenv(EDGE_DIR / ".env")
except ImportError:  # pragma: no cover
    pass


def _bool(name: str, default: bool) -> bool:
    v = os.getenv(name)
    if v is None or v.strip() == "":
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    v = os.getenv(name)
    return float(v) if v not in (None, "") else default


def _int(name: str, default: int) -> int:
    v = os.getenv(name)
    return int(v) if v not in (None, "") else default


def _str(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return v.strip() if v is not None else default


@dataclass
class Settings:
    # --- 서버 (맥북) ---
    backend_url: str = field(default_factory=lambda: _str("BACKEND_URL").rstrip("/"))
    ai_api_token: str = field(default_factory=lambda: _str("AI_API_TOKEN"))
    device_id: str = field(default_factory=lambda: _str("DEVICE_ID", "CAMERA_001"))
    http_timeout: float = field(default_factory=lambda: _float("HTTP_TIMEOUT_SEC", 5.0))
    upload_max_attempts: int = field(default_factory=lambda: _int("UPLOAD_MAX_ATTEMPTS", 5))
    heartbeat_sec: float = field(default_factory=lambda: _float("HEARTBEAT_SEC", 5.0))
    outbox_dir: Path = field(default_factory=lambda: EDGE_DIR / _str("OUTBOX_DIR", "outbox"))
    outbox_max_files: int = field(default_factory=lambda: _int("OUTBOX_MAX_FILES", 200))

    # --- 카메라 / YOLO ---
    camera_index: str = field(default_factory=lambda: _str("CAMERA_INDEX", "0"))
    camera_width: int = field(default_factory=lambda: _int("CAMERA_WIDTH", 0))
    camera_height: int = field(default_factory=lambda: _int("CAMERA_HEIGHT", 0))
    # 모델 경로 우선순위: ① MODEL_PATH ② 실행 폴더의 models/best_model.pt ③ 설정 화면에서 직접 선택
    model_path: str = field(default_factory=lambda: _str("MODEL_PATH", "models/best_model.pt"))
    # 추론 장치: auto(NVIDIA CUDA→CPU) | cpu | 0(첫 번째 GPU) | mps
    yolo_device: str = field(default_factory=lambda: _str("YOLO_DEVICE", "auto"))
    img_size: int = field(default_factory=lambda: _int("IMG_SIZE", 640))
    confidence_threshold: float = field(default_factory=lambda: _float("CONFIDENCE_THRESHOLD", 0.5))
    send_cooldown: float = field(default_factory=lambda: _float("SEND_COOLDOWN", 2.0))
    # 같은 클래스가 연속 N프레임 + 최소 시간 동안 검출되어야 1회 처리 (투입 1회 = 분류 1회)
    stable_frames: int = field(default_factory=lambda: _int("STABLE_FRAMES", 4))
    stable_min_sec: float = field(default_factory=lambda: _float("STABLE_MIN_SEC", 0.4))
    # 물체가 이 시간 동안 사라져야 다음 투입으로 인정
    clear_sec: float = field(default_factory=lambda: _float("CLEAR_SEC", 1.0))
    jpeg_quality: int = field(default_factory=lambda: _int("JPEG_QUALITY", 85))
    save_raw_dir: str = field(default_factory=lambda: _str("SAVE_RAW_DIR", ""))
    show_window: bool = field(default_factory=lambda: _bool("SHOW_WINDOW", True))

    # --- 하드웨어 (USB 시리얼) ---
    # 명령(G/M/P/L)을 받는 보드는 trush.ino(Arduino UNO)의 USB Serial이다. 'auto' = Arduino 계열 1개일 때만 자동 선택
    hw_enabled: bool = field(default_factory=lambda: _bool("HW_ENABLED", True))
    hw_serial_port: str = field(default_factory=lambda: _str("HW_SERIAL_PORT", "auto"))
    hw_baud: int = field(default_factory=lambda: _int("HW_BAUD", 9600))
    # trush.ino processDrop(): X 회전 4000ms + 기울임 2000ms + 100ms ≈ 6.1초 동안 다른 명령을 처리하지 못한다
    hw_busy_sec: float = field(default_factory=lambda: _float("HW_BUSY_SEC", 6.5))
    # uno_controller 펌웨어 ACK 대기 (START 1.5초, DONE 10초 — 동작 약 6.1초)
    ack_timeout: float = field(default_factory=lambda: _float("ACK_TIMEOUT_SEC", 10.0))
    # --- HC-SR04 1개 ---
    sensor_bin_id: str = field(default_factory=lambda: _str("SENSOR_BIN_ID", ""))  # 센서가 달린 칸 (예: BIN_001)
    empty_distance_cm: float = field(default_factory=lambda: _float("EMPTY_DISTANCE_CM", 0.0))  # 빈 통 실측 거리
    sensor_timeout_sec: float = field(default_factory=lambda: _float("SENSOR_TIMEOUT_SEC", 5.0))
    sensor_send_sec: float = field(default_factory=lambda: _float("SENSOR_SEND_SEC", 3.0))
    # ESP32 가 Wi-Fi 로 거리값을 직접 서버에 보내면 false (중복 방지)
    forward_sensor: bool = field(default_factory=lambda: _bool("FORWARD_SENSOR", True))
    # (선택) ESP32 DevKitC USB — 읽기 전용(브리지 상태·로그). 비우면 사용 안 함
    esp32_serial_port: str = field(default_factory=lambda: _str("ESP32_SERIAL_PORT", ""))
    esp32_baud: int = field(default_factory=lambda: _int("ESP32_BAUD", 115200))

    def problems(self) -> list[str]:
        out = []
        if not self.backend_url:
            out.append("BACKEND_URL 미설정 (예: http://<맥북 LAN IP>:8000)")
        elif "localhost" in self.backend_url or "127.0.0.1" in self.backend_url:
            out.append("BACKEND_URL 이 localhost 입니다 — 카메라 노트북에서는 맥북의 LAN IP를 써야 합니다")
        if not self.ai_api_token:
            out.append("AI_API_TOKEN 미설정 (맥북 .env 의 AI_API_TOKEN 과 같은 값)")
        return out


def resolve_model_path(configured: str) -> Path | None:
    """① 설정값(절대/실행 폴더 기준 상대) ② 실행 폴더 models/best_model.pt. 없으면 None."""
    cands = []
    if configured:
        p = Path(configured)
        cands.append(p if p.is_absolute() else EDGE_DIR / p)
    cands.append(EDGE_DIR / "models" / "best_model.pt")
    for c in cands:
        if c.is_file():
            return c
    return None


ENV_FILE = EDGE_DIR / ".env"


def save_env(values: dict[str, str]) -> None:
    """설정 화면 → .env 저장 (기존 키는 덮어쓰고 나머지 줄·주석은 유지)."""
    lines = ENV_FILE.read_text(encoding="utf-8").splitlines() if ENV_FILE.exists() else []
    done = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in values and not line.lstrip().startswith("#"):
            lines[i] = f"{key}={values[key]}"
            done.add(key)
    lines += [f"{k}={v}" for k, v in values.items() if k not in done]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


settings = Settings()
