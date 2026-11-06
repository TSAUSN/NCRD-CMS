#!/bin/sh
# Direct Node entrypoints do not download a package manager during startup and
# receive SIGTERM directly. The package dependencies were installed at build.
set -eu
role="${1:-admin}"
if [ "$#" -gt 0 ]; then shift; fi
case "$role" in
  admin)
    cd /app/apps/admin
    PORT="${PORT:-3000}" exec node node_modules/next/dist/bin/next start "$@"
    ;;
  site)
    cd /app/apps/site
    PORT="${PORT:-3001}" exec node node_modules/next/dist/bin/next start "$@"
    ;;
  worker)
    cd /app/apps/worker
    exec node --experimental-strip-types src/main.ts "$@"
    ;;
  worker-http)
    cd /app/apps/worker
    exec node --experimental-strip-types src/http.ts "$@"
    ;;
  migrate)
    cd /app/packages/schema
    exec node --experimental-strip-types src/migrate/cli.ts "$@"
    ;;
  drain)
    cd /app/apps/worker
    exec node --experimental-strip-types src/drain.ts "$@"
    ;;
  seed)
    cd /app/packages/seeds
    exec node --experimental-strip-types src/seed-database.ts "$@"
    ;;
  *)
    echo "unknown role: $role" >&2
    echo "usage: <admin|site|worker|worker-http|migrate|drain|seed>" >&2
    exit 64
    ;;
esac
