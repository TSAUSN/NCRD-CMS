# Run a fresh local demo from GitHub

Install the normal seeded demo in its own local database, without a private dump.

For: A maintainer with only this repository. Last checked: 2026-11-04.

**Most people only need two commands.** From a fresh clone, run `pnpm install`
and then `pnpm demo`. That builds what is needed, creates the local database,
seeds the example sites and starts the admin at http://localhost:3000. See the
[README](../../../README.md).

Use the procedure below only when you need a second, independent copy next to a
demo that is already running, for example to check that a clean clone works.
It runs on different ports and its own database, so it never disturbs the
running demo.

This disposable macOS procedure uses Admin 3500, public pages 3501, worker health
3502 and PostgreSQL 54330. It never connects to the retained demo on
3000/3001/54329. No hosted account, DNS, private run notes or restored database is
needed. Keep database files outside Git and synced folders. Do not run a reset.

## Tools

Have these commands on PATH before starting. The versions below are the matching
local toolchain for the verification process; package and browser versions come from the lockfile.

| Tool | Version used | Purpose |
| --- | --- | --- |
| Git | 2.50.1, Apple Git-155 | Clone and pull the branch |
| Node.js | 24.15.0, Node 24 required | Apps and native TypeScript worker |
| pnpm | 11.22.0 | Locked workspace installation and builds |
| PostgreSQL | 16.15 | `initdb`, `pg_ctl`, `psql`, `createdb`, `dropdb` |
| Worker Playwright | 1.62.1, Chromium revision 1234 | Worker page captures; installed by the command below |
| E2E Playwright | 1.64.1, Chromium revision 1248 | Separate acceptance captures and tests; not the worker CLI |
| POSIX shell | Apple Bash 3.2.57, invoked as `/bin/sh` | Run the setup commands |
| curl | 8.7.1 | Check loopback HTTP without depending on browser host resolution |
| lsof | 4.91 | Check ports and identify the copy's app processes |

On Apple Silicon, the checked PostgreSQL binaries are in
`/opt/homebrew/opt/postgresql@16/bin`; add that directory to PATH if necessary.
Node and pnpm must also resolve to the versions above in every terminal. A new
computer needs the tool installers, npm packages and Playwright browser download,
or matching trusted local caches. A cached install does not prove those downloads
are available on another computer. Docker is not required for this native procedure.

Use an existing trusted pnpm store with `pnpm install --offline --frozen-lockfile
--store-dir /ABSOLUTE/TRUSTED/STORE` only when all locked packages are available.
The Worker and E2E packages use different locked Chromium revisions; install the
matching browsers for both. Count migration files from the CLI receipt rather
than the highest numeric prefix.

## Get the branch and packages

Choose a new checkout path. If you already cloned this branch from GitHub, use
that checkout and start with `cd` below. Never copy another checkout's `.env`,
`node_modules`, build output or demo data.

```sh
TASK_CHECKOUT=/absolute/path/to/cms-v2-second-maintainer
git clone --branch main ORGANIZATION_REPOSITORY_URL "$TASK_CHECKOUT"
cd "$TASK_CHECKOUT"
git status --porcelain
git rev-parse HEAD
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter worker exec playwright install chromium
```

If package downloads are unavailable but this computer has the matching pnpm
store, retry `pnpm install --offline --frozen-lockfile`. State that the local store
was used. A missing browser cache still needs the locked Chromium download; do
not substitute a different browser binary silently.

## Create an independent native database and seed it

The example uses a disposable, unsynced directory. Stop if it already exists or
any listed port is occupied. Change the directory and all four ports together
when adapting this procedure; do not reuse a running installation.

```sh
TASK_DEMO_HOME=/private/tmp/cms-v2-second-maintainer-20261102
test ! -e "$TASK_DEMO_HOME"
if lsof -nP -iTCP:3500 -iTCP:3501 -iTCP:3502 -iTCP:54330 -sTCP:LISTEN; then
  echo 'A chosen port is in use. Stop here and choose other ports.'
fi
umask 077
mkdir -m 700 "$TASK_DEMO_HOME"
cat > "$TASK_DEMO_HOME/runtime.env" <<EOF
CMS_DATA_HOME=$TASK_DEMO_HOME
CMS_PG_PORT=54330
DATABASE_URL=postgres://cms:cms@127.0.0.1:54330/cms_demo
DATABASE_URL_AUTHENTICATED=postgres://cms_admin_app:devpassword@127.0.0.1:54330/cms_demo
DATABASE_URL_PUBLIC=postgres://cms_site_app:devpassword@127.0.0.1:54330/cms_demo
DATABASE_URL_WORKER=postgres://cms_worker_app:devpassword@127.0.0.1:54330/cms_demo
AUTH_PROVIDER=local
AUTH_SECRET=disposable-local-maintainer-only
CMS_LOCAL_TEST_MODE=true
ADMIN_ORIGIN=http://127.0.0.1:3500
PUBLIC_SITE_PORT=3501
WORKER_HEALTH_PORT=3502
MAILER_PROVIDER=recording
TRUST_PROXY_HEADERS=false
SCHEDULING_ENABLED=true
SCHEDULING_MONITORING_READY=true
MEDIA_PROVIDER=filesystem
MEDIA_ROOT=$TASK_DEMO_HOME/demo-media
NODE_ENV=production
EOF
printf '%s\n' cms > "$TASK_DEMO_HOME/init-password"
initdb -D "$TASK_DEMO_HOME/postgres" -U cms --encoding=UTF8 \
  --auth-local=trust --auth-host=scram-sha-256 \
  --pwfile="$TASK_DEMO_HOME/init-password"
rm "$TASK_DEMO_HOME/init-password"
pg_ctl -D "$TASK_DEMO_HOME/postgres" \
  -o "-p 54330 -k $TASK_DEMO_HOME/postgres -c listen_addresses=127.0.0.1" \
  -l "$TASK_DEMO_HOME/postgres/server.log" start
set -a
. "$TASK_DEMO_HOME/runtime.env"
set +a
pnpm --filter @cms/schema db:bootstrap
pnpm --filter admin exec node --conditions=react-server \
  --experimental-strip-types --no-warnings scripts/demo-data.ts
```

These credentials are disposable loopback demo identities. Bootstrap creates
`cms_demo`, applies every migration and provisions its runtime roles on the new
54330 cluster. Seeding reads the repository's normal demo sources; no dump is
restored. It can take a few minutes. Its printed examples use the default public
port 3001; the running copy below uses 3501. Keep using the addresses below.

Build serially from the checkout root:

```sh
pnpm --filter admin build
pnpm --filter site build
```

## Start Admin, public pages and the worker

Keep one process in each of three terminals. In each terminal, use the actual
checkout path and the same absolute environment-file path. Node 24 and PostgreSQL
16 tools must remain on PATH. This copy uses its own ports, so `pnpm demo` on
3000/3001 can keep running alongside it.

Admin terminal:

```sh
cd /absolute/path/to/cms-v2-second-maintainer/apps/admin
node --env-file=/private/tmp/cms-v2-second-maintainer-20261102/runtime.env \
  node_modules/next/dist/bin/next start --port 3500 --hostname 127.0.0.1
```

Public-site terminal:

```sh
cd /absolute/path/to/cms-v2-second-maintainer/apps/site
node --env-file=/private/tmp/cms-v2-second-maintainer-20261102/runtime.env \
  node_modules/next/dist/bin/next start --port 3501 --hostname 127.0.0.1
```

Worker terminal:

```sh
cd /absolute/path/to/cms-v2-second-maintainer/apps/worker
node --env-file=/private/tmp/cms-v2-second-maintainer-20261102/runtime.env \
  --experimental-strip-types --no-warnings src/main.ts
```

The worker reports health on 3502 and records mail locally. Keep it running for
scheduled work. Local login accepts the seeded addresses only:
`admin@example.test`, `editor@example.test`, `contributor@example.test`.

## Confirm the three apps

Open `http://127.0.0.1:3500/sign-in` and sign in as `admin@example.test`. Confirm
Home and the SAWSO/Echelon site entries. Open both public addresses:

- `http://sawso.staging.localhost:3501/`
- `http://echelon-chapters.staging.localhost:3501/`

Check the same routes through loopback when a browser does not resolve localhost
subdomains. The Host header chooses the site; no DNS edit is needed.

```sh
curl --noproxy '*' --fail http://127.0.0.1:3500/sign-in -o /dev/null
curl --noproxy '*' --fail -H 'Host: sawso.staging.localhost:3501' \
  http://127.0.0.1:3501/ -o /dev/null
curl --noproxy '*' --fail -H 'Host: echelon-chapters.staging.localhost:3501' \
  http://127.0.0.1:3501/ -o /dev/null
```

This is a normal seed, not a copy of reviewed retained authoring. Loading it does
not establish that it contains the retained private report, number changes or
replacement chapter photos. Reference comparisons and role acceptance are
separate checks.

The bundled Echelon site is the earlier red chapter-directory starter, with text
branding and labelled sample content. The normal seed now leaves optional photos
unselected on untouched initial chapter pages. It uses no other site's photos;
publication still refuses generic sample pictures. Generic templates retain their
explicit sample-image placeholders when creating a private draft. These changes
passed the focused seed and chapter checks; the final fresh setup repeat remains
incomplete as recorded above. The reviewed navy national composition is separately
assembled retained authoring and is not supplied by the normal seed.

## Stop and remove this copy's database

Press Ctrl+C in each of the three app terminals. Confirm their selected ports
have no listeners. From the setup terminal, remove only this independent
54330 database, then stop its native cluster:

```sh
dropdb --maintenance-db=postgres://cms:cms@127.0.0.1:54330/postgres cms_demo
pg_ctl -D /private/tmp/cms-v2-second-maintainer-20261102/postgres stop -m fast
```

Keep the checkout and logs if needed for review. The disposable data directory
can be removed after the cluster is stopped. None of these stop/drop commands
may be redirected to 54329 or the retained data directory. For a retained-data
restore rehearsal, follow [Local staging](local-staging.md) separately.
