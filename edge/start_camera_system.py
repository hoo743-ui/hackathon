"""SMART RECYCLE — 카메라 노트북(A) 실행 프로그램.

카메라 → YOLO(best_model.pt) → 안정 검출 1회 → ① USB 시리얼로 하드웨어 명령 (즉시, 네트워크와 무관)
                                              → ② 이미지+메타데이터를 맥북 백엔드로 전송 (백그라운드 큐)
아두이노 시리얼 출력([ALERT] 만차) → 센서 이벤트로 백엔드 전송. 5초마다 상태(heartbeat) 보고.

실행:  python start_camera_system.py            (설정: edge/.env)
       python start_camera_system.py --source test.jpg --no-hw   (카메라 없이 이미지 파일로 파이프라인 확인)
키:    q 종료 · r 화면 카운트 초기화
"""
from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import cv2
import requests

from smartrecycle_edge.config import EDGE_DIR, resolve_model_path, settings
from smartrecycle_edge.detector import ModelLoadError, StableTrigger, YoloRunner, top_detection
from smartrecycle_edge.hardware import LEGACY_ID_TO_SIGNAL, NAME_TO_SIGNAL, HardwareController, SensorMonitor, SerialLink
from smartrecycle_edge.discovery import Discovery
from smartrecycle_edge.uploader import Uploader

VERSION = "1.1.0"
log = logging.getLogger("edge")


def build_signal_map(names: dict[int, str]) -> dict[int, str]:
    """모델 names 기준 매핑을 만들고 기존 ID 매핑(yolo_arduino.py)과 대조한다."""
    by_name = {i: NAME_TO_SIGNAL[n.strip().lower()] for i, n in names.items() if n.strip().lower() in NAME_TO_SIGNAL}
    for cid, sig in LEGACY_ID_TO_SIGNAL.items():
        if cid in by_name and by_name[cid] != sig:
            log.error("⚠️ 클래스 매핑 불일치: id %d 모델 이름 '%s' → '%s' 이지만 기존 코드는 '%s'. 모델 이름 기준을 사용합니다.",
                      cid, names[cid], by_name[cid], sig)
    if by_name and all(by_name.get(c) == s for c, s in LEGACY_ID_TO_SIGNAL.items()):
        log.info("클래스 매핑 확인: 모델 names %s == 기존 CLASS_SIGNAL_MAP (G/M/P/L)", names)
    if not by_name:
        log.warning("모델에 Glass/Metal/Paper/Plastic 클래스가 없습니다 → 하드웨어 명령 없음, 서버에는 UNRECOGNIZED로 기록")
    return by_name


def open_camera(source: str):
    if source.isdigit():
        idx = int(source)
        backend = cv2.CAP_DSHOW if sys.platform.startswith("win") else cv2.CAP_ANY
        cap = cv2.VideoCapture(idx, backend)
        if settings.camera_width:
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, settings.camera_width)
        if settings.camera_height:
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, settings.camera_height)
        return cap, False
    path = Path(source)
    if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}:
        return path, True  # 정지 이미지: 같은 프레임 반복
    return cv2.VideoCapture(str(path)), False


class Heartbeat(threading.Thread):
    def __init__(self, app: "EdgeApp"):
        super().__init__(name="heartbeat", daemon=True)
        self.app = app
        self.stop_event = threading.Event()
        self.http = requests.Session()
        self.http.headers["Authorization"] = f"Bearer {settings.ai_api_token}"
        self.was_online = False

    def run(self) -> None:
        first = True  # 시작 즉시 1회 보고 → 서버 로그에 접속 흔적이 바로 남는다
        while first or not self.stop_event.wait(settings.heartbeat_sec if self.was_online else 2.0):
            first = False
            a = self.app
            body = {
                "device_id": settings.device_id,
                "camera_ok": a.camera_ok,
                "camera_index": a.source,
                "model_loaded": a.yolo is not None,
                "model_name": a.model_name,
                "model_classes": {str(k): v for k, v in (a.yolo.names.items() if a.yolo else [])},
                "fps": round(a.fps, 1),
                "serial_enabled": a.hw.enabled,
                "serial_connected": a.hw.connected,
                "serial_port": a.hw.port,
                "esp32_port": settings.esp32_serial_port or None,
                "esp32_connected": bool(a.esp32 and a.esp32.connected),
                "uno_firmware": a.hw.firmware if a.hw.connected else None,
                "servo_state": a.hw.servo_state if a.hw.connected else None,
                "sensor_status": a.sensor.status(),
                "distance_cm": a.sensor.distance(),
                "fill_percent": a.sensor.fill_percent(),
                "sorted_ok": a.sorted_ok,
                "sorted_failed": a.sorted_failed,
                "upload_queue": a.uploader.pending,
                "uploads_ok": a.uploader.stats.ok,
                "uploads_failed": a.uploader.stats.failed,
                "last_error": (a.hw.last_error or a.uploader.stats.last_error or None),
                "version": VERSION,
            }
            if body["last_error"]:
                body["last_error"] = body["last_error"][:300]
            try:
                if not a.backend_url.startswith("http"):
                    raise requests.ConnectionError("서버 주소 미확정 (서버 신호 대기 중)")
                r = self.http.post(f"{a.backend_url}/api/edge/heartbeat", json=body, timeout=settings.http_timeout)
                online = r.ok
                if not r.ok:
                    log.warning("heartbeat 거부: HTTP %s %s", r.status_code, r.text[:120])
            except requests.RequestException as exc:
                online = False
                if self.was_online:
                    log.warning("백엔드 연결 끊김: %s", exc)
            if not online and a.switch_to_discovered():
                continue  # 새 주소로 바로 다시 시도
            if online and not self.was_online:
                log.info("백엔드 연결됨: %s", a.backend_url)
                a.uploader.flush_outbox()  # 네트워크 복구 → 못 보낸 분류 재전송
            self.was_online = online
            a.backend_online = online


class EdgeApp:
    def __init__(self, args):
        self.args = args
        self.source = args.source or settings.camera_index
        self.camera_ok = False
        self.backend_online = False
        self.fps = 0.0
        self.yolo: YoloRunner | None = None
        self.counts = {"G": 0, "M": 0, "P": 0, "L": 0}  # 인식(분류 처리) 건수
        self.sorted_ok = 0  # 장치 ACK DONE 확인
        self.sorted_failed = 0  # ACK 타임아웃/거부/중단/전송 실패
        self.model_name = Path(settings.model_path).name
        self.verifier = None  # 2차 판정기 (백그라운드 로드, 준비 전에는 YOLO 결과만 사용)
        self.verifier_status = "꺼짐" if not settings.verify else "준비 중"
        self.rejected = 0  # 2차 판정기가 배경·사람으로 걸러낸 횟수
        self.model_path: Path | None = None
        self.last_event = ""
        self.last_detection: dict | None = None  # GUI 표시용
        self.latest_frame = None  # GUI 표시용 (annotated)
        self.restart_camera = threading.Event()
        self.status_msg = "준비 중"
        self.stop = threading.Event()
        self.backend_url = settings.backend_url if settings.backend_url.lower() != "auto" else ""
        self.discovery = Discovery(settings.discovery_port) if settings.discovery else None
        self.uploader = Uploader(self.backend_url, settings.ai_api_token, settings.http_timeout,
                                 settings.upload_max_attempts, settings.outbox_dir, settings.outbox_max_files)
        hw_enabled = settings.hw_enabled and not args.no_hw
        self.hw = HardwareController(hw_enabled, settings.hw_serial_port, settings.hw_baud, settings.hw_busy_sec,
                                     self.on_serial_line, exclude_ports={settings.esp32_serial_port},
                                     ack_timeout=settings.ack_timeout, on_result=self.on_hw_result)
        self.sensor = SensorMonitor(settings.empty_distance_cm, timeout_sec=settings.sensor_timeout_sec)
        self._sensor_sent_at = 0.0
        self._sensor_sent_status = ""
        self.esp32_info = {"wifi": "-", "uno_link": "-", "http": "-"}
        self.esp32: SerialLink | None = None
        if settings.esp32_serial_port and not args.no_hw:
            # ESP32 USB 로그 모니터 (읽기 전용). ESP32는 명령을 받지 않는다 (esp32.ino 기준)
            self.esp32 = SerialLink("esp32", settings.esp32_serial_port, settings.esp32_baud, self.on_serial_line,
                                    reset_wait=0.5)
        self.trigger = StableTrigger(settings.stable_frames, settings.stable_min_sec, settings.clear_sec,
                                     settings.send_cooldown)
        self.heartbeat = Heartbeat(self)
        self.housekeeper = threading.Thread(target=self._housekeeping, name="housekeeping", daemon=True)

    # --- 주기 작업: ACK 타임아웃, 센서 끊김 감지·전송 ---
    def _housekeeping(self) -> None:
        while not self.stop.wait(0.5):
            try:
                self.hw.tick()
                self._maybe_send_sensor()
            except Exception:
                log.exception("housekeeping error")

    def _maybe_send_sensor(self, force: bool = False) -> None:
        st = self.sensor.status()
        if st == "unknown" or not settings.forward_sensor:
            return
        now = time.monotonic()
        if not force and st == self._sensor_sent_status and now - self._sensor_sent_at < settings.sensor_send_sec:
            return
        if st != self._sensor_sent_status:
            log.info("[HC-SR04] 상태 %s → %s", self._sensor_sent_status or "-", st.upper() if st != "disconnected" else "SENSOR_DISCONNECTED")
        self._sensor_sent_at, self._sensor_sent_status = now, st
        self.uploader.submit_telemetry({
            "device_id": settings.device_id,
            "kind": "distance",
            "sensor_id": "HC-SR04",
            "raw": f"DIST:{self.sensor.last_raw}" if self.sensor.last_raw is not None else None,
            "payload": {
                "distance_cm": self.sensor.distance(),
                "sensor_status": st,
                "bin_id": settings.sensor_bin_id or None,
                "empty_distance_cm": settings.empty_distance_cm or None,
                "fill_percent_edge": self.sensor.fill_percent(),
                "filter": "median5",
            },
            "source": "hardware",
            "measured_at": datetime.now(timezone.utc).isoformat(),
        })

    # --- 장치 ACK 결과 ---
    def on_hw_result(self, detection_id: str, signal_char: str, status: str) -> None:
        if status == "completed":
            self.sorted_ok += 1
        else:
            self.sorted_failed += 1
        if self.last_detection and self.last_detection.get("detection_id") == detection_id:
            self.last_detection["hardware_status"] = status
        self.uploader.submit_hw_update(detection_id, status)

    def emergency_stop(self) -> None:
        log.warning("비상 정지 요청 → 'S' 전송")
        ok = self.hw.emergency_stop()
        if not ok:
            log.error("비상 정지 명령을 보내지 못함 (시리얼 미연결) — 장치 전원을 차단하세요")
        elif not self.hw.ack_capable:
            log.warning("구 펌웨어(trush.ino)는 'S' 를 처리하지 않습니다 — 필요하면 서보 전원을 차단하세요")

    # --- 시리얼 수신 → 센서 이벤트 ---
    def on_serial_line(self, who: str, line: str) -> None:
        if line.startswith("DIST:"):  # 1초마다 → 로그에는 남기지 않음
            self.sensor.feed(line[5:])
            self._maybe_send_sensor()
            return
        if who == "esp32":
            if line.startswith("UNO>"):
                inner = line[4:]
                self.esp32_info["uno_link"] = "OK"
                if inner.startswith("DIST:") and not self.hw.connected:
                    self.sensor.feed(inner[5:])  # UNO USB 가 없을 때 ESP32 경유 값 사용
                    self._maybe_send_sensor()
                return
            if line.startswith("ESP32:WIFI:"):
                self.esp32_info["wifi"] = line.split(":", 2)[2]
            elif line.startswith("ESP32:UNO_LINK:"):
                self.esp32_info["uno_link"] = line.rsplit(":", 1)[1]
                return
            elif line.startswith("ESP32:HTTP:"):
                self.esp32_info["http"] = line.rsplit(":", 1)[1]
                return
        log.info("[%s] %s", who, line)
        if "[ALERT]" in line or line.startswith("FULL:"):  # trush.ino (구 펌웨어)
            self.uploader.submit_telemetry({
                "device_id": settings.device_id, "kind": "bin_full_alert",
                "sensor_id": line.split(":", 1)[1] if line.startswith("FULL:") else "TRASH",
                "raw": line[:1000], "payload": {"port": who}, "source": "hardware",
                "measured_at": datetime.now(timezone.utc).isoformat(),
            })

    # --- 분류 1회 처리 ---
    def _load_verifier(self) -> None:
        try:
            import torch  # noqa: F401
            from smartrecycle_edge.verifier import MaterialVerifier

            w = EDGE_DIR / "models" / "verifier_trashnet.npz"
            if not w.exists():
                self.verifier_status = "가중치 파일 없음 → YOLO 만 사용"
                return
            dev = "cuda" if self.yolo and self.yolo.device not in ("cpu", "mps") else "cpu"
            self.verifier = MaterialVerifier(w, device=dev)
            self.verifier_status = "켜짐 (CLIP + TrashNet)"
        except Exception as exc:
            self.verifier_status = f"사용 불가 → YOLO 만 사용 ({type(exc).__name__})"
            log.warning("2차 판정기 로드 실패 (처음 실행 시 인터넷으로 CLIP 가중치를 받습니다): %s", exc)

    def handle(self, det, annotated, frame=None) -> None:
        if self.verifier is not None and frame is not None:
            from smartrecycle_edge.verifier import crop_box, decide

            try:
                v = self.verifier(crop_box(frame, det.box))
                final, why = decide(det.name, det.confidence, v, bg_reject=settings.verify_bg_reject,
                                    override_prob=settings.verify_override, keep_conf=settings.verify_keep_conf)
            except Exception as exc:
                final, why = det.name.lower(), f"판정기 오류 → YOLO 유지 ({exc})"
            log.info("[2차 판정] YOLO %s %.2f → %s", det.name, det.confidence, why)
            if final is None:
                self.rejected += 1
                self.last_event = f"무시: {det.name} {det.confidence:.2f} ({why})"
                return  # 하드웨어 명령·서버 전송 없음
            if final != det.name.lower():
                ids = {n.lower(): i for i, n in self.yolo.names.items()}
                if final in ids:
                    det.class_id, det.name = ids[final], self.yolo.names[ids[final]]
        signal_char = self.signal_map.get(det.class_id)
        detection_id = str(uuid.uuid4())
        # ① 하드웨어 먼저 (네트워크와 독립). 성공 여부는 ACK 로 나중에 갱신
        hw_status = self.hw.send(signal_char, detection_id)
        if signal_char:
            self.counts[signal_char] += 1
        if hw_status in ("serial_failed", "not_connected", "skipped_busy") and signal_char and self.hw.enabled:
            self.sorted_failed += 1
        ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, settings.jpeg_quality])
        if not ok:
            log.error("JPEG 인코딩 실패 → 전송 생략")
            return
        meta = {
            "detection_id": detection_id,
            "device_id": settings.device_id,
            "waste_type": det.name.strip().lower(),
            "class_id": det.class_id,
            "confidence": round(det.confidence, 4),
            "model_name": self.model_name + ("+verify" if self.verifier is not None else ""),
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "bounding_box": dict(zip(("x1", "y1", "x2", "y2"), (round(v, 1) for v in det.box))),
            "hardware_status": hw_status,
        }
        # ② 전송은 큐로 (카메라 루프를 막지 않음)
        self.uploader.submit_detection(meta, buf.tobytes())
        self.last_event = f"{det.name} {det.confidence:.2f} hw={hw_status}"
        self.last_detection = {**meta, "signal": signal_char, "time": time.strftime("%H:%M:%S")}
        log.info("[분류] %s conf=%.2f signal=%s hw=%s id=%s", det.name, det.confidence, signal_char, hw_status, detection_id)

    def overlay(self, img) -> None:
        c = self.counts
        lines = [
            f"P(L):{c['L']} | M:{c['M']} | G:{c['G']} | Pa:{c['P']}",
            f"server:{'ON' if self.backend_online else 'OFF'}  serial:{'ON' if self.hw.connected else ('OFF' if self.hw.enabled else 'disabled')}"
            f"  queue:{self.uploader.pending}  fps:{self.fps:.1f}",
            f"last: {self.last_event}",
        ]
        for i, t in enumerate(lines):
            cv2.putText(img, t, (20, 40 + 28 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2, cv2.LINE_AA)

    def run(self) -> int:
        code = self.prepare()
        if code:
            return code
        return self.loop()

    def prepare(self) -> int:
        """설정·모델·카메라 확인 후 백그라운드 스레드 시작. 실패 시 원인을 status_msg 에 남긴다."""
        for p in settings.problems():
            log.error("설정 오류: %s", p)
        # 서버 연결·하드웨어는 모델/카메라와 무관하게 먼저 시작한다
        # → 모델이 없거나 카메라가 안 열려도 서버에 상태(heartbeat)가 보고되고 GUI 에 연결 상태가 보인다
        self.start_background()
        if settings.problems():
            self.status_msg = "설정 오류: " + "; ".join(settings.problems())
            return 2
        model_path = resolve_model_path(settings.model_path)
        if model_path is None:
            log.error("모델 파일을 찾을 수 없습니다: MODEL_PATH=%s, %s", settings.model_path, EDGE_DIR / "models" / "best_model.pt")
            self.status_msg = "모델 파일 없음 — 설정에서 best_model.pt 경로를 지정하세요"
            return 2
        self.model_path, self.model_name = model_path, model_path.name
        log.info("YOLO 모델 로드 (INFERENCE ONLY): %s", model_path)
        try:
            probe = YoloRunner(str(model_path), settings.confidence_threshold, device=settings.yolo_device,
                               imgsz=settings.img_size)
            self.signal_map = build_signal_map(probe.names)
            probe.target_ids = sorted(self.signal_map) or None
            probe.warmup()
        except ModelLoadError as exc:
            log.error("%s", exc)
            self.status_msg = str(exc)[:200]
            return 2
        self.yolo = probe
        if settings.verify:
            threading.Thread(target=self._load_verifier, name="verifier-load", daemon=True).start()
        log.info("모델 클래스: %s · 대상 class id: %s · 추론 장치: %s · imgsz=%d · conf=%.2f",
                 probe.names, probe.target_ids, probe.device_label, probe.imgsz, probe.conf)

        self.cap, self.still = open_camera(self.source)
        if self.still:
            self.still_frame = cv2.imread(str(self.cap))
            if self.still_frame is None:
                log.error("이미지를 읽을 수 없습니다: %s", self.cap)
                self.status_msg = f"이미지를 읽을 수 없음: {self.cap}"
                return 2
        elif not self.cap.isOpened():
            log.error("카메라를 열 수 없습니다 (CAMERA_INDEX=%s). check_system.py --cameras 로 번호 확인", self.source)
            self.status_msg = f"카메라를 열 수 없음 (CAMERA_INDEX={self.source})"
            # 하드웨어·서버 상태는 계속 보고한다
            return 3

        log.info("시작: device=%s backend=%s", settings.device_id, settings.backend_url)
        self.status_msg = "카메라 모드"
        return 0

    def switch_to_discovered(self) -> bool:
        """서버 신호로 받은 주소가 지금 주소와 다르면 바꾸고 .env 에 저장한다 (다음 실행에도 사용)."""
        if not self.discovery:
            return False
        url = self.discovery.fresh_url()
        if not url or url == self.backend_url:
            return False
        old = self.backend_url or "(미설정)"
        self.backend_url = url
        self.uploader.base = url
        log.warning("서버 주소 자동 변경: %s → %s (서버 신호)", old, url)
        try:
            from smartrecycle_edge.config import save_env

            save_env({"BACKEND_URL": url})
        except Exception:
            log.exception(".env 저장 실패 (이번 실행에는 새 주소 사용)")
        self.uploader.flush_outbox()
        return True

    def start_background(self) -> None:
        """전송 큐 · 하드웨어 시리얼 · ESP32 · heartbeat · 주기 작업 (한 번만)."""
        if getattr(self, "_bg_started", False):
            return
        self._bg_started = True
        if self.discovery:
            self.discovery.start()
        if settings.backend_url:
            self.uploader.start()
            self.heartbeat.start()
        else:
            log.error("BACKEND_URL 이 비어 있어 서버 연결을 시작하지 않습니다")
        self.hw.start()
        if self.esp32:
            self.esp32.start()
        self.housekeeper.start()

    def loop(self) -> int:
        cap, still = self.cap, self.still
        still_frame = getattr(self, "still_frame", None)
        fails, reopen, infer_errors = 0, 0, 0
        t_prev = time.monotonic()
        window = settings.show_window and not self.args.headless and not self.args.gui
        try:
            while not self.stop.is_set():
                if self.restart_camera.is_set() and not still:
                    self.restart_camera.clear()
                    log.info("카메라 재시작 요청")
                    cap.release()
                    time.sleep(0.5)
                    cap, _ = open_camera(self.source)
                    self.cap = cap
                    fails, reopen = 0, 0
                if still:
                    frame = still_frame.copy()
                    ok = True
                    time.sleep(0.05)
                else:
                    ok, frame = cap.read()
                if not ok or frame is None:
                    self.camera_ok = False
                    fails += 1
                    if fails >= 30:
                        if reopen >= 5 or not str(self.source).isdigit():
                            log.error("카메라 프레임 수신 실패가 계속됩니다 → 추론 중지 ('카메라 재시작'으로 재시도)")
                            self.status_msg = "카메라 끊김 — 케이블 확인 후 '카메라 재시작'"
                            if self.args.gui:
                                self.restart_camera.wait()  # GUI 에서 재시작을 누를 때까지 대기 (모터 동작 없음)
                                if self.stop.is_set():
                                    break
                                reopen = 0
                                continue
                            return 3
                        reopen += 1
                        log.warning("카메라 재연결 시도 %d/5", reopen)
                        cap.release()
                        time.sleep(1.0)
                        cap, _ = open_camera(self.source)
                        self.cap = cap
                        fails = 0
                    else:
                        time.sleep(0.03)
                    continue
                fails, self.camera_ok = 0, True
                self.status_msg = "카메라 모드"
                if reopen and not still:
                    reopen = 0

                try:
                    result = self.yolo(frame)
                    infer_errors = 0
                    if not self.yolo.camera_verified:
                        self.yolo.camera_verified = True
                        log.info("실제 카메라 프레임 추론 확인 (%dx%d)", frame.shape[1], frame.shape[0])
                except Exception as exc:
                    infer_errors += 1
                    if infer_errors <= 3:
                        log.exception("YOLO 추론 오류 (이 프레임 건너뜀)")
                    self.status_msg = f"YOLO 추론 오류 {infer_errors}회: {exc}"[:200]
                    if infer_errors >= 3:
                        time.sleep(1.0)  # 반복 오류 시 로그·CPU 폭주 방지
                    continue
                det = top_detection(result, self.yolo.names)
                annotated = result.plot()
                # 2차 판정기를 켠 경우, 로드가 끝날 때까지(수 초) 분류를 확정하지 않는다 → 검증 없는 결과가 나가지 않게
                verifying = settings.verify and self.verifier_status == "준비 중"
                if self.trigger.update(det, can_fire=not self.hw.busy and not verifying):
                    self.handle(det, annotated, frame)

                now = time.monotonic()
                self.fps = 0.9 * self.fps + 0.1 * (1.0 / max(now - t_prev, 1e-3))
                t_prev = now
                if self.args.max_events and self.uploader.stats.ok + self.uploader.stats.failed >= self.args.max_events:
                    # 자동 시험용: N건 전송 후 종료
                    break
                if self.args.gui:
                    self.latest_frame = annotated
                if window:
                    self.overlay(annotated)
                    cv2.imshow("SMART RECYCLE - Camera", annotated)
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord("q"):
                        break
                    if key == ord("r"):
                        self.counts = {k: 0 for k in self.counts}
                        log.info("화면 카운트 초기화 (아두이노에는 아무것도 보내지 않음)")
        finally:
            log.info("종료 중…")
            self.heartbeat.stop_event.set()
            self.uploader.stop()
            self.hw.close()
            if self.esp32:
                self.esp32.close()
            if not still:
                self.cap.release()
            if window:
                cv2.destroyAllWindows()
        return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="SMART RECYCLE camera laptop")
    ap.add_argument("--source", help="카메라 번호 또는 이미지/동영상 파일 (기본: CAMERA_INDEX)")
    ap.add_argument("--no-hw", action="store_true", help="시리얼 하드웨어 사용 안 함")
    ap.add_argument("--headless", action="store_true", help="화면 창 없이 실행")
    ap.add_argument("--max-events", type=int, default=0, help="N건 전송 후 자동 종료 (시험용)")
    args = ap.parse_args()
    args.gui = False
    from smartrecycle_edge.config import acquire_single_instance

    lock = acquire_single_instance()
    if lock is None:
        print("카메라 프로그램이 이미 실행 중입니다 (Arduino 포트 충돌 방지). 기존 창을 사용하세요.")
        return 4
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    app = EdgeApp(args)
    signal.signal(signal.SIGINT, lambda *_: app.stop.set())
    return app.run()


if __name__ == "__main__":
    sys.exit(main())
