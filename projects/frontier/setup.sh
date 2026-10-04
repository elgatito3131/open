#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${DATABASE_URL:-}${FRONTIER_DATABASE_URL:-}" ]]; then
  ../../scripts/postgres.sh start
  source ../../.runtime/database.env
fi
if [[ ! -x .venv/bin/python ]]; then
  if [[ -z "${PYTHON:-}" ]]; then
    for candidate in python3.12 python3.13 python3; do
      if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; assert (3,12) <= sys.version_info < (3,14)' 2>/dev/null; then
        PYTHON="$candidate"; break
      fi
    done
  fi
  if [[ -z "${PYTHON:-}" ]]; then echo 'Install Python 3.12–3.13 or set PYTHON to its executable.' >&2; exit 1; fi
  "$PYTHON" -c 'import sys; sys.exit(0 if (3,12) <= sys.version_info < (3,14) else "Frontier requires Python 3.12–3.13.")'
  "$PYTHON" -m venv .venv
fi
.venv/bin/python -c 'import sys; sys.exit(0 if (3,12) <= sys.version_info < (3,14) else "Frontier requires Python 3.12–3.13. Recreate .venv with a supported interpreter.")'
requirements=requirements.txt
if [[ -f requirements.lock ]]; then requirements=requirements.lock; fi
.venv/bin/python -m pip install -r "$requirements"
npm ci --no-fund
.venv/bin/python -m api.seed --embeddings
npm run build
echo 'Frontier is ready. Run ./run.sh, then open http://127.0.0.1:4202.'
