# models/

`best_model.pt` (학습된 YOLO 분류 모델)를 이 폴더에 둔다 → `MODEL_PATH=models/best_model.pt`.

- 모델 파일은 Git에 올리지 않는다 (`.gitignore`). 팀 공유 드라이브/USB로 전달한다.
- 기대 클래스 (기존 `yolo_arduino.py` 의 `CLASS_SIGNAL_MAP`): `0 Glass → G`, `1 Metal → M`, `2 Paper → P`, `3 Plastic → L`
- 확인: `python check_system.py --skip-camera` → "클래스 매핑" 항목이 PASS 인지 본다.
  다르면 실행 시 모델 `names`(이름) 기준으로 매핑하고 경고를 출력한다.
