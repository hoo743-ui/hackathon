#!/usr/bin/env bash
# start_server.sh 로 띄운 백엔드·웹 종료 (DB/MQTT 컨테이너는 유지: 완전 종료는 scripts/infra-down.sh)
ROOT="$(cd "$(dirname "$0")" && pwd)"
for n in backend web; do
  f="$ROOT/logs/$n.pid"
  if [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; then
    pkill -P "$(cat "$f")" 2>/dev/null; kill "$(cat "$f")" 2>/dev/null && echo "stopped $n"
  fi
  rm -f "$f"
done
