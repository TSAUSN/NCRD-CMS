# Working on CMS V2

Read `SPEC.md`, `docs/roadmap.md`, `docs/architecture.md` and the relevant
handbook guide before changing an area. Revision 8 is the product direction;
revision 7 remains in `docs/archive/` because code cites its section numbers.
The handbook starts at `docs/handbook/INDEX.md`.

## Scope and safety

- Work on one branch in one checkout per task; use an isolated worktree when requested.
- Organization cloud commands are performed by the Google project administrator.
  Prepare and verify deployment plans locally. Never change production DNS,
  Zesty/cPanel pages or live-site routing without explicit authorization.
- Import only approved local source copies. Keep credentials, dumps, raw preview
  tickets and verification receipts outside Git. Never copy source-site secrets.
- Public copy comes verbatim from approved sources. Missing content uses tracked
  bracketed samples; fictional people are labelled “(sample)”.
- Never edit `packages/schema/migrations/`, including comments. Applied checksums
  are immutable. Introduce schema changes through new reviewed migrations only
  when schema work is explicitly in scope.
- Never point test harnesses or a general worker at a retained or review database.

## Implementation and review

- Use Node 24 and the pinned pnpm version. Follow `docs/operations.md` for setup.
- Preserve tenant isolation, RLS, narrow commands, immutable releases and the shared
  sanitizing renderer. Section fields cannot introduce scripts. Reviewed site-owned
  scripts require exact per-site CSP approval and the normal release flow.
- Use design tokens and shared controls. No new raw colours or spacing outside
  tokens, and no new rules in `globals.css`.
- Keep modules focused. Split files above about 800 lines before extending them;
  the page editor is a known exception tracked for a separate reviewed refactor.
- Shared renderer and SQL logic should use declared capabilities rather than site
  slugs. Preserve imported markup, styling and interactions against approved local sources.
- Check admin at 1440/1024 and public output at 390. Inspect screenshots when a
  visual change is in scope. UI acceptance belongs to the designated reviewer.
- Run one browser suite at a time with at most two workers. Keep assertions,
  timeouts and source opt-ins intact. Record failures without concealing them.
- Run relevant checks and format only changed source files before committing.
  Never run a formatter over immutable migrations.
- Inspect the staged diff. Use the configured contributor identity, with no
  attribution trailer. Verify locally and batch pushes within the CI budget;
  use `[skip ci]` while the repository's Actions allowance is exhausted.
- Keep documentation current and concise. Record decisions in `docs/decisions.md`;
  Git history is the change log. Commit screenshots only as approved design references.
- For unfamiliar Next.js APIs, read the installed `next/dist/docs/` first.

Account creation, spending, irreversible remote changes and production cutover
require the responsible administrator's approval. Preserve the reviewed release
scope; report gaps and evidence in SPEC without expanding the task silently.
