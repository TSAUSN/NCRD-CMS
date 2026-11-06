# Where things live

For a maintainer opening CMS V2 for the first time. Last checked: November 5, 2026.
Start with [architecture](../../architecture.md), the current [SPEC status](../../../SPEC.md)
and [local setup](../hosting/local-demo.md). Product task instructions are in the
[handbook index](../INDEX.md); the Friday deployment procedure is separate.

## Follow a change from screen to database to renderer

Paths below are repository-relative. `app/` means `apps/admin/src/app/` and
`lib/` means `apps/admin/src/lib/`. Start at the named route, follow its server
action and command module, then read the current SQL definition. The
[current SQL index](../../../packages/schema/current/README.md) links one file per
function, grouped by area, plus a table/RLS/grant catalog. Numbered migrations
remain the executable authority; never edit a past migration or apply the reference.

| Feature | Admin route → actions/commands | SQL commands to find | Public/preview renderer | Browser proof |
| --- | --- | --- | --- | --- |
| Pages and editing | `app/pages/[pageId]/page.tsx` → `editor.tsx`; `app/actions/page-draft.ts`; `lib/queries.ts` | `app.save_page_draft`, `app.restore_version_as_draft` | `packages/renderer/src/render.ts`; `apps/site/src/lib/canvas-page-handler.ts` | `editor-canvas`, `editor-loop`, `page-recovery`, `page-lifecycle`, `r8-isolated-canvas` |
| Page History | `app/pages/[pageId]/history/`; `lib/page-history.ts` | Search current index for page version/restore commands | Admin `preview/[versionId]/route.ts` uses the same renderer with read-only options | `activity-history`, `page-lifecycle`, `preview-layout` |
| Stories, tags and feeds | `app/sites/[siteId]/stories/actions.ts`, `tags/actions.ts` → `lib/stories-edit.ts`, `stories-tags.ts`, `story-list-commands.ts` | Collection-entry commands and Story review/placement helpers | `packages/renderer/src/newsroom.ts` and `story-*` modules | `sawso-stories`, `sawso-create-story`, `round3-stories-list`, `round3-story-*` |
| Chapters and divisions | `app/sites/[siteId]/chapters/actions.ts` → `lib/chapters.ts`, `local-chapter-mail.ts` | `app.create_division_chapter`, `app.create_chapter_page`, chapter setup/team commands | `echelon-*.ts` and chapter-directory widget in renderer | `echelon-access`, `echelon-teams`, `round3-chapter-division`, `round3-echelon-directory` |
| Header, menu and Footer | `app/sites/[siteId]/{header,footer}/actions.ts`; legacy routes `navigation/`, `global-elements/` | `app.save_navigation_draft`, `app.save_global_elements_draft`, corresponding publish commands | `render.ts`, `national-*`, `echelon-*`; `canvas-page-handler.ts` | `global-elements-workspace`, `frame-source-drafts`, `round3-national-frame` |
| Site look and fonts | `app/sites/[siteId]/design/`, `design/fonts/` → site-look/theme actions under `app/actions/` and page `site-look-actions.ts` | `app.save_theme_draft`, `app.publish_theme` | `render.ts` theme CSS, font registry, presentation CSS in renderer; local licensed-font routes | `theme-workspace`, `round3-fonts`, `round3-font-leave`, `r8-isolated-canvas` |
| Media and documents | `app/sites/[siteId]/media/`, `documents/`; `app/api/media/` → `lib/media-*-repository.ts` | Upload lifecycle, metadata/organization, replacement and public resolution commands | `packages/platform/src/storage.ts`, media delivery repositories; image handling in renderer | `media-*`, `documents-workspace`, `document-upload-http`, `image-focus` |
| Data values | `app/sites/[siteId]/data/`; page `data-values-actions.ts` → `lib/data-values.ts` | Search current index for data-value draft/publish commands | Data-value bindings in shared renderer | `round3-data-values`, `round3-rich-data-values` |
| Lists and items | `app/sites/[siteId]/content/`; `app/collection-review-actions.ts` → `lib/collection-*.ts` | Collection schema/entry/review commands | Shared list bindings and site widgets | `collections-workspace`, `collection-richtext`, `collection-options-http` |
| Publish, review and schedule | `app/actions/page-publish.ts`, `reviews.ts`; page `page-{review,schedule}-actions.ts` → `lib/releases.ts` | `app.publish_page`, release prepare/publish and scheduled-action lease commands | Published projections are read by `apps/site`; same `render.ts` | `r8-publishing`, `editor-publish-review`, `round3-page-schedule`, `scheduled-supersession` |
| People and access | `app/people/actions.ts` → `lib/people.ts`, `people-access.ts`; `lib/session.ts` resolves the verified identity | `app.add_person`, membership/invitation commands, `app.resolve_session` | No public people directory or role checks in markup; PostgreSQL authorizes | `people`, `people-scopes`, dedicated `e2e/no-mail.spec.ts` |
| Domains and routing | `app/sites/[siteId]/domains/actions.ts`; global `app/domains/` → domain adapters in `packages/platform` | Domain create/verify/activate and host resolution commands | `apps/site` Host routing; Firebase Hosting adapter | `domains`, `global-domains`, `public-contract`, `echelon-redirects` |

Browser names above mean `e2e/specs/NAME.spec.ts`. The delivered-round prefixes
are historical names; they do not change which feature owns the test. Full
filenames and assertions stay intact during this handover. Unit tests sit beside
code; real database tests are `packages/schema/test/*.db.test.ts` and package/app
`test/` folders. Permission claims need the real-role tests, not only unit mocks.

## Boundaries to keep

- A server action resolves a verified session, checks input/recent authentication
  as required, then calls a narrow SQL command. A hidden button is not a permission.
- `packages/schema` owns revisions, immutable versions, RLS, scoped commands,
  audit/outbox and release snapshots. Saving is compare-and-set; do not add a write
  around that path. Read a function's current file, then use history to learn why.
- `packages/domain` is framework-free editor/policy logic. `packages/platform`
  supplies role-scoped clients and provider adapters. The worker consumes durable
  leases/outbox and never runs against a review/restore snapshot during checking.
- Renderer changes affect public output and private previews together. Stored
  sections cannot add arbitrary scripts. Reviewed site files and isolated canvas
  capabilities are the explicit exception, under exact CSP and site ownership.
- Golden HTML includes CSS and runtime metadata; do not compare only text. Follow
  [refactor gates](refactor-gates.md). Keep preview/session state outside Git and
  remove it when the walk ends.

## Commands and deliberate remaining work

Use Node 24 and the pinned pnpm. `pnpm typecheck`, `pnpm test`, `pnpm test:db`
and current app builds are separate evidence. Supply `V1_ROOT` to run all licensed
local-source importer cases; a skipped source suite does not prove parity.
`pnpm schema:reference` regenerates documentation from a migrated disposable
local database; `pnpm schema:reference:check` and its database test catch drift.
Browser tests use `E2E_DATABASE` and configurable `E2E_ADMIN_PORT`/`E2E_SITE_PORT`.

The editor still owns the document, revision and undo history. Extract its seams
mechanically; do not redesign its state model while moving code. Delivery-round
test filenames, live CSS organization, renderer capability/data migrations and
SQL source-of-truth changes are deliberately separate work: they have wider
compatibility or review costs. Friday uses a walked frozen commit. Refactor work
ships only if all required gates pass; otherwise its complete commits stay on
`refactor/handover` for review next week. Current readiness belongs in SPEC, not
in this architecture map or old dated decision entries.
