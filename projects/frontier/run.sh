#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${DATABASE_URL:-}${FRONTIER_DATABASE_URL:-}" ]]; then
  ../../scripts/postgres.sh start
  source ../../.runtime/database.env
fi
if [[ ! -x .venv/bin/python || ! -f .next/BUILD_ID ]]; then
  echo 'Run ./setup.sh first (dependencies, local embedding model, and production build).' >&2; exit 1
fi
# Fail before starting either child if a port belongs to another process.
.venv/bin/python - <<'PY'
import socket
for port in (4202,4203):
    with socket.socket() as s:
        try: s.bind(('127.0.0.1',port))
        except OSError: raise SystemExit(f'Port {port} is already in use. No existing process was stopped.')
PY
API_PID=''; WEB_PID=''
cleanup() {
  [[ -z "$API_PID" ]] || kill "$API_PID" 2>/dev/null || true
  [[ -z "$WEB_PID" ]] || kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
.venv/bin/python -m uvicorn api.main:app --host 127.0.0.1 --port 4203 &
API_PID=$!
echo 'Starting the Frontier API…'
.venv/bin/python - "$API_PID" <<'PY'
import os,sys,time
from urllib.request import urlopen
pid=int(sys.argv[1])
for attempt in range(120):
    try:
        os.kill(pid, 0)
        with urlopen('http://127.0.0.1:4203/api/health', timeout=1) as response:
            if response.status == 200: break
    except ProcessLookupError:
        raise SystemExit('Frontier API exited during startup. Check the error above.')
    except OSError:
        if attempt and attempt % 15 == 0: print('Still preparing the local API…', flush=True)
        time.sleep(1)
else:
    raise SystemExit('Frontier API did not become ready within two minutes. No frontend was started.')
PY
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 4202 &
WEB_PID=$!
echo 'Frontier: http://127.0.0.1:4202 · Ctrl+C stops this app; saved database records remain.'
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do sleep 1; done
echo 'A Frontier process exited; stopping its companion process.' >&2
exit 1
