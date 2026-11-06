# CMS V2

A visual content management system for a family of small websites (event,
ministry, chapter and resource sites). Editors click the real page to change it,
add well-designed sections from a shared library, and publish when they are
ready; every site keeps its own look. It replaces the V1 CMS's architecture
(Firebase, script-injected content) while keeping V1's editing experience.

**Current direction:** [SPEC.md](SPEC.md) revision 8 (October 25, 2026) — an
editing-experience overhaul, a shared core section library, and moving real
sites onto the platform, starting with SAWSO and Echelon.

## Current state and cleanup plan

The frozen release is `friday-2026-11-06`. The personal review Admin health endpoint reports `e51b4b5`, the frozen runtime;
its environment details and last check are in
[review-environment.md](docs/handbook/hosting/review-environment.md). Organization deployment remains an administrator-run acceptance gate.
The render/schema oracle covers 356 artifacts. Complete baseline browser runs
recorded Chromium 629/631 and WebKit 626/631, with known failures retained in
[known-issues.md](docs/handbook/start-here/known-issues.md).

Technical debt includes the large page editor, `globals.css`, and site-specific
renderer branches. Structural cleanup continues on a separate branch and lands
as reviewed commits after its behavior and visual gates pass. The handover
cleanup changes documentation, comments and neutral test-support text only.

## Maintaining this code

Use the [feature map](docs/handbook/maintainers/where-things-live.md) to follow a
screen through its action, SQL command, renderer and tests. The
[current SQL reference](packages/schema/current/README.md) shows each function's
current definition; immutable migrations remain the runtime authority.
[Refactor gates](docs/handbook/maintainers/refactor-gates.md) explain the byte-level
render/schema oracle and isolated browser ports. Current release readiness is in SPEC.

## Start here

- **Run it:** `pnpm install`, then `pnpm demo` (details below).
- **How do I…?** The [handbook index](docs/handbook/INDEX.md) maps everyday tasks to step-by-step guides.
- **How it is built:** [docs/architecture.md](docs/architecture.md).
- **Tests and operations:** [docs/operations.md](docs/operations.md). Run `pnpm format` before committing.

## Try it

Requirements: Node 24, pnpm 11.22.0 and Postgres 16 (Docker, or `brew install postgresql@16`).
Use the Node version in `.nvmrc` before installing or running the demo.

```bash
pnpm install
pnpm demo
```

That starts the admin at http://localhost:3000. It loads local examples:

- SAWSO, the lead demo: approved national look, eight sectors, Stories and Newsroom;
- Better Together 2027, imported from local website files;
- Human Needs Index and Echelon Symposium, migrated from local V1 rebuilds;
- Echelon chapters, a separate native site with a national home and chapter pages.

The fictional event is a test fixture. [DEMO-SAWSO.md](DEMO-SAWSO.md) gives the
five-minute lead walkthrough. [DEMO-ECHELON.md](DEMO-ECHELON.md) gives
the five-minute chapter walkthrough and the retained demo's safe startup command.

Sign in as `admin@example.test`. The examples are published only at their
localhost addresses; no live website is connected. Demo order: SAWSO, Echelon
chapters, then Better Together 2027. [docs/editor-guide.md](docs/editor-guide.md)
ends with a walkthrough of the current interface.

## Status

The local revision 8 implementation includes the shared design system, 24 core
sections, designed samples and templates, the visual editor and task-based
workspaces. Better Together 2027 keeps its imported design and reviewed scripts,
with editable speakers, sponsors, workshops, menu and footer.

Echelon chapters adds a national home and directory, chapter setup, page/division
access, protected shared sections, recorded invitations, division approval,
January/July checks, redirects, search and picture focus controls. Public pages
work on phones; CMS editing targets laptops and desktops.

The hosted personal review and local examples are separate environments. Organisation hosting, static publishing, the cost
brief and operations handover remain separate work in [docs/roadmap.md](docs/roadmap.md).

## Documentation

| Document | For |
| --- | --- |
| [docs/handbook/INDEX.md](docs/handbook/INDEX.md) | Step-by-step guides for editors, site admins and maintainers. |
| [SPEC.md](SPEC.md) | What to build and why — product, UX, platform direction, work packages. |
| [docs/roadmap.md](docs/roadmap.md) | What is done and what is next, by work-package ID. |
| [docs/design/](docs/design/) | Screen design briefs, "before" screenshots and approved mockups. |
| [docs/decisions.md](docs/decisions.md) | Standing decisions and recent ones; [docs/adr/](docs/adr/) for the longer ones. |
| [docs/architecture.md](docs/architecture.md) | How it is built. |
| [docs/operations.md](docs/operations.md) | Running, testing, hosting, connecting existing sites, backups. |
| [docs/editor-guide.md](docs/editor-guide.md) | Using it, for editors (current interface). |
| [DEMO-ECHELON.md](DEMO-ECHELON.md) | Five-minute local chapter, volunteer and division-approval demo. |
| [docs/threat-model.md](docs/threat-model.md) | Security boundaries and what defends them. |
| [docs/v1-migration.md](docs/v1-migration.md) | How V1 content is migrated. |
| [docs/archive/](docs/archive/) | SPEC revision 7, kept because code cites its section numbers. |
| [AGENTS.md](AGENTS.md) | Contributor conventions and review requirements. |

## In one paragraph

Next.js admin and public-site apps, a Node worker and one Postgres database,
shipped as one container image with `admin`, `site`, `worker`, `worker-http`,
`migrate`, `drain` and `seed` roles. Tenancy, permissions and publication rules are enforced inside
Postgres (row-level security and narrow commands, four separate database
identities), and the same sanitizing renderer produces the editor's preview and
the public HTML. Public content works without JavaScript; only governed,
application-owned enhancements can add scripts. Hosted capability, current
quotas and costs must be verified for the chosen environment before deployment.
