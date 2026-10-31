import sys
from pathlib import Path

# 저장소 루트에서 pytest edge/tests 로 실행해도 smartrecycle_edge 를 찾도록
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
