#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# No build, dependency installation or app startup on the one-shot path.
exec docker compose run --rm --no-deps -T toolchain node scripts/incident101.mjs "$@"
