#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Isolated project name and ephemeral test credentials. No production environment is read.
docker compose build toolchain
docker compose run --rm toolchain pnpm --filter @blissey/backend realtime:prepare
realtime_compose() { docker compose -p blissey-slice2-realtime --env-file .env.realtime -f compose.realtime.yaml "$@"; }
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then realtime_compose logs --tail 80 realtime; fi
  realtime_compose down --volumes
  exit "$result"
}
trap cleanup EXIT INT TERM
realtime_compose run --build --rm realtime-check
