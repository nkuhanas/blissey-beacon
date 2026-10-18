#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Credentials stay in a mounted, ignored dotenv file, never shell-sourced or baked in.
docker compose run --build --rm toolchain sh -c '
  set -eu
  pnpm install --frozen-lockfile --store-dir /pnpm/store >&2
  pnpm --filter @blissey/contracts build >&2
  pnpm --filter @blissey/simulator build >&2
  exec node scripts/demo.mjs "$@"
' sh "$@"
