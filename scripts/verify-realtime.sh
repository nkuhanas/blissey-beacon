#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Isolated database/Realtime. Live Gemini is explicit and sends only synthetic facts.
mode=${1:-}
if [ "$#" -gt 1 ] || { [ -n "$mode" ] && [ "$mode" != "--live-gemini" ]; }; then
  echo "Usage: sh scripts/verify-realtime.sh [--live-gemini]" >&2
  exit 2
fi
if [ "$mode" = "--live-gemini" ]; then test -f .env.deploy.local; fi
docker compose build toolchain
docker compose run --rm toolchain pnpm --filter @blissey/backend realtime:prepare
realtime_compose() {
  if [ "$mode" = "--live-gemini" ]; then
    LIVE_GEMINI_CHECK=1 docker compose -p blissey-slice2-realtime --env-file .env.deploy.local --env-file .env.realtime -f compose.realtime.yaml "$@"
  else
    LIVE_GEMINI_CHECK=0 docker compose -p blissey-slice2-realtime --env-file .env.realtime -f compose.realtime.yaml "$@"
  fi
}
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$result" -ne 0 ]; then realtime_compose logs --tail 80 realtime; fi
  realtime_compose down --volumes
  exit "$result"
}
trap cleanup EXIT INT TERM
realtime_compose run --build --rm realtime-check
