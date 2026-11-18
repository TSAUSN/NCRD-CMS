# Working on CMS V2

[Production](docs/production.md) records the deployed NCRD environment.
[Architecture](docs/architecture.md) explains how requests, data and releases
flow. [Where things live](docs/handbook/maintainers/where-things-live.md) maps
each feature to its screen, actions, database commands and tests. The relevant
[handbook guide](docs/handbook/INDEX.md) describes the user flow. [SPEC](SPEC.md)
revision 8 defines product intent and the [roadmap](docs/roadmap.md) records
deferred work. Code comments that cite revision 7 refer to `docs/archive/`.

The context needed for a change depends on which layers it touches. For example,
rewording a domain status starts in the Admin view. Changing when the status
becomes Live also affects Firebase provider results, the Worker receipt, SQL
host resolution and public routing.

## Environment and data boundaries

Each task uses one branch in one checkout. Organization cloud changes belong to
the Google project administrator. An explicit authorization is needed for
production DNS, site routing, Zesty/cPanel edits, billing, account creation or
irreversible changes. A local change can be prepared and verified independently.

Approved local sources supply public copy and imports. Missing copy remains a
tracked sample. Fictional people are marked “(sample)”. Credentials, database
dumps, private preview tickets and verification receipts live outside Git.
Test harnesses and general workers use disposable environments because they can
reset databases or deliver queued jobs.

## How changes interact with the stack

PostgreSQL checks tenant and role scope. Narrow commands preserve revisions,
versions and outbox receipts. Applied migrations are immutable and checksummed,
including comments. An approved schema change uses a new migration.
The shared renderer sanitizes sections. Reviewed site-owned scripts have exact
site-level CSP approval and go through the normal release flow.

Admin uses shared controls and design tokens. CSS imports in `globals.css`
establish shared order and remain an import list. Shared values come from tokens,
including colors and spacing. Feature rules stay with their owners and shared
behavior uses declared site capabilities. Splitting modules above about 800 lines
by responsibility keeps extensions focused. The page editor has a separately
tracked refactor.
Imported markup, design and interactions are checked against approved sources.

## Local checks and release evidence

The local toolchain is Node 24 and the pinned pnpm. [Operations](docs/operations.md)
covers setup. The installed `next/dist/docs/` reflects the Next.js version in use.

Verification depends on the layer changed. Admin checks use 1440 and 1024 pixel
widths. Public mobile output is checked at 390 pixels. A visual change has
screenshots for the designated reviewer. Browser suites share test resources and
run one at a time with at most two workers. Assertions, timeouts and source
opt-ins remain meaningful across changes. Reports include any failures.

Formatting applies to changed source, with immutable migrations left alone.
The staged diff and configured contributor identity are the release record.
Normal commits use no attribution trailer. Production Cloud Build filters
`[skip ci]` as well as GitHub Actions, so the authorized release procedure
determines whether that marker belongs in a commit. Product decisions are recorded
in `docs/decisions.md`. Git history records the changes. Committed screenshots
are approved design references. SPEC records gaps without expanding release scope.
