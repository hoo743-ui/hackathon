#!/usr/bin/env bash
# 공통: 저장소 루트, .env 확인, compose 래퍼
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/.env" ]]; then
  echo "❌ .env 가 없습니다. 먼저 scripts/setup.sh 를 실행하세요." >&2
  exit 1
fi
compose() { docker compose --env-file "$ROOT/.env" -f "$ROOT/infrastructure/docker-compose.yml" "$@"; }
ensure_docker() {
  docker info >/dev/null 2>&1 && return 0
  if command -v colima >/dev/null; then
    echo "Docker 엔진 시작 (colima)..."; colima start --cpu 2 --memory 4
  else
    echo "❌ Docker 엔진이 실행 중이 아닙니다. 'brew install colima docker docker-compose' 후 다시 실행하세요." >&2
    exit 1
  fi
}
