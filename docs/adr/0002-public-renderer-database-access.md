# ADR 0002 — The public renderer's database access

**Status:** accepted · **Date:** 2026-08-21 · **Milestone:** M0
**Resolves:** SPEC §11 open question 4

## Context

Public traffic must read published content and nothing else. The tempting
options are a service key (fast, and a single mistake away from serving drafts),
or the authenticated role with careful policies (one policy error away from the
same).

## Decision

A dedicated `cms_public_renderer` Postgres role with:

- `USAGE` on schema `public_api` only. **No `USAGE` on `public` or `app`.**
- `EXECUTE` on exactly three functions: `resolve_host`, `resolve_route`,
  `site_routes`.
- No table grants of any kind, including on the projection tables themselves.

The consequence is stronger than "denied rows": the role cannot *name* an
authoring table. `SELECT * FROM pages` as that role is a schema-permission
error, not a filtered result — asserted in `isolation.db.test.ts` across
`pages`, `page_versions`, `app_users`, `site_memberships`, `audit_log`,
`domains`, and `published_routes`.

Public rendering reads one row: `published_routes.render_manifest` plus
`published_site_shells.payload`. It never joins an authoring table, so a mistake
in an authoring-side policy cannot leak a draft to the internet — the draft is
not reachable from that role at all.

## Consequences

- There is no service-role client anywhere in `packages/platform`. A module that
  does not exist cannot be imported into an SSR path by accident.
- The projection must be complete: anything the public page needs is written at
  publish time, in the same transaction as the published pointer.
- The projection is built **in SQL**, inside `publish_page`, from the pinned
  version. A caller cannot hand the database a public payload of its own
  choosing, which would otherwise be a way past the trusted-code gate.
- Adding a public feature means extending the projection and possibly a fourth
  `public_api` function — deliberately more friction than widening a grant.
