#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--realtime" ]; }; then
  echo 'Usage: sh scripts/verify.sh [--realtime]' >&2
  exit 2
fi
# The verification stack requires a fresh disposable database. Never uses hosted DBs.
docker compose rm --stop --force test-db
docker compose build toolchain
cleanup() {
  result=$?
  trap - EXIT INT TERM
  docker compose rm --stop --force test-db
  exit "$result"
}
trap cleanup EXIT INT TERM
docker compose run --rm verify
if [ "${1:-}" = '--realtime' ]; then sh scripts/verify-realtime.sh; fi
