"""(개발용 · 시연 프로그램에 포함되지 않음) 재질 2차 판정기 학습.

공개 쓰레기 데이터셋 TrashNet(glass/metal/paper/cardboard/plastic/trash)으로
CLIP(ViT-B-32, LAION-2B 사전학습) 이미지 특징 위에 선형 분류기를 학습해 models/verifier_trashnet.npz 로 저장한다.
YOLO(best_model.pt)는 그대로 두고, YOLO 가 잡은 영역을 다시 확인하는 용도.

python tools/train_verifier.py --data <dataset-resized 폴더> [--seed 0]
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image

CLASSES = ["glass", "metal", "paper", "plastic", "other"]
FOLDER_TO_CLASS = {"glass": "glass", "metal": "metal", "paper": "paper", "cardboard": "paper", "plastic": "plastic", "trash": "other"}
CLIP_MODEL, CLIP_PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"
ZS_PROMPTS = {
    "glass": "a photo of a glass bottle or glass jar",
    "metal": "a photo of a metal can or aluminum can",
    "paper": "a photo of paper or cardboard",
    "plastic": "a photo of a plastic bottle or plastic container",
    "other": "a photo of general trash",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "models" / "verifier_trashnet.npz"))
    a = ap.parse_args()
    import open_clip

    dev = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    model, _, preprocess = open_clip.create_model_and_transforms(CLIP_MODEL, pretrained=CLIP_PRETRAINED, device=dev)
    model.eval()
    tok = open_clip.get_tokenizer(CLIP_MODEL)

    items = []
    for folder, cls in FOLDER_TO_CLASS.items():
        for p in sorted((Path(a.data) / folder).glob("*.jpg")):
            items.append((p, CLASSES.index(cls)))
    print(f"이미지 {len(items)}장 · 장치 {dev}")
    t = time.time()
    feats = []
    with torch.no_grad():
        for i in range(0, len(items), 64):
            batch = torch.stack([preprocess(Image.open(p).convert("RGB")) for p, _ in items[i : i + 64]]).to(dev)
            f = model.encode_image(batch)
            feats.append((f / f.norm(dim=-1, keepdim=True)).float().cpu())
        text = model.encode_text(tok([ZS_PROMPTS[c] for c in CLASSES]).to(dev))
        text = (text / text.norm(dim=-1, keepdim=True)).float().cpu()
    X = torch.cat(feats)
    y = torch.tensor([c for _, c in items])
    print(f"특징 추출 {time.time() - t:.0f}초")

    # 클래스별 80/20 분할 (재현 가능)
    rng = random.Random(a.seed)
    tr, te = [], []
    for c in range(len(CLASSES)):
        idx = [i for i in range(len(y)) if y[i] == c]
        rng.shuffle(idx)
        k = int(len(idx) * 0.8)
        tr += idx[:k]
        te += idx[k:]
    tr, te = torch.tensor(tr), torch.tensor(te)

    def report(name, pred):
        acc = (pred[te] == y[te]).float().mean().item()
        cm = np.zeros((len(CLASSES), len(CLASSES)), int)
        for t_, p_ in zip(y[te].tolist(), pred[te].tolist()):
            cm[t_, p_] += 1
        per = {c: round(cm[i, i] / max(1, cm[i].sum()), 3) for i, c in enumerate(CLASSES)}
        print(f"{name}: 정확도 {acc:.3f} · 클래스별 {per}")
        return acc, per, cm

    zs_acc, zs_per, _ = report("CLIP 제로샷(학습 없음)", (X @ text.T).argmax(1))

    # 선형 분류기 (softmax, 가중치 감쇠) — 전체 배치 학습
    torch.manual_seed(a.seed)
    W = torch.zeros(X.shape[1], len(CLASSES), requires_grad=True)
    b = torch.zeros(len(CLASSES), requires_grad=True)
    counts = torch.bincount(y[tr], minlength=len(CLASSES)).float()
    weight = (counts.sum() / (len(CLASSES) * counts))  # 클래스 불균형 보정
    opt = torch.optim.Adam([W, b], lr=0.01, weight_decay=1e-4)
    scale = 30.0
    for _ in range(500):
        opt.zero_grad()
        loss = torch.nn.functional.cross_entropy(scale * (X[tr] @ W) + b, y[tr], weight=weight)
        loss.backward()
        opt.step()
    with torch.no_grad():
        logits = scale * (X @ W) + b
    lp_acc, lp_per, cm = report("TrashNet 학습 분류기", logits.argmax(1))
    print("혼동행렬 (행=정답, 열=예측)", CLASSES)
    print(cm)

    np.savez(a.out, W=W.detach().numpy().astype(np.float32), b=b.detach().numpy().astype(np.float32),
             scale=np.float32(scale), text=text.numpy().astype(np.float32), classes=np.array(CLASSES),
             clip=np.array([CLIP_MODEL, CLIP_PRETRAINED]))
    meta = {"dataset": "TrashNet (garythung/trashnet, dataset-resized)", "images": len(items), "train": len(tr), "test": len(te),
            "seed": a.seed, "zero_shot_acc": round(zs_acc, 4), "probe_acc": round(lp_acc, 4), "probe_per_class": lp_per,
            "zero_shot_per_class": zs_per, "clip": f"{CLIP_MODEL}/{CLIP_PRETRAINED}"}
    Path(a.out).with_suffix(".json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("저장:", a.out)


if __name__ == "__main__":
    main()
