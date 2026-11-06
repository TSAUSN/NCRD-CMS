# ADR 0001 — Replace the prototype migrations instead of layering onto them

**Status:** accepted · **Date:** 2026-08-21 · **Milestone:** M0

## Context

The repository carried two migrations (`0000_handy_warbird.sql`, `0001_rls.sql`)
generated against a schema that predates SPEC Draft 2. Draft 2's §5 differs
structurally, not cosmetically:

- Settings, themes, global elements, navigation, and collections become
  head/version pairs; the prototype stored `draft`/`published` JSONB inline.
- Every tenant-owned version row carries `site_id`; the prototype derived
  tenancy through joins.
- `users` + `user_site_roles` split into `app_users`, `global_roles`, and
  `site_memberships`, and `app_users` gains `auth_subject`.
- Six tables did not exist at all: `published_routes`, `published_site_shells`,
  `outbox`, `scheduled_actions`, `job_heartbeats`, `media_variants`/`media_usage`.

Applying both prototype migrations to a clean Postgres 16 succeeded, so this was
not a repair of something broken. It was a choice about which history to keep.

Measured on the applied prototype, the RLS in `0001_rls.sql` was **inert**: the
only database identity was the bootstrap superuser, which is `BYPASSRLS` and
owns every table. An editor scoped to site A read both sites. Every policy in
that file was unverified in the strict sense that nothing had ever executed
them.

## Decision

Delete both files and author a new set by hand:

```
0000_roles.sql        four database identities, two schemas, no default grants
0001_core.sql         the §5 model with tenant/ownership/monotonicity constraints
0002_grants_rls.sql   identity helpers, per-role grants, row-level policies
0003_commands.sql     narrow SECURITY DEFINER state transitions
0004_public_api.sql   the public renderer's entire reachable surface
```

Migrations are hand-written SQL applied by a small forward-only runner
(`packages/schema/src/migrate`), not generated DDL. Drizzle keeps the typed
query surface, and `drift.db.test.ts` fails if the two stop agreeing.

## Consequences

**Why this is safe here.** V2 has no production users, no production data, and no
deployment. Git history retains the prototype. Nothing outside this repository
has ever applied these migrations. V1 is untouched and was never involved.

**Why generated DDL was dropped.** The model's real content is composite foreign
keys, partial unique indexes, row-level policies, column-level grants, triggers,
and `SECURITY DEFINER` functions. A schema differ round-trips none of those
faithfully, so a generated migration would have been a partial description of
the schema with the important half bolted on afterwards. Hand-written SQL with a
drift test inverts that: the SQL is the truth and the TypeScript is checked
against it.

**What is given up.** `drizzle-kit generate` no longer produces migrations, so a
schema change is two edits — the SQL and the Drizzle table. The drift test is
what makes forgetting the second one a test failure rather than a runtime
surprise.

**Forward-only from here.** The runner records a checksum per applied file and
refuses to run if an applied migration changed on disk. `0005` and `0006` were
added this way during M1 rather than by editing `0003`.
