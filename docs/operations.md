# Operations

Running, testing, hosting and recovering CMS V2. The system itself is described
in [architecture.md](architecture.md).

**Production-site boundary:** this CMS is independent of Salvation Army live
websites. Demo archives are local copies of the maintainer’s rebuilds/files.
Do not use Salvation Army credentials, attach their production domains, or
access Zesty/cPanel to edit live pages for CMS development or hosting. The
deployment kit prepares a separate CMS staging environment only; it never
deploys or connects production websites.

## Requirements

Node 24 (pinned in `.nvmrc`; `pnpm check:node` refuses another major), pnpm 11
(`packageManager`), and Postgres 16 — Docker if present, otherwise
`brew install postgresql@16`. Run `pnpm install` once.

## The demo

```bash
pnpm demo              # start everything (rebuilds missing or stale app builds)
pnpm demo --build      # rebuild after changing code
pnpm demo --reset      # start again from the archives in demo/
```

Admin at http://localhost:3000 (sign in as `admin@example.test`,
`editor@example.test` or `contributor@example.test`); sites at
`http://hni.staging.localhost:3001`, `http://echelon.staging.localhost:3001`,
`http://bt2027-r8.staging.localhost:3001` and
`http://echelon-chapters.staging.localhost:3001`. The fictional event is a test fixture. The demo uses its own database
(`cms_demo`) and keeps its media in `~/.local/share/cms-v2/demo-media`, so
development data is untouched. Use screen sharing for a remote demonstration.
Local sign-in is deliberately restricted to loopback; a public tunnel does not
provide a supported remote login. Remote hands-on access requires the separate
hosted identity and environment described below.

If this CMS native cluster is already running on a different port, startup
names that port and refuses to use another database silently. For example,
`CMS_PG_PORT=54330 pnpm demo` reuses this cluster's existing `cms_demo` and media.
The override applies to all four database identities. Docker Compose retains
its declared port 54329. Never stop or reset an unrelated review cluster to
free that port. `pnpm demo` checks app/shared source and configuration against
both build timestamps, so an old production build cannot silently conceal
newer editing features. Documentation and test changes alone do not rebuild.

The retained Friday demo uses `CMS_DATA_HOME=/private/tmp/cms-v2-live-adaptation-demo`
and `CMS_PG_PORT=54329`. Use `pnpm demo --build` with those variables; never
reset that data. Browser suites use isolated test databases, never `cms_demo`.
On the fanless demo Mac, run one engine at a time with at most two workers;
pause heavy work if load stays above 12.

## Development

```bash
pnpm db:up            # Postgres on 127.0.0.1:54329 (Docker, or a native cluster)
cp .env.example .env
pnpm db:bootstrap     # migrations + the local login for each database identity
pnpm db:seed          # one site, one published page, three people
pnpm dev:site         # http://demo.staging.localhost:3001
pnpm dev:admin        # http://localhost:3000 (sign in as editor@example.test)
pnpm dev:worker       # health at http://localhost:3002/health
```

The native cluster lives in `~/.local/share/cms-v2/postgres` (or
`$CMS_DATA_HOME`), never inside the repository: a checkout in a synced folder
(iCloud, OneDrive) must not hold live database files. `pnpm db:down` stops it.
Every command loads `.env` if present; variables already set win.

`*.staging.localhost` addresses resolve to this machine in Chrome, Edge,
Firefox and Safari. A production build refuses the local sign-in unless
`CMS_LOCAL_TEST_MODE=true` and both the database and `ADMIN_ORIGIN` are on
loopback — never set that flag on a deployment.

## Tests

```bash
pnpm typecheck
pnpm test             # unit and golden tests
pnpm test:db          # real Postgres as the real roles; needs TEST_DATABASE_URL
pnpm test:e2e         # builds a throwaway database and drives Chromium
pnpm test:release     # full Chromium/Firefox/WebKit, fresh DB per browser
pnpm verify           # all of the above plus both production builds
node --test scripts/demo-build.test.mjs # stale-demo startup regression
```

`TEST_DATABASE_URL` points at the local cluster's `postgres` database; the
harness creates and drops its own databases. Never point it, or the general
worker, at a database holding real or review content.

Release journeys deliberately edit and publish test content. Run browser suites
one at a time; they share `cms_e2e`. `test:release` resets its own isolated data
before each browser. Set `V1_ROOT` to the local licensed V1 checkout to include
the source-dependent comparisons; do not fetch production pages for them.

Playwright 1.64.1 bundles Firefox r1555, whose focus-emulation regression can
trap focus inside a frame ([upstream #43280](https://github.com/microsoft/playwright/issues/43280)).
Until the bundled stable browser includes the fix, set
`CMS_E2E_FIREFOX_EXECUTABLE` to an official Firefox r1562 executable when running
`test:release`. This changes only the Firefox test binary; every spec and focus
assertion still runs. The October 28 local gate uses the official macOS arm64
archive from `https://cdn.playwright.dev/dbazure/download/playwright/builds/firefox/1562/firefox-mac-arm64.zip`
(SHA-256 `1cd48efcdf489e0fe303f2be94277401b93ccca3f346db7a43991ab5355b0454`).
Keep downloaded test browsers outside tracked source. Remove the override once
the bundled browser passes the source-organizer click/type/save/reload journey.

### Running a subset

Browser tests drive the built apps with `next start`, so build first. They
refuse to run when the admin or site build is older than the source.

| To run | Command |
| --- | --- |
| Every unit test | `pnpm test` |
| One package's unit tests | `pnpm --filter @cms/renderer test` |
| One unit test file | `pnpm --filter admin exec vitest run src/app/auth-actions.test.ts` |
| Database tests | `TEST_DATABASE_URL=postgres://cms:cms@127.0.0.1:54329/postgres pnpm test:db` |
| Build before browser tests | `pnpm --filter admin --filter site build` |
| All browser tests (Chromium) | `pnpm test:e2e` |
| One browser spec | `pnpm --filter e2e exec playwright test specs/page-history.spec.ts` |
| One browser test by name | `pnpm --filter e2e exec playwright test -g "restores"` |
| Safari (WebKit) | `RELEASE_BROWSERS=1 pnpm --filter e2e exec playwright test --project=webkit` |
| A failed test's trace | `pnpm --filter e2e exec playwright show-trace e2e/test-results/<test>/trace.zip` |
| Formatting | `pnpm format` (CI runs `pnpm format:check`) |

Browser tests use their own `cms_e2e` database and ports 3200 and 3201. They
never reuse a server that is already running unless `E2E_REUSE_SERVER=1` is
set. Detailed historical verification receipts are retained in the private
handoff outside Git.

The repository is private on a free GitHub plan with 2,000 Actions minutes a
month. CI runs the quick checks (types, styles, formatting, unit, database and
build) on every pull request. The browser suite, which takes much longer, runs
on pushes to `main`, on manual runs and on pull requests labelled `run-e2e`;
the reference images build only on `main` and manual runs. Changes to Markdown
and `docs/` alone do not start CI. Verify locally, push in batches, and add
`[skip ci]` to commit messages when the month's minutes are spent.

## Connecting an existing website

This imports **local files** as a private copy. It does not use a website's
credentials, contact Zesty/cPanel or attach its live domain. `--domain` only
helps recognise source addresses in the files being read.

```bash
pnpm import:website <folder> --name "Site name" --slug short-name \
  [--pages index.html,about.html] [--domain example.org] [--kind event] [--out file]
```

The folder is the site's built pages, stylesheets and files (for a PHP site,
save the rendered HTML first). The command only reads it, and writes
`<slug>.cms-site.json` and `<slug>.cms-site.report.md`. Read the report, then
in the admin choose **Create a site → Import an existing site**, review the
private draft, fix what the report lists, and publish. `--domain` names the
site's own domain so full addresses on it are read from the folder. To decide
what becomes editable instead of accepting the proposals, mark the HTML first
with `data-cms-section="Name"`, `data-cms-editable="text|richtext|image|link"`
plus `data-cms-id="field-name"`, and `data-cms-frame="header|footer"`
([ADR 0011](adr/0011-connecting-existing-sites.md)).

Moving a whole site between installations uses the content archive: **Site
settings → Download content archive**, then **Import an existing site**.

## Hosting

| Profile | Cost | Shape |
| --- | --- | --- |
| Demo | $0 | `pnpm demo` on the maintainer’s machine; screen sharing for a remote demonstration. |
| Independent hosted pilot | Live Oct 25 on Cloud Run + Supabase Free; $0–5/month before tax is a light-usage estimate, not a bill or guarantee. $10 Cloud Run cap/$15 project alerts verified; no all-service hard $20 ceiling | Real Super admin sign-in, fictional editing/publication, private images, automatic two-site HTTPS isolation, timed publication, independent alerts and encrypted isolated recovery passed. The maintainer confirmed normal page reloads; the loaded hosted canvas saved/published successfully. Ready-canvas visual review passed locally at 1440px/1024px; hosted speaker/program forms also passed those widths. Personal custom-domain ownership is verified; final certificate activation/routed content and the human pilot remain open. See [current setup](../deploy/google/README.md). |
| Production | Approved profile and budget required | A continuously monitored worker, durable database/media, independent alerts and a rehearsed recovery destination. Current provider pricing and quotas must be checked when the environment is chosen. |

The application remains portable between compatible OCI hosts and Postgres providers.
Accounts, billing and domains are the maintainer’s to create; the steps below are
what to do once they exist.

The [current Google assessment](../deploy/google/README.md) records the actual
spend controls, feature gaps and usage assumptions. Caps can overshoot and do
not cover every supporting service. The [portable VM profile](../deploy/lightsail/README.md)
remains a reversible fallback, not the selected host. Its generator prepares
Compose/proxy files without deployment. Container smoke and actual
hosted-provider verification remain separate gates.

**Target home (SPEC §12.2):** on October 21 the platform lead created an organisation-owned
"NCRD CMS" Firebase/Google Cloud project and invited the maintainer’s work email.
Moving the pilot there needs the maintainer’s account actions and the platform lead's approval of
the cost brief (SPEC §12.4). Firebase's free Spark plan covers static Hosting;
Cloud Run needs the pay-as-you-go Blaze plan, so check current plan limits
before quoting. The October 19 free-hosting comparison (Cloudflare, AWS, Oracle)
was superseded and is in git history.

### Setting up a hosted environment

**Current Round 3 boundary:** the verified procedure is the
[clean local staging rehearsal](handbook/hosting/local-staging.md). Hosted setup
below remains a plan or historical capability, not authorisation to operate a
provider. See [environment prerequisites](handbook/hosting/environments.md) and
[upgrade/recovery gates](handbook/upgrades/staging-production.md).

1. **Database.** Create a Supabase project (one per environment). Run the
   migrations with the database owner connection (`docker run … migrate` or
   `pnpm db:migrate` with `DATABASE_URL`), then create the three runtime logins:
   `node scripts/provision-runtime-logins.mjs --connection-file owner.json --out ./runtime`.
   It writes one connection file per role; put each in its service's secret
   store and never in the image or repository. The maintainer login is for
   migrations and recovery only.
   On an empty hosted installation, initialize only the real owner with
   `node scripts/bootstrap-hosted-owner.mjs PRIVATE_PG_CONFIG_JSON OWNER_EMAIL DISPLAY_NAME`.
   It refuses an occupied installation or a different existing owner. Never
   run the development seed/demo identities on an externally hosted service.
2. **Sign-in.** Set `AUTH_PROVIDER=supabase`, `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY` and `ADMIN_ORIGIN` (HTTPS). In Supabase set the
   Site URL to `ADMIN_ORIGIN` and allow its exact `/auth/confirm` URL. The
   default Supabase email templates work with the PKCE flow: the initiating
   browser keeps a secure HttpOnly proof, and the server exchanges the returned
   code before verifying the user and CMS access. Open the email in that same
   browser. A custom `token_hash` template remains supported when a configured
   sender/plan permits it, but is not required for the maintainer pilot.
   Only people with a CMS account and site access can sign in; opening the
   link shows a confirmation button, so mail scanners cannot use it.
3. **Media.** `MEDIA_PROVIDER=supabase` with `STORAGE_SUPABASE_URL`,
   `STORAGE_SUPABASE_KEY` and `STORAGE_BUCKET` (a private bucket, ideally in a
   separate storage project because the key bypasses row-level security), or
   `MEDIA_PROVIDER=filesystem` with an absolute `MEDIA_ROOT` on a volume every
   role shares.
4. **Services.** Deploy the image as `admin` and `site` services and the
   `drain` job; set `STAGING_BASE_DOMAIN` to a wildcard domain pointing at the
   site service, `TRUST_PROXY_HEADERS=true` only behind a proxy you control, and
   `APP_VERSION` to the image revision.
5. **Mail.** `MAILER_PROVIDER=resend`, `RESEND_API_KEY` (send-only, worker
   only), `MAIL_FROM` on a verified sender domain.
6. **Continuous worker, monitoring and scheduling.** The finite drain defers
   section thumbnails to the browser-capable `worker` role. Supply that worker
   on a suitable separate host for the complete section-library experience.
   `MONITORING_PROVIDER=stdout` (host log
   alerts) or `webhook` with `MONITORING_WEBHOOK_URL` and `_TOKEN`. Alert on
   worker silence, failed jobs, the public error ratio (`cms.public.request`
   logs) and backup age. Only then set `SCHEDULING_ENABLED=true` and
   `SCHEDULING_MONITORING_READY=true`.
7. **Backups.** Schedule `pnpm recovery backup` daily and run one isolated
   restore drill (below) before inviting anyone.

### Custom domains

Nameservers such as `ns1.inmotionhosting.com` and `ns2.inmotionhosting.com`
identify the DNS service; they do not identify a test website, allocate a CMS
origin or prove ownership. Ask the domain owner for the exact test hostnames
and who will add records for them. The CMS hosting operator must first supply
a reachable public site service and configured DNS/HTTPS provisioner. The CMS
then generates the exact records for that connection, and the domain owner
adds them at the existing DNS provider. No registrar or nameserver transfer
is required for this workflow. Never use a nameserver's IP as the CMS origin.

The provider-free local demo shows **Local preview only** and refuses add or
verify actions before reserving names or queuing failing provider jobs. Removal
still revokes an existing route if a provider becomes unavailable. An explicitly
configured local `fake` provider is labelled as simulated; it proves no external
DNS or certificate behavior. Hosted admin and worker environments may differ;
the local gate never requires worker secrets in the admin.

With `DOMAIN_PROVIDER=cloudflare` (Cloudflare for SaaS: a dedicated zone, a
fallback origin reaching only the site service, `CLOUDFLARE_DOMAIN_API_TOKEN`,
`CLOUDFLARE_DOMAIN_ZONE_ID`, `DOMAIN_CNAME_TARGET`), only a Super Admin adds a
hostname under **Settings → Domains**. The worker attaches it and shows the DNS
records to copy (CNAME or allocated A records, certificate records and a
`_cms-verify` TXT token). The address goes live only when ownership, DNS,
hostname and certificate all check out; the worker rechecks every 10 minutes.
The first address is primary; others redirect to it. Removing an address
revokes its route at once. Pointing a real domain at the CMS is a cutover the
owner authorizes.
Site Admins, Editors and Contributors can inspect their site's addresses but
cannot connect, verify, remove or change the primary domain. The server and
database enforce this restriction independently of the visible controls.

For two-site pilot acceptance, connect two approved independent test
subdomains, one per CMS site. The default does not add `www` aliases; select the
pair only when intended. The domain owner adds the exact A/CNAME, CMS ownership
TXT and provider certificate records. Do not ask for a nameserver transfer or
invent target values before the host is provisioned. Verify both sites' HTTPS,
canonical URLs, media, aliases, unknown-host 404s and removal independently.
Real-role tests cover distinct routing and duplicate reservation refusal; local
browser tests simulate only the external provider. This is not a hosted receipt.

### Health

The admin and site serve `/health`; the worker serves `/health`, `/ready` and
`/queue` on its health port. The dashboard shows background-task health. The
worker emits `cms.operations` events (missing worker, failed delivery or
schedule, stalled lease, overdue work, domain error, stale backup) and repeats
an unresolved one at most every 15 minutes. A stopped worker cannot report
itself, so silence must be checked from outside.

## Backup and restore

`pnpm recovery` uses the database owner connection and Postgres 16 client tools
(`CMS_PG_BIN` if they are not on PATH).

```bash
CMS_BACKUP_KEY=<base64 32 bytes> pnpm recovery backup /backups/2026-10-10T0300Z
pnpm recovery verify /backups/2026-10-10T0300Z
pnpm recovery inventory /backups
```

A backup is the CMS schemas, every version, the audit and queue state and every
media object, encrypted with AES-256-GCM. Keep the key apart from the backups;
losing it loses them. It does not contain provider accounts, login passwords or
DNS. `status.json` in each backup is what `BACKUP_STATUS_PATH` monitors.

To restore, create an empty database `cms_restore_<name>`, set
`CMS_RESTORE_DATABASE_URL`, `CMS_RESTORE_ISOLATED=true` and a new
`CMS_RESTORE_MEDIA_ROOT`, then `pnpm recovery restore <backup>` and
`pnpm recovery verify-restored <media-root>`, which renders every published
page as the public role. Start only a site process against a restored copy —
never a worker, which could repeat real email or domain work. The October 16
local drill authenticated an encrypted backup, restored 15 published pages
and 352 stored objects into a new isolated database and media directory, checked
the complete object inventory, and rendered every published page as the public
role. Restore took about 1.3 seconds; backup, authentication, restore and
verification together took about four seconds on the local demo. No worker ran
against the restored copy. These small local timings do not establish
hosted recovery performance.

The October 25 Google/Supabase rehearsal downloaded the encrypted cloud backup
into a fresh isolated Postgres 17 instance. Four published pages and eight media
objects verified; all four pages and the referenced WebP then returned HTTP 200
through the public role, with an unknown host returning a neutral 404. Only the
public renderer ran; both it and the isolated database were stopped afterward.
The live Scheduler's backup invocation also completed and verified remote
ciphertext readback. Observe the first unattended scheduled execution separately.

Supabase dumps contain default ACLs naming provider roles. Initialize a **fresh
standalone isolated cluster** with a distinct bootstrap administrator; do not
repurpose an existing `postgres` superuser. Create disabled `NOLOGIN`, non-superuser placeholder roles
for `postgres`, `supabase_admin`, `anon`, `authenticated` and `service_role`
before replaying those ACLs. The isolated migration owner needed membership in
the two disabled owner stubs. Never grant it membership in an existing privileged
provider administrator as a shortcut. A restore inside a managed provider needs
its own reviewed operator procedure. Supabase Auth users are external to the CMS
schema backup; new-provider recovery needs verified identity relinking. The
rehearsal did not restore authentication accounts or DNS.

Provisional targets remain at most 24 hours of lost data, restored within 24
hours. Confirm the long-term backup owner and independent key custody at handoff.

## The container image

```bash
docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) -t cms-v2 .
docker build --build-arg POSTGRES_MAJOR=16 --target recovery -t cms-v2-recovery .
sh scripts/smoke-images.sh cms-v2 cms-v2-recovery
```

`docker run cms-v2 <role>` with `admin`, `site`, `worker`, `migrate` or `drain`.
It runs as an unprivileged user with Node 24 and the worker's own headless
Chromium; no secrets are baked in. Set `POSTGRES_MAJOR` to match the hosted
database when building the recovery client. `docker compose --profile app up --build` rehearses the whole
stack locally.

## Before launch: platform lead decisions

| Item | Notes |
| --- | --- |
| Who owns the hosting, database, mail and domain accounts | The system stays portable so an organization can take it over. |
| Right to reuse Salvation Army assets and licensed fonts outside the organization | Legal question; fonts are registered by file hash in `SITE_FONT_REGISTRY`. |
| Real Echelon speakers, agenda and registration | Placeholders are labelled until supplied. |
| Recovery targets, retention and a named backup owner | Provisional: 24 h data loss, 24 h restore. |
| Domain cutover and the V1 fallback period | A merge or a local publish never authorizes a live change. |
| Organizational single sign-on | Only if an IT department requires it. |

### Local BT2027 homepage fidelity checkpoint

Use the maintainer’s local PHP source and the existing offline CDN cache only. With
its rendered `index.html` saved locally, build the single-page archive:

```sh
pnpm --filter @cms/importer bt-homepage <local-site-folder> <rendered-index.html> <offline-cache-folder> <output.json>
```

Import through **Create a site → Import an existing site**, review every file
and original layout as Super Admin, and publish to `bt2027-r8.staging.localhost`
on the local demo. Existing sites and drafts are preserved. The adjacent report
names editable content and missing offline resources. No remote resource is
fetched by this command.

With the local reference on `127.0.0.1:8099`, run from the repository root:

```sh
node e2e/bt-homepage-proof.mjs chromium
node e2e/bt-homepage-proof.mjs firefox
node e2e/bt-homepage-proof.mjs webkit
```

The proof uses private verification receipts, writes comparisons and behavior
reports to private verification receipts, and blocks uncached external
requests. Captures follow the original body's scroll container, so offscreen
content is actually painted. Date is fixed only for the countdown; timers,
animations, carousel, popup and menu behavior remain active. Keep these private
run files excluded from Git. Follow the maintainer’s current stopping rule in SPEC
§11.1; do not turn this checkpoint into a general remote-vendoring project.

### Local BT2027 remaining marketing pages

After the homepage checkpoint, build each of the eight allowlisted marketing
pages from rendered local HTML and the same verified offline cache:

```sh
pnpm --filter @cms/importer bt-page <local-site-folder> <rendered-page.html> <offline-cache-folder> <output.json> hotel-information.php 'Hotel Information'
```

The adjacent JSON/Markdown reports name editable fields, offline gaps and the
remaining list conversion. No network or directory crawl is performed.
`installBetterTogetherPages` in `packages/importer/src/better-together-install.ts`
accepts these archives in a Super Admin transaction, an explicit review and the
existing media store. It adds missing pages only, preserves all existing drafts,
and saves one reviewed file bundle. Review the files/size/source first; publish
through the normal local release afterwards. A retry skips existing pages.

With the retained demo and allowlisted PHP reference running, compare the eight
pages using `node e2e/bt-pages-proof.mjs chromium` (then `firefox` and `webkit` at
a checkpoint). `--page=workshops.html` repeats a failed page without replacing
the other report. All external traffic is blocked or served from verified cache.
Reports/captures go under private verification receipts.

`node e2e/bt-pages-audit.mjs` combines full runs with the latest targeted retakes,
checks all72 page/width comparisons and138 source/CMS image pairs, and verifies
all24 no-JavaScript page checks. It rejects new runtime errors and mismatched
geometry. Workshops retains the local source’s reviewed browser layout mode.

### Native Lists in the reviewed BT2027 layouts

After the page import, `convertBetterTogetherList` in
`packages/importer/src/better-together-lists.ts` converts the three known local
patterns: six speakers, eight sponsors and125 workshop rows. Give it the
matching reviewed source template, field values and server-rendered local CMS
HTML; it performs no file or network reads. It refuses changed item shapes.
The original blank workshop row is retained, and the source's2023 content is
not silently renamed2027.

`installBetterTogetherLists` in `better-together-list-install.ts` accepts all
three reviewed plans in a caller-owned Super Admin transaction. Plans pin the
page revision/version and original definition version. The command creates
native list drafts, updated sanitized layouts/page drafts and reviewed layout
pins through existing app commands. Publish the selected Pages, Lists and Site
files together in Publish. A complete rerun preserves subsequent list drafts;
a partial or conflicting conversion is refused. No scripts or file bytes change.
Coordinators then use **Add speaker**, **Add sponsor** and **Add workshop** on
the page or in Lists. Sponsor pictures use the existing Media upload/chooser.
