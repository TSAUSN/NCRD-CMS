#!/bin/sh
set -eu
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -d "$REPO/.localpg" ]; then DATA="$REPO/.localpg"; else DATA="${CMS_DATA_HOME:-$HOME/.local/share/cms-v2}/postgres"; fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose down
  exit 0
fi
for candidate in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do
  if [ -x "$candidate/pg_ctl" ]; then exec "$candidate/pg_ctl" -D "$DATA" stop; fi
done
echo "nothing to stop" >&2
