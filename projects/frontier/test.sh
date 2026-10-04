#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${DATABASE_URL:-}" && -z "${FRONTIER_DATABASE_URL:-}" && -f ../../.runtime/database.env ]]; then
  set -a
  source ../../.runtime/database.env
  set +a
fi
exec .venv/bin/python -m pytest api/test_api.py -q "$@"
