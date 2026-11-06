-- 0000 — database identities (SPEC §4).
--
-- Four identities, created as NOLOGIN group roles so they are pure privilege
-- containers. Each environment creates its own LOGIN user and grants it into
-- the group it needs; passwords never appear in a migration. Locally,
-- `pnpm db:bootstrap` does that (scripts/bootstrap-local-roles.sql).
--
-- Why groups: RLS `TO <role>` clauses and table GRANTs both resolve through
-- role membership, so a login user that is a member of cms_authenticated_user
-- gets exactly that role's policies and grants and nothing else.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_authenticated_user') THEN
    CREATE ROLE cms_authenticated_user NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_public_renderer') THEN
    CREATE ROLE cms_public_renderer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_worker') THEN
    CREATE ROLE cms_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_migration_owner') THEN
    CREATE ROLE cms_migration_owner NOLOGIN;
  END IF;
  -- The migrator must be able to act as the owner: 0002 reassigns every
  -- object to cms_migration_owner so "who owns the schema" is a named role
  -- rather than whichever human ran the deploy.
  EXECUTE format('GRANT cms_migration_owner TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION 'migrations must run as a role with CREATEROLE (got %). On Supabase use the `postgres` role.', current_user;
END
$$;

-- `app` holds identity/authorization helpers and the narrow command functions.
-- `public_api` holds the only surface the public renderer may touch.
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS public_api;

-- Nothing is granted by default anywhere. Every privilege in this database is
-- named explicitly in 0002.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA public_api FROM PUBLIC;
