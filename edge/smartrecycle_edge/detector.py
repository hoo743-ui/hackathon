"""YOLO 추론 + '투입 1회 = 분류 1회' 판정."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

log = logging.getLogger("edge.detect")


@dataclass
class Detection:
    class_id: int
    name: str
    confidence: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2 (픽셀)


def top_detection(result, names: dict[int, str]) -> Detection | None:
    """Ultralytics 결과에서 신뢰도 최고 객체 (boxes는 conf 내림차순 — 기존 코드의 boxes[0]과 동일)."""
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return None
    b = boxes[0]
    cls_id = int(b.cls[0])
    x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
    return Detection(cls_id, str(names.get(cls_id, cls_id)), float(b.conf[0]), (x1, y1, x2, y2))


class StableTrigger:
    """같은 클래스가 N프레임·최소 시간 연속 검출되면 1회 발화. 물체가 사라질 때까지(CLEAR_SEC) 잠금.

    - 손에 들고 흔들 때의 깜빡임/오검출 → 연속 조건으로 걸러냄
    - 같은 물체가 카메라 앞에 계속 있을 때 반복 분류 → 잠금으로 막음
    - 연속 투입 → cooldown(SEND_COOLDOWN) 이후, 물체가 바뀌거나 사라졌다 다시 나타나면 다음 1회
    """

    def __init__(self, frames: int, min_sec: float, clear_sec: float, cooldown: float):
        self.frames = max(1, frames)
        self.min_sec = min_sec
        self.clear_sec = clear_sec
        self.cooldown = cooldown
        self._cand: int | None = None
        self._count = 0
        self._since = 0.0
        self._locked_class: int | None = None
        self._last_seen = 0.0
        self._last_fire = -1e9

    def reset(self) -> None:
        self.__init__(self.frames, self.min_sec, self.clear_sec, self.cooldown)

    @property
    def locked(self) -> bool:
        return self._locked_class is not None

    def update(self, det: Detection | None, now: float | None = None, can_fire: bool = True) -> bool:
        now = time.monotonic() if now is None else now
        if det is None:
            if self._locked_class is not None and now - self._last_seen >= self.clear_sec:
                self._locked_class = None  # 물체가 빠져나감 → 다음 투입 허용
            self._cand, self._count = None, 0
            return False
        self._last_seen = now
        if self._locked_class is not None:
            if det.class_id == self._locked_class:
                return False
            self._locked_class = None  # 다른 물체로 바뀜
        if det.class_id != self._cand:
            self._cand, self._count, self._since = det.class_id, 1, now
        else:
            self._count += 1
        ready = self._count >= self.frames and now - self._since >= self.min_sec
        if ready and can_fire and now - self._last_fire >= self.cooldown:
            self._locked_class = det.class_id
            self._last_fire = now
            self._cand, self._count = None, 0
            return True
        return False


def pick_device(pref: str) -> str:
    """auto: NVIDIA CUDA → CPU. CUDA 가 있어도 실제 연산이 실패하면 CPU 로 (호환성 문제 대비).
    Apple MPS 는 간헐 오류가 있어 auto 에서 쓰지 않는다 (YOLO_DEVICE=mps 로 명시할 때만)."""
    pref = (pref or "auto").strip().lower()
    if pref not in ("", "auto"):
        return pref
    try:
        import torch

        if torch.cuda.is_available():
            torch.zeros(1).cuda()  # 드라이버/CUDA 호환 확인
            return "0"
    except Exception as exc:
        log.warning("GPU 사용 불가 → CPU: %s", exc)
    return "cpu"


def device_label(device: str) -> str:
    if device == "cpu":
        return "CPU"
    if device == "mps":
        return "GPU (Apple MPS)"
    try:
        import torch

        return f"GPU (CUDA: {torch.cuda.get_device_name(int(device))})"
    except Exception:
        return f"GPU ({device})"


class ModelLoadError(Exception):
    pass


class YoloRunner:
    """추론 전용(INFERENCE ONLY). 시작 시 한 번만 로드하고 학습·데이터셋·YAML 을 요구하지 않는다."""

    def __init__(self, model_path: str, conf: float, target_ids: list[int] | None = None,
                 device: str = "auto", imgsz: int = 640):
        try:
            from ultralytics import YOLO  # 무거운 import는 여기서

            self.model = YOLO(model_path, task="detect")
        except Exception as exc:
            raise ModelLoadError(f"모델을 불러올 수 없습니다 (파일 손상/형식 오류/버전 불일치 가능): {exc}") from exc
        self.model_path = model_path
        self.conf = conf
        self.imgsz = imgsz
        self.names: dict[int, str] = {int(k): str(v) for k, v in self.model.names.items()}
        self.target_ids = target_ids
        self.device = pick_device(device)
        self.device_label = device_label(self.device)
        self.camera_verified = False  # 실제 카메라 프레임으로 추론 성공했는지

    def warmup(self) -> None:
        import numpy as np

        try:
            self(np.zeros((self.imgsz, self.imgsz, 3), dtype=np.uint8))
        except Exception as exc:
            if self.device != "cpu":
                log.warning("%s 추론 실패 → CPU로 전환: %s", self.device_label, exc)
                self.device, self.device_label = "cpu", "CPU (GPU 실패 후 전환)"
                self(np.zeros((self.imgsz, self.imgsz, 3), dtype=np.uint8))
            else:
                raise ModelLoadError(f"모델 시험 추론 실패: {exc}") from exc

    def __call__(self, frame):
        # 기존 코드: model(frame, conf=0.5, classes=[0,1,2,3])
        return self.model(frame, conf=self.conf, classes=self.target_ids or None, imgsz=self.imgsz,
                          device=self.device, verbose=False)[0]
