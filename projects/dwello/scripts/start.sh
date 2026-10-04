#!/usr/bin/env bash
set -euo pipefail
DWELLO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DWELLO_ROOT"
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -n "${DWELLO_DATABASE_URL:-}" ]]; then
    export DATABASE_URL="$DWELLO_DATABASE_URL"
  else
    bash ../../scripts/postgres.sh start
    # shellcheck disable=SC1091
    source ../../.runtime/database.env
    export DATABASE_URL="$DWELLO_DATABASE_URL"
  fi
fi
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
exec npm run dev
