# Refactor gates

Run the original and changed builds against the same local fixture and media.
Keep the fixture, screenshots, raw traces and ticket state outside Git. Never
reuse a development, review or hosted database. The
[fixture guide](../handbook/maintainers/refactor-gates.md) explains how to
restore the private archive into empty databases and verify the copy.

Start with Node 24, the pinned pnpm, and Postgres 16 on loopback. Use a dedicated
`CMS_DATA_HOME` for the native cluster. Set `LC_ALL=en_US.UTF-8` on macOS.
Set `V1_ROOT` to the approved source checkout; it must contain the generated
section catalogue. Do not point tests at a live site or change a test to pass
without its source. The ordinary fixture suites do not opt into the separate
retained-demo checks.

```sh
pnpm check:node
pnpm typecheck
pnpm format:check
pnpm -r --workspace-concurrency=1 --no-bail test --maxWorkers=2
node --test scripts/*.test.mjs scripts/golden/*.test.mjs
TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/postgres pnpm test:db --maxWorkers=2
pnpm --filter admin --filter site build
```

The DB suite creates and drops its own test databases. Pass the isolated local
cluster's `postgres` connection for this command. Keep the golden and screen
fixture URLs separate from it.

Set `E2E_DATABASE=cms_e2e_refactor` and choose two free browser ports with
`E2E_ADMIN_PORT` and `E2E_SITE_PORT`. Run Chromium, no-mail and WebKit
sequentially. Do not set `E2E_ALLOW_STALE_BUILD` or reuse existing servers.

```sh
pnpm test:e2e
pnpm --filter e2e exec playwright test --config playwright.no-mail.config.ts
RELEASE_BROWSERS=1 pnpm --filter e2e exec playwright test --project=webkit
```

Use `pnpm --filter e2e exec playwright install chromium webkit` if the
browsers are missing. The browser configuration keeps one worker.

Capture the pristine test-title inventory and check it against the changed
build. The inventory counts duplicate titles; moving a test to a different
file preserves its full title. Use the same source opt-ins and explicit disposable database URL on both checkouts.

```sh
export TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/postgres
CMS_TEST_CHECKOUT="$PRISTINE_CHECKOUT" node scripts/test-inventory.mjs capture "$PRIVATE/test-inventory.json"
node scripts/test-inventory.mjs check "$PRIVATE/test-inventory.json"
```

Use `CMS_GOLDEN_CHECKOUT` to run the current harness against an already built,
pristine checkout. Compare two pristine captures before trusting the oracle.
The render oracle checks the original HTML, assets, previews and SQL plus
public response status, cache control, entity tag, CSP, Vary and redirect
location. It also exercises conditional, missing, redirect, HEAD,
query-string and non-staging requests over the loopback site server. Next.js
derives weak ETags for static files from size and modification time. When
comparing different checkouts, verify the public static file bytes and give
identical inputs matching modification times. The oracle compares the actual
response values without rewriting them.

Use `--reference` on the second and later admin screen captures. The reference
checks exact pixels and computed styles at 1440, 1024 and 900 pixels and records
stylesheet link order. Use the natural browser clock: mocking navigation timing can prevent the
isolated preview from opening. Review differences in images, styles and stylesheet ordering before
accepting the change.

The visual oracle uses the installed Playwright WebKit build and requires the
same engine version on both sides. A focused repeat reproduced pixel noise in
Chromium on unchanged content; WebKit repeated those screens exactly. Both
engines still run the full browser test suites. No image pixels are masked.
Computed style hashes sort property names without changing their values.

Each direct route starts with a fresh renderer. When a visible preview is
present, compare two raw frames after the browser has had time to repaint.
A changed pixel still fails the comparison, even in a preview.
