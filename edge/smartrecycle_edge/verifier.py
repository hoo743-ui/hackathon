"""재질 2차 판정기 (선택) — YOLO 가 잡은 영역을 CLIP + TrashNet 학습 분류기로 다시 확인한다.

- YOLO(best_model.pt)는 그대로. 분류가 확정되는 순간(투입 1회당 1번)에만 실행 → 카메라 루프 속도 영향 거의 없음
- 판정기: CLIP ViT-B-32(LAION-2B 사전학습) 특징 + TrashNet 으로 학습한 선형 분류기 (models/verifier_trashnet.npz)
  TrashNet 검증(학습 미사용 20%) 정확도 0.919 — 흰 배경 데이터셋이므로 실제 카메라에서는 낮을 수 있음
- 배경 판정: CLIP 제로샷으로 '빈 천장/벽/사람' 같은 장면이면 쓰레기가 아니라고 보고 무시 (오인식 방지)
- 모델 가중치를 받을 수 없거나 오류가 나면 자동으로 꺼지고 YOLO 결과만 사용한다
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger("edge.verify")

BACKGROUND_PROMPTS = [
    "a photo of an empty ceiling",
    "a photo of a blank wall",
    "a photo of an empty floor",
    "a photo of a person's face",
    "a photo of a person",
    "a blurry photo of nothing",
]
OBJECT_PROMPTS = [
    "a photo of a bottle",
    "a photo of a can",
    "a photo of a piece of paper",
    "a photo of trash",
    "a photo of a cup",
    "a photo of a box",
]


@dataclass
class Verdict:
    top: str  # glass | metal | paper | plastic | other
    prob: float
    probs: dict[str, float]
    background: float  # 배경일 확률 (0~1)


class MaterialVerifier:
    def __init__(self, weights: Path, device: str = "cpu"):
        import open_clip
        import torch

        d = np.load(weights, allow_pickle=False)
        self.classes = [str(c) for c in d["classes"]]
        self.W = torch.from_numpy(d["W"])
        self.b = torch.from_numpy(d["b"])
        self.scale = float(d["scale"])
        name, pretrained = (str(x) for x in d["clip"])
        self.torch = torch
        self.device = device
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(name, pretrained=pretrained, device=device)
        self.model.eval()
        tok = open_clip.get_tokenizer(name)
        with torch.no_grad():
            t = self.model.encode_text(tok(BACKGROUND_PROMPTS + OBJECT_PROMPTS).to(device))
            self.prompts = (t / t.norm(dim=-1, keepdim=True)).float().cpu()
        self.n_bg = len(BACKGROUND_PROMPTS)
        log.info("2차 판정기 준비: CLIP %s/%s + TrashNet 분류기 (%s)", name, pretrained, ", ".join(self.classes))

    def __call__(self, bgr_crop) -> Verdict:
        from PIL import Image

        torch = self.torch
        img = Image.fromarray(bgr_crop[:, :, ::-1].copy())
        with torch.no_grad():
            f = self.model.encode_image(self.preprocess(img).unsqueeze(0).to(self.device))
            f = (f / f.norm(dim=-1, keepdim=True)).float().cpu()
            p = torch.softmax(self.scale * (f @ self.W) + self.b, dim=-1)[0]
            sims = torch.softmax(100.0 * (f @ self.prompts.T), dim=-1)[0]
        probs = {c: round(float(p[i]), 4) for i, c in enumerate(self.classes)}
        top = max(probs, key=probs.get)
        return Verdict(top, probs[top], probs, round(float(sims[: self.n_bg].sum()), 4))


def crop_box(frame, box, pad: float = 0.12):
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    x1, y1 = max(0, int(x1 - bw * pad)), max(0, int(y1 - bh * pad))
    x2, y2 = min(w, int(x2 + bw * pad)), min(h, int(y2 + bh * pad))
    if x2 - x1 < 8 or y2 - y1 < 8:
        return frame
    return frame[y1:y2, x1:x2]


def decide(yolo_name: str, yolo_conf: float, v: Verdict, *, bg_reject: float, override_prob: float, keep_conf: float) -> tuple[str | None, str]:
    """반환: (최종 재질 또는 None=무시, 판정 사유)."""
    y = yolo_name.strip().lower()
    if v.background >= bg_reject:
        return None, f"배경으로 판단({v.background:.2f}) → 무시"
    if v.top == y:
        return y, f"일치({v.prob:.2f})"
    if v.top in ("glass", "metal", "paper", "plastic") and v.prob >= override_prob and yolo_conf < keep_conf:
        return v.top, f"재질 보정 {y}→{v.top}({v.prob:.2f})"
    return y, f"YOLO 유지(판정기 {v.top} {v.prob:.2f})"
