#!/bin/sh
# Start a local Postgres on the port .env expects.
#
# Docker Compose is the documented path and is what CI uses. Where Docker is not
# installed, this falls back to a native cluster on the same port with the same
# credentials, so DATABASE_URL is identical either way and no test learns which
# one it is talking to.
#
# The native cluster lives outside the repository ($CMS_DATA_HOME, default
# ~/.local/share/cms-v2): a checkout in a synced folder (iCloud Documents,
# OneDrive) must never hold live database files. A cluster an older version
# made in .localpg/ keeps being used.
set -eu

PORT="${CMS_PG_PORT:-54329}"
case "$PORT" in ''|*[!0-9]*) echo "CMS_PG_PORT must be a TCP port from 1 to 65535." >&2; exit 1 ;; esac
if [ "${#PORT}" -gt 5 ] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "CMS_PG_PORT must be a TCP port from 1 to 65535." >&2; exit 1
fi
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -d "$REPO/.localpg" ]; then DATA="$REPO/.localpg"; else DATA="${CMS_DATA_HOME:-$HOME/.local/share/cms-v2}/postgres"; fi

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ "$PORT" != 54329 ]; then
    echo "Docker Compose uses port 54329. Use that port or start an isolated native cluster for another port." >&2
    exit 1
  fi
  echo "starting Postgres with Docker Compose"
  docker compose up -d db
  exit 0
fi

echo "Docker is unavailable — starting a native cluster in $DATA"
PGBIN=""
for candidate in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do
  if [ -x "$candidate/pg_ctl" ]; then PGBIN="$candidate"; break; fi
done
if [ -z "$PGBIN" ]; then
  echo "No Postgres 16 found. Install Docker, or: brew install postgresql@16" >&2
  exit 1
fi

export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"

if [ ! -d "$DATA" ]; then
  mkdir -p "$(dirname "$DATA")"
  "$PGBIN/initdb" -D "$DATA" -U cms --encoding=UTF8 >/dev/null
fi

if "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  RUNNING_PORT="$(sed -n '4p' "$DATA/postmaster.pid")"
  if [ "$RUNNING_PORT" != "$PORT" ]; then
    echo "This CMS cluster is already running on port $RUNNING_PORT. Retry with CMS_PG_PORT=$RUNNING_PORT; no data was changed." >&2
    exit 1
  fi
  echo "already running on port $PORT"
else
  "$PGBIN/pg_ctl" -D "$DATA" \
    -o "-p $PORT -k $DATA -c listen_addresses=127.0.0.1" \
    -l "$DATA/server.log" start
fi

"$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U cms -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='cms_dev'" | grep -q 1 \
  || "$PGBIN/createdb" -h 127.0.0.1 -p "$PORT" -U cms cms_dev

echo "Postgres ready on 127.0.0.1:$PORT (database cms_dev)"
