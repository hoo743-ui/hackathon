#!/usr/bin/env bash
# 백엔드까지 전부 Docker로 실행 (로컬 uvicorn 대신). 포트 8000 충돌 주의.
source "$(dirname "$0")/_common.sh"
ensure_docker
compose --profile full up -d --build --wait
echo "✅ http://localhost:${API_PORT:-8000}/docs"
