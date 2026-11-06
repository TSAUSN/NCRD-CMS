-- 0002 — authorization (SPEC §4, §8).
--
-- RLS is necessary but not sufficient, so this file does three separate jobs:
--
--   * Identity: who the current transaction is, derived from a session GUC the
--     application sets with SET LOCAL, never from a value a client can supply.
--   * Grants: what each of the four roles may name at all. The public renderer
--     cannot even see the `public` schema; it holds EXECUTE on three functions.
--   * Policies: which rows a *granted* statement may touch.
--
-- Removing any one of the three still leaves a wall standing. That is the point.

-- ------------------------------------------------------------- who am I --

-- The signed-in product user, or NULL. A disabled user resolves to NULL here,
-- which means "disabled" is enforced by the database and not only by the app:
-- an already-issued token cannot outlive a deactivation (SPEC §4).
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT u.id FROM public.app_users u
  WHERE u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND u.status = 'active'
$$;

CREATE OR REPLACE FUNCTION app.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE((
    SELECT true FROM public.global_roles g
    WHERE g.user_id = app.current_user_id() AND g.role = 'super_admin'
  ), false)
$$;

CREATE OR REPLACE FUNCTION app.site_role(site uuid) RETURNS site_role_name
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN app.is_super_admin() THEN 'site_admin'::public.site_role_name
              ELSE (SELECT m.role FROM public.site_memberships m
                    WHERE m.user_id = app.current_user_id() AND m.site_id = site) END
$$;

CREATE OR REPLACE FUNCTION app.has_site_access(site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(site IS NOT NULL AND app.site_role(site) IS NOT NULL, false)
$$;

-- Capability tiers from SPEC §4, expressed once so policies and commands ask
-- the same question. contributor < editor < site_admin (< super_admin).
--
-- COALESCE is load-bearing, not defensive noise: site_role() is NULL for a
-- non-member, and `NOT (false OR NULL)` is NULL, so a guard written the
-- obvious way silently lets a stranger through. The database policy tests
-- caught exactly that.
CREATE OR REPLACE FUNCTION app.can_publish(site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(app.site_role(site) IN ('editor', 'site_admin'), false)
$$;

CREATE OR REPLACE FUNCTION app.can_administer_site(site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(app.site_role(site) = 'site_admin', false)
$$;

-- The worker identifies itself the same way: a GUC set for the transaction.
CREATE OR REPLACE FUNCTION app.current_worker_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.worker_id', true), '')
$$;

CREATE OR REPLACE FUNCTION app.current_request_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.request_id', true), '')
$$;

-- ---------------------------------------------------------------- ownership --

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT c.relname, n.nspname, c.relkind FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- Identity/serial sequences follow their owning table's owner, and
    -- reassigning one directly is an error, so tables and views only.
    WHERE n.nspname IN ('public', 'app', 'public_api') AND c.relkind IN ('r', 'v', 'm')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO cms_migration_owner', obj.nspname, obj.relname);
  END LOOP;
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
  EXECUTE 'ALTER SCHEMA app OWNER TO cms_migration_owner';
  EXECUTE 'ALTER SCHEMA public_api OWNER TO cms_migration_owner';
END
$$;

-- ------------------------------------------------------------------- grants --

-- The owner needs the schema it owns objects in. Every SECURITY DEFINER
-- command executes as this role, so without this grant every command fails
-- with "permission denied for schema public" the moment it touches a table.
GRANT ALL ON SCHEMA public TO cms_migration_owner;

GRANT USAGE ON SCHEMA public, app TO cms_authenticated_user;
GRANT USAGE ON SCHEMA public, app TO cms_worker;
-- Deliberately NOT `public` or `app`: the renderer's entire vocabulary is the
-- three functions in public_api. It cannot name an authoring table to try.
GRANT USAGE ON SCHEMA public_api TO cms_public_renderer;

GRANT EXECUTE ON FUNCTION
  app.current_user_id(), app.is_super_admin(), app.site_role(uuid),
  app.has_site_access(uuid), app.can_publish(uuid), app.can_administer_site(uuid),
  app.current_worker_id(), app.current_request_id()
TO cms_authenticated_user, cms_worker;

-- Reads: every authoring table, narrowed by the policies below.
GRANT SELECT ON
  app_users, global_roles, site_memberships, sites, site_settings, site_setting_versions,
  pages, page_versions, themes, theme_versions, global_elements, global_element_versions,
  navigations, navigation_versions, section_defs, section_def_versions,
  collections, collection_schema_versions, collection_entries, collection_entry_versions,
  media, media_variants, media_usage, domains, submissions, comments,
  scheduled_actions, job_heartbeats, published_site_shells, published_routes, audit_log
TO cms_authenticated_user;

-- Writes: almost nothing. Everything workflow-sensitive is a command in 0003.
--
-- `comments` is the one table an application role writes directly, precisely so
-- the tenancy tests have a case where RLS — not a missing grant — is what
-- refuses a cross-site write.
GRANT INSERT ON comments TO cms_authenticated_user;
GRANT UPDATE (resolved_at) ON comments TO cms_authenticated_user;

-- Renaming a page is ordinary editing; moving its pointers is a publication
-- decision. Column-level grants draw that line in the database, so
-- `UPDATE pages SET published_version_id = ...` fails before RLS is consulted.
GRANT UPDATE (title, editor_label, sort_index) ON pages TO cms_authenticated_user;

-- Worker: reads what it must plan from, writes only its own heartbeat, and
-- otherwise calls named commands. Being server-side buys it nothing extra.
GRANT SELECT ON
  sites, pages, page_versions, domains, scheduled_actions, outbox,
  published_routes, published_site_shells, app_users, site_memberships, global_roles
TO cms_worker;
GRANT INSERT, UPDATE ON job_heartbeats TO cms_worker;

-- audit_log is append-only to every application role: no UPDATE, no DELETE,
-- and no INSERT either — only the commands in 0003 write it, inside the same
-- transaction as the change they describe (SPEC §6.13).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_log FROM cms_authenticated_user, cms_worker, cms_public_renderer;
REVOKE ALL ON outbox FROM cms_authenticated_user, cms_public_renderer;
REVOKE ALL ON published_routes, published_site_shells FROM cms_public_renderer;

-- ---------------------------------------------------------------- policies --
--
-- Enabled on every table in `public`. A table with RLS on and no policy for a
-- role denies that role every row — which is the correct default for anything
-- this file forgets to mention.

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Identity -------------------------------------------------------------------
-- A user reads their own record and their own memberships. Super admins read
-- everyone, because that is the tier that manages people.

CREATE POLICY app_users_self ON app_users FOR SELECT TO cms_authenticated_user
  USING (id = app.current_user_id() OR app.is_super_admin());

CREATE POLICY global_roles_self ON global_roles FOR SELECT TO cms_authenticated_user
  USING (user_id = app.current_user_id() OR app.is_super_admin());

CREATE POLICY site_memberships_visible ON site_memberships FOR SELECT TO cms_authenticated_user
  USING (user_id = app.current_user_id() OR app.can_administer_site(site_id));

-- Tenancy --------------------------------------------------------------------
-- One predicate, repeated: you see a row when you are a member of the site
-- that owns it. Every version table carries its own site_id (SPEC §4), so the
-- predicate is local — no join, nothing to get subtly wrong per table.

CREATE POLICY sites_member ON sites FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(id));

CREATE POLICY site_settings_member ON site_settings FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY site_setting_versions_member ON site_setting_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY pages_member ON pages FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
-- The column grant already forbids touching a pointer; this bounds the rename
-- grant to the caller's own sites.
CREATE POLICY pages_member_update ON pages FOR UPDATE TO cms_authenticated_user
  USING (app.has_site_access(site_id)) WITH CHECK (app.has_site_access(site_id));

CREATE POLICY page_versions_member ON page_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY themes_member ON themes FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY theme_versions_member ON theme_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY global_elements_member ON global_elements FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY global_element_versions_member ON global_element_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY navigations_member ON navigations FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY navigation_versions_member ON navigation_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY collections_member ON collections FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY collection_schema_versions_member ON collection_schema_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY collection_entries_member ON collection_entries FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY collection_entry_versions_member ON collection_entry_versions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY domains_member ON domains FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY submissions_member ON submissions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY comments_member_read ON comments FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
-- The insert case the tenancy tests lean on: the WITH CHECK, not a grant, is
-- what refuses a comment filed against someone else's site. It also refuses
-- forging another author.
CREATE POLICY comments_member_insert ON comments FOR INSERT TO cms_authenticated_user
  WITH CHECK (app.has_site_access(site_id) AND author_id = app.current_user_id());
CREATE POLICY comments_member_resolve ON comments FOR UPDATE TO cms_authenticated_user
  USING (app.has_site_access(site_id)) WITH CHECK (app.has_site_access(site_id));

CREATE POLICY scheduled_actions_member ON scheduled_actions FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

CREATE POLICY media_member ON media FOR SELECT TO cms_authenticated_user
  USING ((site_id IS NULL AND app.current_user_id() IS NOT NULL) OR app.has_site_access(site_id));
CREATE POLICY media_variants_member ON media_variants FOR SELECT TO cms_authenticated_user
  USING (EXISTS (SELECT 1 FROM media m WHERE m.id = media_id
                 AND ((m.site_id IS NULL AND app.current_user_id() IS NOT NULL)
                      OR app.has_site_access(m.site_id))));
CREATE POLICY media_usage_member ON media_usage FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

-- Section definitions: the global library is readable by any active user;
-- site-scoped definitions follow membership. Authoring is a command.
CREATE POLICY section_defs_read ON section_defs FOR SELECT TO cms_authenticated_user
  USING ((scope = 'global' AND app.current_user_id() IS NOT NULL) OR app.has_site_access(site_id));
CREATE POLICY section_def_versions_read ON section_def_versions FOR SELECT TO cms_authenticated_user
  USING (EXISTS (SELECT 1 FROM section_defs d WHERE d.id = section_def_id
                 AND ((d.scope = 'global' AND app.current_user_id() IS NOT NULL)
                      OR app.has_site_access(d.site_id))));

-- Published projections are readable in admin (to show what is live) with the
-- same site scoping. Public traffic never arrives through this role.
CREATE POLICY published_routes_member ON published_routes FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));
CREATE POLICY published_site_shells_member ON published_site_shells FOR SELECT TO cms_authenticated_user
  USING (app.has_site_access(site_id));

-- Audit is readable within your site; global rows are super-admin only.
CREATE POLICY audit_log_read ON audit_log FOR SELECT TO cms_authenticated_user
  USING ((site_id IS NULL AND app.is_super_admin()) OR app.has_site_access(site_id));

-- The heartbeat is operational, not tenant data: any active user may see that
-- the worker is alive, which is what makes the M0 exit check observable.
CREATE POLICY job_heartbeats_read ON job_heartbeats FOR SELECT TO cms_authenticated_user
  USING (app.current_user_id() IS NOT NULL);

-- Worker ---------------------------------------------------------------------
-- The worker is not a tenant. It plans across sites but writes through
-- commands; here it gets reads and its own heartbeat row.

CREATE POLICY sites_worker ON sites FOR SELECT TO cms_worker USING (true);
CREATE POLICY pages_worker ON pages FOR SELECT TO cms_worker USING (true);
CREATE POLICY page_versions_worker ON page_versions FOR SELECT TO cms_worker USING (true);
CREATE POLICY domains_worker ON domains FOR SELECT TO cms_worker USING (true);
CREATE POLICY scheduled_actions_worker ON scheduled_actions FOR SELECT TO cms_worker USING (true);
CREATE POLICY outbox_worker ON outbox FOR SELECT TO cms_worker USING (true);
CREATE POLICY published_routes_worker ON published_routes FOR SELECT TO cms_worker USING (true);
CREATE POLICY published_site_shells_worker ON published_site_shells FOR SELECT TO cms_worker USING (true);
CREATE POLICY app_users_worker ON app_users FOR SELECT TO cms_worker USING (true);
CREATE POLICY site_memberships_worker ON site_memberships FOR SELECT TO cms_worker USING (true);
CREATE POLICY global_roles_worker ON global_roles FOR SELECT TO cms_worker USING (true);

CREATE POLICY job_heartbeats_worker ON job_heartbeats FOR ALL TO cms_worker
  USING (worker_id = app.current_worker_id())
  WITH CHECK (worker_id = app.current_worker_id());
