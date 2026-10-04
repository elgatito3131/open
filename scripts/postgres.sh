#!/usr/bin/env bash
# A private, password-protected local cluster. Never enables a login service.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME="$ROOT/.runtime"
PGDATA="$RUNTIME/postgres"
ACTION="${1:-start}"
umask 077
mkdir -p "$RUNTIME"

if [[ -z "${PG_BIN:-}" ]]; then
  for candidate in /opt/homebrew/opt/postgresql@18/bin /usr/local/opt/postgresql@18/bin /usr/lib/postgresql/18/bin; do
    if [[ -x "$candidate/pg_ctl" ]]; then PG_BIN="$candidate"; break; fi
  done
fi
if [[ -z "${PG_BIN:-}" ]] && command -v pg_config >/dev/null 2>&1; then
  PG_BIN="$(pg_config --bindir)"
fi
if [[ ! -x "${PG_BIN:-}/pg_ctl" ]]; then
  echo 'PostgreSQL is required. On macOS: brew install postgresql@18 pgvector' >&2
  echo 'On other systems install PostgreSQL with pgvector, or set PG_BIN to its bin directory.' >&2
  exit 1
fi

if [[ "$ACTION" == stop ]]; then
  if "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast -w stop
  else echo 'The learning database is already stopped.'; fi
  exit 0
fi
if [[ "$ACTION" == status ]]; then
  "$PG_BIN/pg_ctl" -D "$PGDATA" status
  exit $?
fi
if [[ "$ACTION" != start ]]; then echo 'Usage: postgres.sh [start|stop|status]' >&2; exit 2; fi

if [[ ! -f "$RUNTIME/database.env" ]]; then
  if [[ -f "$PGDATA/PG_VERSION" ]]; then
    echo 'database.env is missing for an existing cluster; refusing to replace credentials.' >&2; exit 1
  fi
  python3 - "$RUNTIME" "${OPEN_PG_PORT:-55432}" <<'PY'
import pathlib,secrets,sys
root=pathlib.Path(sys.argv[1]); port=int(sys.argv[2])
if not 1024 <= port <= 65535: raise SystemExit('OPEN_PG_PORT must be 1024–65535')
password=secrets.token_hex(24)
(root/'pg-password').write_text(password+'\n')
lines=[f"export PGHOST='127.0.0.1'",f"export PGPORT='{port}'", "export PGUSER='open_local'",f"export PGPASSWORD='{password}'"]
for name in ['dwello','frontier']:
    lines.append(f"export {name.upper()}_DATABASE_URL='postgresql://open_local:{password}@127.0.0.1:{port}/{name}'")
(root/'database.env').write_text('\n'.join(lines)+'\n')
PY
fi
# shellcheck disable=SC1091
source "$RUNTIME/database.env"

if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
  "$PG_BIN/initdb" -D "$PGDATA" --username=open_local --pwfile="$RUNTIME/pg-password" \
    --auth=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
  cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = $PGPORT
unix_socket_directories = ''
max_connections = 30
shared_buffers = '64MB'
EOF
fi
if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$RUNTIME/postgres.log" -w start
fi
for database in dwello frontier; do
  exists="$("$PG_BIN/psql" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$database'")"
  if [[ "$exists" != 1 ]]; then "$PG_BIN/createdb" "$database"; fi
done
echo "Learning databases ready on 127.0.0.1:$PGPORT. Credentials are in ignored .runtime/database.env."
