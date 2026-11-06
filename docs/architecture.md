# Architecture

How CMS V2 is built, for whoever works on it next. What it should do is in
[SPEC.md](../SPEC.md) (revision 8; code comments that cite "SPEC §N" mean
[revision 7](archive/SPEC-r7-2026-10-11.md)); why particular choices were made is in
[decisions.md](decisions.md) and [adr/](adr/); how to run it is in
[operations.md](operations.md).

## The shape

```
 editors ──► admin (Next.js) ──┐                 ┌──► public site (Next.js) ◄── visitors
                               ├──► Postgres ◄───┤
               worker ─────────┘   (commands,     └──► media store (files, Supabase or Google)
       (outbox, schedules,          RLS, outbox)
        thumbnails, mail)
```

One container image runs the `admin`, `site`, `worker`, `worker-http`, `migrate` and
`drain` roles (a worker that empties the queue once and exits, for hosts without an
always-on process). There is one database for every site; tenancy is enforced
inside Postgres. The Google profile uses `worker-http`: the same full handler
set runs during an authenticated request and finishes or settles its current
item before replying. Durable leases survive termination. Request-worker health
expires after 150 seconds; timed publishing requires verified independent
monitoring. Private media uses attached Google identities instead of exported service keys.
Firebase Hosting supplies each site's native review address and custom-domain
certificates, forwarding to the shared public renderer. Current deployment,
capacity, domain and human-verification status belongs in
[SPEC's readiness section](../SPEC.md#current-release-state)
and [Google operations](../deploy/google/README.md), not this architecture overview.

For a feature's route → action → SQL → renderer → tests, use the
[maintainer map](handbook/maintainers/where-things-live.md).

| Path | What it is |
| --- | --- |
| `apps/admin` | The CMS. Server components and server actions; every action resolves the session and then calls a database command that authorizes again. |
| `apps/site` | The public renderer. One deployment serves every site by Host header, reading only published projections. |
| `apps/worker` | Delivers the outbox (cache invalidation, thumbnails, media processing, mail, domains), runs schedules, reports health. |
| `packages/schema` | Hand-written SQL migrations (tables, row-level security, grants, commands), Zod content schemas, the archive format. |
| `packages/domain` | Framework-free policy: readiness rules, revision checks, contrast, editor state, typed errors. |
| `packages/platform` | Adapters: role-scoped database clients, media store, mail, domains, monitoring, auth sessions, readiness evaluation. |
| `packages/renderer` | Section compilation, sanitizing, CSS scoping, page rendering and the canvas runtime. Used by both apps, so preview and public output are the same code. |
| `packages/importer` | V1 migration, the V1 section-library import and `import:website` for existing sites. |
| `packages/seeds` | Starter sections, site archetypes and development fixtures. |
| `e2e` | Playwright journeys against built apps and a throwaway database. |

## Content and state

Everything an editor changes is a **head** with a `revision` and immutable
**versions**: pages, themes, navigation, the header and footer (global
elements), site settings, collection schemas and records, section definitions,
page recipes. A head points at its `draft_version_id` and, once published, its
`published_version_id`. Saving appends a version and moves the draft pointer
under a compare-and-set on `revision`, so two editors cannot silently overwrite
each other; publishing moves the published pointer. History, compare and
restore are reads of old versions; restore creates a new draft.

A page version is an ordered list of **section instances**: a pinned section
definition version, the field values, a label, and per-breakpoint visibility.
Pages never embed markup of their own; a definition upgrade is explicit and
previewed, so changing a library section never changes a page that uses it.

An authorized editor preview may show an empty repair prompt for an unfinished
collection binding while rendering the remaining sections. Valid bindings keep
their existing published or authorized initial-release data policy. The private
preview helper cannot be called by editor, visitor or worker database roles;
public manifests and publication validation continue to reject invalid bindings.

## Sections

A section definition is one of two kinds:

- **Structured** (ADR 0006–0007): a typed node tree built in the visual builder
  — headings, formatted text, images, links, buttons, icons, groups, two-column
  groups, collection lists and governed embeds (Tableau, video, maps, forms
  behind visitor consent). Its fields are declared, so every control in the
  inspector is typed.
- **HTML template** (legacy kind): authored HTML and CSS with `{{field}}`
  placeholders and `{{#list}}…{{/list}}` item markers. This is how V1's library,
  migrated pages and imported websites keep their exact markup. Templates are
  compiled under the sanitizer policy (ADR 0005, 0008, 0009): scripts, event
  handlers, frames and unsafe URLs are refused; markup that needs to stay
  active ("trusted code") requires a super admin's approval per page.

CSS is scoped to the section (`.cms-section--<slug>`) and checked by the CSS
policy; fonts come only from a governed registry of licensed files. Per-instance
**appearance** (spacing, width, alignment, phone column order, surface colours
from the theme) is a closed set of choices that emits nothing when unused.
Icons are drawn from a code-owned set and stored by name.

The **section library** of each site holds its definitions by category;
`hidden` definitions keep rendering where placed but are not offered for new
pages. **Page recipes** ("page templates") save an ordered set of sections and
copy independent instances when used.

## The editor

The canvas is the real page rendered by the shared renderer into a same-origin
iframe, with a small runtime that reports clicks and accepts inline edits. The
structure tree, canvas and inspector share one selection. Plain text is typed on
the page; formatted text uses a Tiptap editor on the page and in the inspector;
images, links, buttons, icons and lists have typed controls. Every change is a
step in one undo history. An autosave queue serializes saves (one second after
typing stops), handles conflicts, and keeps a recovery copy in the browser
until the server confirms. The docked library inserts sections at an explicit
position, by button, keyboard or drag onto the page.

## Publishing

Every way content goes live — Publish in the editor, review approval, a
selected release on the Publishing screen, scheduled publication and release
recovery — goes through the same commands: re-authorize, compare revisions,
evaluate **readiness** (no main heading, undescribed image, broken internal
link, refused canonical, unapproved trusted code…), then move pointers, write
public projections, audit and outbox events in one transaction. Blocking
findings need a recorded reason from someone allowed to override.

A **release** is a set of items published together: it is simulated in a
savepoint (to check every resulting page and fingerprint the outcome), then
executed all or nothing. The editor's Publish uses a release when a page needs
company: the unpublished pages it links to, their content lists, and on a
site's first publish its design, header, footer and menu
(`apps/admin/src/lib/publish-together.ts`). A new site is private until that
first release.

Publish later can pin that reviewed release as one scheduled action. The worker
sends its ephemeral queue lease to the admin origin's bounded execution endpoint.
A narrow command resolves only that job's stored creator, then the admin locks
and rechecks the lease, runs the same release engine as that creator and settles
the schedule on the same transaction. Roles, exact draft pins, the reviewed
readiness policy and sample consent must still match. There is no service actor
chosen by an HTTP caller and no second multi-item publishing engine. Single-page
schedules retain their existing database executor.

The public site resolves the host, reads the route's render manifest and the
site shell (theme, header, footer, navigation) through `public_api` functions,
and renders complete server-side HTML with no required JavaScript. Pages are
cached with revision-aware ETags; the worker invalidates them from outbox
events after each publication.

Feature discovery in `packages/renderer/src/feature-markers.ts` reads actual
rendered elements with the same HTML parser used elsewhere in the workspace.
Rendering and CSP share those decisions, so ordinary text cannot activate a
widget or grant its script/frame permissions. A small bounded cache retains
only immutable presentation results. The HTML itself is never rewritten by
this check; authorization and publication state remain outside the cache.

## Sites

The wizard creates a site from an archetype (resource or event): pages, starter
sections, collections, theme, header and footer, all private. **Header and
footer** are either presets (configured, not authored) or an authored
component — a section definition placed in the frame (ADR 0010), which is how
V1 and imported sites keep their own. **Navigation** is automatic (published
pages in order) or manual. **Collections** (speakers, program, resources or
custom models) are typed records that pages list through structured sections.

A **site content archive** (`cms-site-content`) carries a site's versions,
definitions and media bytes between installations; import creates a new private
site with new IDs, recompiles everything under the current policy and gives it
a preview address. `pnpm demo` builds its sites this way.

## Connecting existing websites

Ordinary websites are tagged and imported (ADR 0011). `pnpm import:website`
reads a folder of built pages and writes a content archive plus a report:

- the menu bar or `<header>` with a menu becomes the site header, and the run of
  footer blocks the page ends with becomes the footer (`data-cms-frame` tags
  override the guess);
- each top-level block becomes a site-scoped HTML-template section with its own
  markup and only the CSS rules that can match it;
- fields come from V1's `data-cms-editable` / `data-cms-id` / `data-cms-section`
  tags, or are proposed like the section creator's "Organize into blocks";
- pictures, PDFs and registered fonts become media and documents; links between
  imported pages become CMS addresses;
- unreviewed scripts and interactive applications are reported for review, not
  silently treated as a faithful migration.

BT2027 follows the maintainer’s narrower original-design path. Its local PHP output
and existing offline CDN cache supply the exact section roots, classes, data
attributes, stylesheets, transitions, keyframes, fonts and ordered scripts. There
is no general remote downloader in the verification process. Repeated speakers, sponsors and
workshops use closed list templates that retain the source markup. Reviewed
header/footer components expose text and destinations while keeping their
original design; explicit page profiles preserve distinct source frames. New
core-template pages use separately reviewed frame/file defaults and reserve the
fixed menu's height without changing imported pages.

Immutable site-owned files require a Super Admin review showing name, size and
source. Replacement/removal creates retained versions and activity; the ordinary
atomic release controls publication. Public CSP contains exactly the approved
script hashes for that site and page, with no inline script or runtime external
origin. Section fields remain sanitized. Public HTML contains the content before
scripts enhance it. The isolated editor canvas runs the same reviewed scripts;
its separate capability handshake and editing clock preserve direct selection
and pause carousel motion while editing. Original image fields keep source
values; the inspector resolves reviewed images through authenticated immutable
file routes and explains missing originals.

The site is then reviewed, adjusted on the canvas and published like any other.
Local-source comparisons cover all marketing pages at desktop, tablet and phone
widths, plus carousel, popup, menu, filtering and hover behavior. Sponsor
registration, booth and dashboard applications remain outside this CMS.

## Access and security

Four database identities, each a separate login (ADR 0002):

| Role | Can | Cannot |
| --- | --- | --- |
| `cms_authenticated_user` (admin) | Read its sites' rows through row-level security; write only through `app.*` commands | See another tenant, move a published pointer directly, write the audit log |
| `cms_public_renderer` (site) | Call a few `public_api` functions over published projections | Name any authoring table |
| `cms_worker` | Plan and deliver queued work, hold leases, record heartbeats | Change memberships or content pointers outside its commands |
| `cms_migration_owner` | Everything | Be used by a running app |

People have per-site roles — contributor (suggests changes for review), editor
(edits and publishes), site admin (design, sections, collection fields) — and super admins
manage installations. Sign-in is an email link (Supabase in hosted builds,
a loopback-only local login for development). The admin sends a per-request
nonce Content-Security-Policy; public pages allow only governed, application-owned
script enhancements and remain useful without JavaScript. The maintained
threat model is [threat-model.md](threat-model.md).

## Background work

The **outbox** and **scheduled actions** are Postgres tables worked with
`FOR UPDATE SKIP LOCKED` leases, retries with backoff and dead letters (ADR
0003). Events: cache invalidation, section thumbnails (headless Chromium in the
worker), media variants, invitation mail, domain verification, monitoring.
Health and queue state show on the dashboard and at the worker's `/health`.

## Where the behaviour lives

Much of the product's rule enforcement is in SQL commands, and a command is
often redefined by a later migration (`CREATE OR REPLACE`). To see what a
command does today, open the [current database reference](../packages/schema/current/README.md):
one generated file per current function, with its owner/ACL, and a table/policy/
grant catalog. Numbered migrations remain the runtime authority; the real-database
suite rejects a stale reference. Database tests (`*.db.test.ts`) run against real Postgres as the
real roles and are the specification of those rules.
