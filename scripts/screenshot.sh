#!/usr/bin/env bash
# 시각 QA 스크린샷 (정확한 뷰포트 폭 + 콘솔 오류 + 가로 넘침 검사). 사용법: scripts/screenshot.py 상단 참고
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT/backend/.venv/bin/python" "$ROOT/scripts/screenshot.py" "$@"
