# Prove a behavior-preserving refactor

For maintainers. Keep refactors on a separate branch. A tested branch can go
to an explicitly authorized personal review copy; production needs its own
verified release and approval. Keep the test and review data separate.

## Isolation and starting evidence

Use the assigned isolated checkout and branch. For example, set
`E2E_DATABASE=cms_e2e_refactor`, `E2E_ADMIN_PORT=3300` and `E2E_SITE_PORT=3301`.
Verify the ports and database before starting. Leave retained processes and
content alone. Run one browser suite at a time with at most two workers, and
respect the importer's machine load check.

The golden harness uses separate local databases `cms_e2e_refactor_golden` and
`cms_e2e_refactor_screens`. Restore the checksum-verified cleaned archive into
**empty** databases on the existing local test cluster, then apply current
migrations. Use matching media bytes. Do not run a general worker. Keep the
restore, dumps and private artifacts outside Git.

For a new fixture, first run the real database suite against the local test
cluster to establish migration-owned NOLOGIN roles. Use explicit local connection
arguments with `createdb --owner=cms_migration_owner`; refuse an existing target.
Dump the empty target before `pg_restore --single-transaction --exit-on-error
--no-owner --role=cms_migration_owner --dbname=EXPLICIT_LOCAL_TEST_URL PRIVATE_DUMP`.
Then run `DATABASE_URL=EXPLICIT_LOCAL_TEST_URL pnpm db:migrate`. Compare the source
receipt/table fingerprints. Never use `--clean`, demo reset or a retained database.
The Friday private archive/media locations and checksums are in the maintainer handoff.

## Render and schema oracle

Build current source first. The harness refuses a stale build, occupied ports,
non-local/non-test database and a non-private or Git-owned artifact directory.

```bash
export E2E_ADMIN_PORT=3300 E2E_SITE_PORT=3301
pnpm --filter admin --filter site build
export GOLDEN_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor_golden
TASK_GOLDEN=/ABSOLUTE/PRIVATE/golden
TASK_MEDIA=/ABSOLUTE/PRIVATE/reviewed-media
node --experimental-strip-types scripts/golden-render.mjs capture \
  --out "$TASK_GOLDEN/before" --media-root "$TASK_MEDIA" \
  --canvas-state "$TASK_GOLDEN/canvas-fixture.json"
```

Capture **before runtime changes**. It saves full public HTML/CSS for all 75 kept
routes, bytes of every owned asset, editing/visitor previews for all 75 pages,
eight real isolated-canvas documents (Education, national, Atlanta, Symposium),
`pg_dump --schema-only` and every `pg_get_functiondef` with owner/ACL.
Only pg_dump's random backslash-restrict transport guards are removed from the
schema oracle. No HTML, CSS, preview metadata or SQL statement is normalized.

Actual canvas tickets are issued by the normal local API. Their token/channel
and a future-dated **ten-minute fixture window** are held fixed in this disposable
fixture, with the real database constraint intact. This controls clock metadata
without editing renderer output. It never changes a production lifetime, grant,
function or account. The fixture command dumps before creating it. Private ticket
state and raw canvas HTML are credential material: keep them outside Git/logs,
never show tokens in screenshots, and remove them when the verification ends.

At a checkpoint, capture to a new `after-N` directory, reusing that private state:

```bash
node --experimental-strip-types scripts/golden-render.mjs capture \
  --out "$TASK_GOLDEN/after-N" --media-root "$TASK_MEDIA" \
  --canvas-state "$TASK_GOLDEN/canvas-fixture.json"
node --experimental-strip-types scripts/golden-render.mjs compare \
  --before "$TASK_GOLDEN/before" --after "$TASK_GOLDEN/after-N"
```

Compare the reported bytes and missing files. Determine whether differences
affect public markup, private preview metadata or a versioned asset. Inspect
the rendered pages before accepting changes. An expired fixture or changed
input needs a new baseline on the original source. Keep the raw comparison;
do not normalize a regression away.

## Admin and editor proof

```bash
export GOLDEN_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor_screens
node --experimental-strip-types scripts/golden-admin-screens.mjs \
  --out "$TASK_GOLDEN/admin-before" --media-root "$TASK_MEDIA"
```

The catalog covers every read-only route pattern plus the four real page editors
and story views, at 1440, 1024 and 900 px. One-time provider confirmation stays in the hosted
Super-admin-sign-in walk. It uses a natural browser clock, local auth/recording mail,
no external requests and no content edits. Task-specific readiness waits for real
preview/widget content, fonts and visible images; network-idle alone is not proof.
Compare the affected captures and inspect changes in the browser. Check CSS
load order and physically open and close the editor drawer at 900 px. Wait for
the actual images and preview before judging pixels. Walk the affected editor
actions and check the phone preview where relevant. Take database snapshots
before any test reset or edit.

For the separate worktree, use explicit test scope and bounded unit workers:

```bash
export TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/cms_e2e_refactor
export V1_ROOT=/ABSOLUTE/APPROVED/LOCAL/V1/COPY
pnpm -r --workspace-concurrency=1 test --maxWorkers=2
pnpm test:db --maxWorkers=2
```

Run relevant tests for each change. At a release checkpoint, run the full
Chromium and WebKit suites on the exact candidate with the approved local
source inputs. Keep assertions and timeouts intact. If you split an independent
journey, map its original test title to the replacement cases in the private
inventory so every assertion remains accountable. Record missing inputs,
baseline failures and new failures separately. A pre-existing failure is still
a failed check; do not use it to justify a production deployment.
