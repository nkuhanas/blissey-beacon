#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then
  echo 'Usage: run-client.sh /absolute/path/to/config.json' >&2
  exit 2
fi
CLIENT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export PYTHONPATH="$CLIENT_ROOT/vendor:$CLIENT_ROOT"
exec python3 -m blissey_qnx --config "$1" run
