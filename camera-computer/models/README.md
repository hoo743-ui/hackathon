# models/

학습된 YOLO 모델 `best_model.pt` 를 이 폴더에 둔다.

```
camera-computer/models/best_model.pt      ← .env 의 MODEL_PATH=models/best_model.pt
```

## Git 에 올리지 않는 이유
- `*.pt` 는 `.gitignore` 로 제외되어 있다. 학습 모델은 보통 수 MB ~ 수백 MB이며 GitHub 는 100MB 초과 파일을 거부한다.
- 현재 저장소(main)에는 `best_model.pt` 가 **포함되어 있지 않다** (2026-10-31 확인).

## 배포 방법 (택1)
1. **팀 공유 드라이브 / USB** 로 전달 후 이 폴더에 복사 (가장 간단, 해커톤 권장)
2. **GitHub Release 첨부 파일** 로 올리고 내려받기 (2GB 이하)
3. **Git LFS** — 버전 관리가 필요할 때:
   ```bash
   git lfs install
   git lfs track "camera-computer/models/*.pt"
   git add .gitattributes camera-computer/models/best_model.pt
   ```
   (LFS 는 저장소 저장 용량·대역폭 한도가 있으므로 팀 합의 후 사용)

## 확인
```bash
python test_yolo.py                 # 로딩 + 클래스 목록 + 기존 매핑 대조
python test_yolo.py --image 사진.jpg  # 단일 이미지 추론
```
기존 `yolo_arduino.py` 가 가정한 클래스: `0 Glass → 'G'`, `1 Metal → 'M'`, `2 Paper → 'P'`, `3 Plastic → 'L'`.
모델의 `names` 가 이와 다르면 `test_yolo.py` 가 WARN 으로 알려 준다 (모델·기존 코드는 수정하지 않는다).
