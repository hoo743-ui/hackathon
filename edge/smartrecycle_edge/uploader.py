"""맥북 백엔드 전송 — 카메라 루프와 분리된 백그라운드 스레드.

- 분류: multipart (metadata JSON + image JPEG) → POST /api/detections
- 센서 이벤트: JSON → POST /api/telemetry
- 실패 시 제한된 재시도(지수 백오프). 끝내 실패한 분류는 outbox/ 에 저장했다가 서버 복구 시 다시 보낸다.
- 같은 detection_id 재전송은 서버가 중복 없이 처리한다 (멱등).
"""
from __future__ import annotations

import json
import logging
import queue
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests

log = logging.getLogger("edge.upload")

PERMANENT = {400, 401, 403, 404, 413, 415, 422}  # 재시도해도 같은 결과


@dataclass
class Job:
    kind: str  # detection | telemetry | hardware
    payload: dict
    image: bytes | None = None
    attempts: int = 0
    not_before: float = 0.0
    from_outbox: Path | None = None


@dataclass
class Stats:
    ok: int = 0
    failed: int = 0
    last_error: str | None = None
    backend_online: bool = False
    last_ok_detection: str | None = None
    history: list = field(default_factory=list)


class Uploader:
    def __init__(self, backend_url: str, token: str, timeout: float, max_attempts: int,
                 outbox_dir: Path, outbox_max: int, queue_size: int = 100):
        self.base = backend_url
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.outbox = outbox_dir
        self.outbox_max = outbox_max
        self.q: queue.Queue[Job] = queue.Queue(maxsize=queue_size)
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"
        self.stats = Stats()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="uploader", daemon=True)

    # --- 외부 API ---
    def start(self) -> None:
        self.outbox.mkdir(parents=True, exist_ok=True)
        self._thread.start()

    def stop(self, drain_sec: float = 3.0) -> None:
        end = time.monotonic() + drain_sec
        while not self.q.empty() and time.monotonic() < end:
            time.sleep(0.1)
        self._stop.set()
        # 못 보낸 분류는 다음 실행 때 보내도록 저장
        while True:
            try:
                job = self.q.get_nowait()
            except queue.Empty:
                break
            if job.kind == "detection" and job.from_outbox is None:
                self._save_outbox(job)

    @property
    def pending(self) -> int:
        return self.q.qsize() + len(list(self.outbox.glob("*.json")))

    def submit_detection(self, meta: dict, jpeg: bytes) -> None:
        self._put(Job("detection", meta, jpeg))

    def submit_telemetry(self, payload: dict) -> None:
        self._put(Job("telemetry", payload))

    def submit_hw_update(self, detection_id: str, status: str) -> None:
        """장치 ACK 결과 → POST /api/detections/{id}/hardware (분류 전송 뒤 같은 큐 순서로 보낸다)."""
        self._put(Job("hardware", {"detection_id": detection_id, "hardware_status": status}))

    def flush_outbox(self) -> int:
        """서버 복구 시 outbox 를 다시 큐에 넣는다 (오래된 순, 큐 여유만큼)."""
        n = 0
        for meta_path in sorted(self.outbox.glob("*.json"))[: max(0, self.q.maxsize - self.q.qsize() - 5)]:
            img_path = meta_path.with_suffix(".jpg")
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                image = img_path.read_bytes()
            except Exception:
                log.warning("outbox 파일 손상: %s", meta_path.name)
                continue
            self._put(Job("detection", meta, image, from_outbox=meta_path))
            n += 1
        if n:
            log.info("outbox %d건 재전송 대기열에 추가", n)
        return n

    # --- 내부 ---
    def _put(self, job: Job) -> None:
        try:
            self.q.put_nowait(job)
        except queue.Full:
            if job.kind == "detection":
                log.warning("전송 대기열 가득 참 → outbox 저장")
                self._save_outbox(job)
            else:
                log.warning("전송 대기열 가득 참 → 센서 이벤트 버림")

    def _save_outbox(self, job: Job) -> None:
        files = sorted(self.outbox.glob("*.json"))
        if len(files) >= self.outbox_max:
            log.error("outbox 한도(%d) 초과 → 저장하지 않음", self.outbox_max)
            return
        did = job.payload.get("detection_id", str(time.time()))
        (self.outbox / f"{did}.jpg").write_bytes(job.image or b"")
        (self.outbox / f"{did}.json").write_text(json.dumps(job.payload, ensure_ascii=False), encoding="utf-8")

    def _patch_outbox(self, job: Job) -> bool:
        f = self.outbox / f"{job.payload['detection_id']}.json"
        if not f.exists():
            return False
        meta = json.loads(f.read_text(encoding="utf-8"))
        meta["hardware_status"] = job.payload["hardware_status"]
        f.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        return True

    def _remove_outbox(self, job: Job) -> None:
        if job.from_outbox:
            job.from_outbox.unlink(missing_ok=True)
            job.from_outbox.with_suffix(".jpg").unlink(missing_ok=True)

    def _send(self, job: Job) -> requests.Response:
        if job.kind == "detection":
            files = {"image": (f"{job.payload['detection_id']}.jpg", job.image, "image/jpeg")}
            data = {"metadata": json.dumps(job.payload, ensure_ascii=False)}
            return self.session.post(f"{self.base}/api/detections", data=data, files=files, timeout=self.timeout)
        if job.kind == "hardware":
            return self.session.post(f"{self.base}/api/detections/{job.payload['detection_id']}/hardware",
                                     json={"hardware_status": job.payload["hardware_status"]}, timeout=self.timeout)
        return self.session.post(f"{self.base}/api/telemetry", json=job.payload, timeout=self.timeout)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                job = self.q.get(timeout=0.5)
            except queue.Empty:
                continue
            wait = job.not_before - time.monotonic()
            if wait > 0:
                time.sleep(min(wait, 1.0))
                if job.not_before > time.monotonic():
                    self._requeue(job)
                    continue
            job.attempts += 1
            try:
                r = self._send(job)
                status, err = r.status_code, None if r.ok else r.text[:200]
            except requests.RequestException as exc:
                status, err = None, f"{type(exc).__name__}: {exc}"[:200]

            if status in (200, 201):
                self.stats.ok += 1
                self.stats.backend_online = True
                self.stats.last_error = None
                if job.kind == "detection":
                    did = job.payload["detection_id"]
                    self.stats.last_ok_detection = did
                    log.info("전송 성공 %s %s (%s)", job.payload["waste_type"], did, "재전송" if status == 200 else "신규")
                self._remove_outbox(job)
                continue

            self.stats.last_error = f"HTTP {status}: {err}" if status else err
            if status is None:
                self.stats.backend_online = False
            if job.kind == "hardware" and self._patch_outbox(job):
                continue  # 분류가 아직 outbox 에 있음 → 그 파일의 hardware_status 를 고쳐 함께 보낸다
            if status in PERMANENT and not (job.kind == "hardware" and status == 404):
                self.stats.failed += 1
                log.error("전송 거부(재시도 안 함) %s: %s", job.kind, self.stats.last_error)
                self._remove_outbox(job)
                continue
            if job.attempts >= self.max_attempts:
                self.stats.failed += 1
                log.error("전송 %d회 실패 → %s", job.attempts, "outbox 저장" if job.kind == "detection" else "버림")
                if job.kind == "detection" and job.from_outbox is None:
                    self._save_outbox(job)
                continue
            delay = min(15.0, 2 ** (job.attempts - 1))
            log.warning("전송 실패(%d/%d) %s → %.0f초 후 재시도", job.attempts, self.max_attempts, self.stats.last_error, delay)
            job.not_before = time.monotonic() + delay
            self._requeue(job)

    def _requeue(self, job: Job) -> None:
        try:
            self.q.put_nowait(job)
        except queue.Full:
            if job.kind == "detection" and job.from_outbox is None:
                self._save_outbox(job)
