#!/usr/bin/env bash
# 인프라 종료. 데이터까지 지우려면: scripts/infra-down.sh --volumes
source "$(dirname "$0")/_common.sh"
compose --profile full down "$@"
