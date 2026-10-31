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


class YoloRunner:
    def __init__(self, model_path: str, conf: float, target_ids: list[int] | None = None):
        from ultralytics import YOLO  # 무거운 import는 여기서

        self.model = YOLO(model_path)
        self.model_path = model_path
        self.conf = conf
        self.names: dict[int, str] = {int(k): str(v) for k, v in self.model.names.items()}
        self.target_ids = target_ids

    def __call__(self, frame):
        # 기존 코드: model(frame, conf=0.5, classes=[0,1,2,3]) — 모델 클래스 전체가 4개면 동일
        return self.model(frame, conf=self.conf, classes=self.target_ids or None, verbose=False)[0]
