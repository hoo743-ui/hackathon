#!/usr/bin/env bash
# PostgreSQL + Mosquitto 기동 → DB 마이그레이션 → 초기 데이터
source "$(dirname "$0")/_common.sh"
ensure_docker
compose up -d --wait postgres mosquitto
cd "$ROOT/backend"
.venv/bin/alembic upgrade head
.venv/bin/python -m app.database.seed
echo "✅ 인프라 준비 완료 (postgres:5432, mosquitto:1883)"
