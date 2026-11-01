from functools import lru_cache
from typing import Literal
from urllib.parse import quote_plus

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# 펌웨어 MOTION_TIMEOUT_MS + SERVO_MOVE_SETTLE_MS 상한 (firmware/esp32/include/config.h)
MAX_DEVICE_MOTION_SEC = 9


class Settings(BaseSettings):
    # 루트 .env(로컬 실행) 또는 컨테이너 환경변수에서 읽는다.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    postgres_user: str = "smartbin"
    postgres_password: str
    postgres_db: str = "smartbin"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    db_null_pool: bool = False

    mqtt_enabled: bool = True
    mqtt_host: str = "localhost"
    mqtt_port: int = 1883
    mqtt_backend_username: str
    mqtt_backend_password: str
    mqtt_topic_prefix: str = "smartbin"
    # 브로커가 TLS(8883)일 때 CA 인증서 경로. 비우면 평문
    mqtt_tls_ca_file: str | None = None
    mqtt_simulator_username: str | None = None
    mqtt_simulator_password: str | None = None

    # Hardware Abstraction Layer (app/hardware): SIMULATOR | ESP32_REAL | EDGE_SERIAL
    # EDGE_SERIAL: 카메라 노트북(A)이 YOLO 결과로 아두이노를 USB 시리얼로 직접 구동하고 결과만 보고한다.
    hardware_mode: Literal["SIMULATOR", "ESP32_REAL", "EDGE_SERIAL"] = "SIMULATOR"
    # EDGE_SERIAL: 카메라 노트북의 분류를 기록할 분리수거함 장치 ID (DB devices)
    edge_bin_device_id: str = "DEVICE_001"
    # HC-SR04 1개가 측정하는 칸 (예: BIN_001). 비우면 거리만 기록하고 적재율은 계산하지 않음
    edge_sensor_bin_id: str = ""
    # 카메라 노트북 heartbeat가 이 시간 동안 없으면 offline
    edge_offline_after_sec: float = 15
    # 서버 자동 탐색 신호 (카메라 컴퓨터가 IP 변경을 자동으로 따라감)
    discovery_enabled: bool = True
    discovery_port: int = 50505
    discovery_interval_sec: float = 2.0
    api_port: int = 8000
    # 분류 이미지 저장 위치 (backend/ 기준 상대경로 또는 절대경로)
    upload_dir: str = "data/images"
    max_image_bytes: int = 5 * 1024 * 1024
    simulator_autostart: bool = True
    simulator_scenario: Literal["normal", "mixed", "filling", "sensor-fail", "outlier", "no-ack"] = "mixed"
    simulator_interval_sec: float = 3

    api_control_token: str
    # 외부 AI 프로그램 전용 토큰 (POST /api/detections). 비우면 분류 수신 비활성
    ai_api_token: str | None = None
    ai_confidence_threshold: float = 0.6
    cors_origins: str = "http://localhost:5173,http://localhost:8081"
    # LAN의 다른 기기(다른 노트북 브라우저 등)에서 웹을 열 때. 예: ^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|172\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$
    cors_origin_regex: str | None = None

    command_ack_timeout_sec: float = 15
    # 장치가 명령을 받아들이는 유효시간. 유효시간 + 최대 동작시간(약 8초) < ACK 제한시간이어야
    # 서버가 TIMEOUT으로 기록한 뒤 모터가 움직이는 일이 없다.
    command_expires_sec: float = 3
    device_offline_after_sec: float = 30
    clock_skew_tolerance_sec: float = 300
    bin_full_threshold_percent: float = 95  # shared FILL_THRESHOLDS.critical 와 일치
    # HC-SR04 유효 측정 범위. 범위를 벗어난 "normal" 값은 out_of_range로 재분류한다.
    sensor_min_distance_cm: float = 2
    sensor_max_distance_cm: float = 400

    @model_validator(mode="after")
    def _check_command_timing(self) -> "Settings":
        if self.command_expires_sec + MAX_DEVICE_MOTION_SEC >= self.command_ack_timeout_sec:
            raise ValueError(
                "COMMAND_EXPIRES_SEC + max motion time must be below COMMAND_ACK_TIMEOUT_SEC"
            )
        return self

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote_plus(self.postgres_user)}:{quote_plus(self.postgres_password)}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
