# ADR 0004 — One Node major, and TypeScript executed rather than compiled

**Status:** accepted · **Date:** 2026-08-21 · **Milestone:** M0

## Context

SPEC §2 requires development, CI, and the reference container to use the same
pinned Node major. Two things had to line up for that to be true rather than
declared: the version, and how TypeScript actually runs in each place.

The workspace originally used extension-less relative imports (`from './db'`).
Next and Vitest resolve those; **plain Node does not**. Since `apps/worker` is a
production entrypoint run by plain Node, and `migrate`/`drain` are container
commands, the worker would have failed at container start with a module
resolution error that no test in the repository would have caught — every test
runs under a bundler.

## Decision

- **Node 24 everywhere.** `engines.node >= 24`, `actions/setup-node` pinned to
  24, `node:24-bookworm-slim` in the image. Local shells already resolve 24.15
  through nvm.
- **No build step for library packages.** Every workspace package is consumed
  from source: Next transpiles them, Vitest transforms them, and Node runs the
  worker and CLIs directly under `--experimental-strip-types`.
- **Every relative import carries its `.ts` extension**, with
  `allowImportingTsExtensions: true` in `tsconfig.base.json`. This is what makes
  the same file resolvable by Node, Next, and Vitest without a build.

## Consequences

- The container runs the same TypeScript sources the tests run. There is no
  compiled artifact that could diverge from what was tested.
- `pnpm --filter worker build` is a typecheck, not an emit. That is honest for a
  package with nothing to emit.
- The cost is that `.ts` in import specifiers looks unusual. The alternative —
  extension-less imports that work under three tools and fail under the one that
  runs in production — is worse, and it failed exactly that way before this
  decision was made.
