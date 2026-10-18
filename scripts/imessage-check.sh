#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker compose run --rm toolchain sh -c '
  set -eu
  pnpm --filter @blissey/contracts build >&2
  pnpm --filter @blissey/backend build >&2
  exec node scripts/imessage-check.mjs "$@"
' sh "$@"
