# Where things live

For a maintainer opening CMS V2 for the first time. Last checked: November 7, 2026.
Start with [architecture](../../architecture.md), the current [SPEC status](../../../SPEC.md)
and [local setup](../hosting/local-demo.md). Product task instructions are in the
[handbook index](../INDEX.md); the Friday deployment procedure is separate.

## Follow a change from screen to database to renderer

Paths below are repository-relative. `app/` means `apps/admin/src/app/` and
`lib/` means `apps/admin/src/lib/`. Start at the named route, follow its server
action and command module, then read the current SQL definition. Admin read
models live in `apps/admin/src/server/queries/`, by data type. The
[current SQL index](../../../packages/schema/current/README.md) links one file per
function, grouped by area, plus a table/RLS/grant catalog. Numbered migrations
remain the executable authority; never edit a past migration or apply the reference.

| Feature | Admin route → actions/commands | SQL commands to find | Public/preview renderer | Browser proof |
| --- | --- | --- | --- | --- |
| Pages and editing | `app/pages/[pageId]/page.tsx` → `editor.tsx`; `app/actions/page-draft.ts`; `lib/queries.ts` | `app.save_page_draft`, `app.restore_version_as_draft` | `packages/renderer/src/document/render-page.ts`; `apps/site/src/lib/canvas-page-handler.ts` | `editor-canvas`, `editor-loop`, `page-recovery`, `page-lifecycle`, `r8-isolated-canvas` |
| Page History | `app/pages/[pageId]/history/`; `lib/page-history.ts` | Search current index for page version/restore commands | Admin `preview/[versionId]/route.ts` uses the same renderer with read-only options | `activity-history`, `page-lifecycle`, `preview-layout` |
| Stories, tags and feeds | `app/sites/[siteId]/stories/actions.ts`, `tags/actions.ts` → `lib/stories-edit.ts`, `stories-tags.ts`, `story-list-commands.ts` | Collection-entry commands and Story review/placement helpers | `packages/renderer/src/newsroom.ts` and `story-*` modules | `sawso-stories`, `sawso-create-story`, `round3-stories-list`, `round3-story-*` |
| Chapters and divisions | `app/sites/[siteId]/chapters/actions.ts` → `lib/chapters.ts`, `local-chapter-mail.ts` | `app.create_division_chapter`, `app.create_chapter_page`, chapter setup/team commands | `echelon-*.ts` and chapter-directory widget in renderer | `echelon-access`, `echelon-teams`, `round3-chapter-division`, `round3-echelon-directory` |
| Header, menu and Footer | `app/sites/[siteId]/{header,footer}/actions.ts`; legacy routes `navigation/`, `global-elements/` | `app.save_navigation_draft`, `app.save_global_elements_draft`, corresponding publish commands | `frame/site-frame.ts`, `national-*`, `echelon-*`; `canvas-page-handler.ts` | `global-elements-workspace`, `frame-source-drafts`, `round3-national-frame` |
| Site look and fonts | `app/sites/[siteId]/design/`, `design/fonts/` → site-look/theme actions under `app/actions/` and page `site-look-actions.ts` | `app.save_theme_draft`, `app.publish_theme` | `theme/theme-css.ts`, font registry, presentation CSS in renderer; local licensed-font routes | `theme-workspace`, `round3-fonts`, `round3-font-leave`, `r8-isolated-canvas` |
| Media and documents | `app/sites/[siteId]/media/`, `documents/`; `app/api/media/` → `lib/media-*-repository.ts` | Upload lifecycle, metadata/organization, replacement and public resolution commands | `packages/platform/src/storage.ts`, media delivery repositories; image handling in renderer | `media-*`, `documents-workspace`, `document-upload-http`, `image-focus` |
| Contact messages | `app/sites/[siteId]/settings/contact-messages/` | `public_api.submit_contact` and the `contact_messages` site policy | `apps/site/src/lib/contact-handler.ts` saves form submissions; the private inbox has no email forwarding | `round3-echelon-faq-contact` |
| Data values | `app/sites/[siteId]/data/`; page `data-values-actions.ts` → `lib/data-values.ts` | Search current index for data-value draft/publish commands | Data-value bindings in shared renderer | `round3-data-values`, `round3-rich-data-values` |
| Lists and items | `app/sites/[siteId]/content/`; `app/collection-review-actions.ts` → `lib/collection-*.ts` | Collection schema/entry/review commands | Shared list bindings and site widgets | `collections-workspace`, `collection-richtext`, `collection-options-http` |
| Publish, review and schedule | `app/actions/page-publish.ts`, `reviews.ts`; page `page-{review,schedule}-actions.ts` → `lib/releases.ts` | `app.publish_page`, release prepare/publish and scheduled-action lease commands | Published projections are read by `apps/site`; same `render.ts` | `r8-publishing`, `editor-publish-review`, `round3-page-schedule`, `scheduled-supersession` |
| People and access | `app/people/actions.ts` → `lib/people.ts`, `people-access.ts`; `lib/session.ts` resolves the verified identity | `app.add_person`, membership/invitation commands, `app.resolve_session` | No public people directory or role checks in markup; PostgreSQL authorizes | `people`, `people-scopes`, dedicated `e2e/no-mail.spec.ts` |
| Domains and routing | `app/sites/[siteId]/domains/actions.ts`; global `app/domains/` → domain adapters in `packages/platform` | Domain create/verify/activate and host resolution commands | `apps/site` Host routing; Firebase Hosting adapter | `domains`, `global-domains`, `public-contract`, `echelon-redirects` |

Browser tests live under `e2e/specs/` in feature folders. Use the
[test move map](../../maintainers/test-moves.md) to find old round names.
Test titles and assertions are preserved. Unit tests sit beside
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

## Find a specific editor, renderer or style change

- Start in `app/pages/[pageId]/editor.tsx` for the editor’s wiring. Draft
  persistence and recovery live in `use-editor-draft-session.ts`. The preview
  bridge and messages live in `use-editor-canvas-session.ts` and
  `use-canvas-messages.ts`. Toolbar, structure, inspector, and publication
  dialogs have their own files. The domain package owns undoable changes.
- The renderer entry point exports the supported API. Follow
  `document/render-page.ts` for a whole document, `frame/site-frame.ts` for
  header and footer, `section/` for sections and slots, `theme/` for theme
  CSS, and `behaviors/registry.ts` for the handlers and their order.
- Admin `app/globals.css` lists ordinary CSS imports in cascade order.
  Look for screen rules next to the route and shared patterns under
  `components/workspace-styles/`. The small `workspace.module.css` keeps
  cross-screen layout. Buttons, dialogs, fields and other shared controls
  own styles under `components/ui/`. After moving styles, check a direct
  load, a link between screens, and the navigation drawer at 900 px.

Use [known issues](../start-here/known-issues.md) for release limitations.
A local demo, the personal review copy, and a production release are
separate environments; one result does not prove the others.
