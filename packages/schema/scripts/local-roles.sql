-- Local/CI login users for the four database identities (SPEC §4).
--
-- The migrations create the identities as NOLOGIN group roles; every
-- environment supplies its own login users. This file is the local one, so its
-- passwords are development-only and the file is never used against a hosted
-- project — there, the operator creates the login roles and puts the
-- credentials straight into the secret store (SPEC §12, V2-SETUP-03).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_admin_app') THEN
    CREATE ROLE cms_admin_app LOGIN PASSWORD 'devpassword';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_site_app') THEN
    CREATE ROLE cms_site_app LOGIN PASSWORD 'devpassword';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cms_worker_app') THEN
    CREATE ROLE cms_worker_app LOGIN PASSWORD 'devpassword';
  END IF;
END
$$;

GRANT cms_authenticated_user TO cms_admin_app;
GRANT cms_public_renderer    TO cms_site_app;
GRANT cms_worker             TO cms_worker_app;

-- None of them may create anything of their own; they use what migrations made.
REVOKE CREATE ON SCHEMA public FROM cms_admin_app, cms_site_app, cms_worker_app;
