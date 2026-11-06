-- 0004 — the public renderer's entire vocabulary (SPEC §3.2, §6.10, §11 Q4).
--
-- Open question 4 is decided here and recorded in docs/adr/0002: the public
-- renderer holds a dedicated role with EXECUTE on three functions over the
-- published projections and no USAGE on `public` at all. It cannot name an
-- authoring table to try to read one. There is no service key in this path.
--
-- Host handling: the caller passes an already-normalized host (lowercased,
-- port and trailing dot stripped — packages/domain owns that and is unit
-- tested against a hostile corpus). An unmatched host resolves to no site,
-- which the renderer turns into a neutral 404. It can never fall through to
-- another tenant, because there is no "default site" branch anywhere below.

CREATE OR REPLACE FUNCTION public_api.resolve_host(p_host text)
RETURNS TABLE (site_id uuid, canonical_host text, is_staging boolean, redirect_to text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  -- A verified custom domain wins; a redirect domain reports where it points.
  SELECT d.site_id,
         COALESCE(target.hostname_normalized, d.hostname_normalized) AS canonical_host,
         false AS is_staging,
         CASE WHEN d.kind = 'redirect' THEN target.hostname_normalized END AS redirect_to
    FROM public.domains d
    LEFT JOIN public.domains target ON target.id = d.redirect_to_domain_id
   WHERE d.hostname_normalized = p_host
     AND d.status = 'live'
     AND (d.kind <> 'redirect' OR target.status = 'live')
  UNION ALL
  -- Staging hosts serve immediately and stay noindex (SPEC §6.2).
  SELECT s.id, s.staging_hostname, true, NULL
    FROM public.sites s
   WHERE s.staging_hostname = p_host
     AND s.status <> 'archived'
     AND NOT EXISTS (SELECT 1 FROM public.domains d2
                      WHERE d2.hostname_normalized = p_host AND d2.status = 'live')
  LIMIT 1
$$;

-- One row, one round trip: the shell and the route's manifest together, so a
-- public page render performs a single lookup against published data only.
CREATE OR REPLACE FUNCTION public_api.resolve_route(p_host text, p_path text)
RETURNS TABLE (
  site_id uuid, path text, page_id uuid, page_version_id uuid,
  render_manifest jsonb, shell_revision bigint, shell_payload jsonb,
  is_staging boolean, canonical_host text, redirect_to text, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.site_id, r.path, r.page_id, r.page_version_id, r.render_manifest,
         sh.revision, sh.payload, h.is_staging, h.canonical_host, h.redirect_to, r.updated_at
    FROM public_api.resolve_host(p_host) h
    JOIN public.published_routes r ON r.site_id = h.site_id AND r.path = p_path
    LEFT JOIN public.published_site_shells sh ON sh.site_id = h.site_id
$$;

-- Sitemap and nav need the site's published paths; nothing else is exposed.
CREATE OR REPLACE FUNCTION public_api.site_routes(p_host text)
RETURNS TABLE (path text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.path, r.updated_at
    FROM public_api.resolve_host(p_host) h
    JOIN public.published_routes r ON r.site_id = h.site_id
   ORDER BY r.path
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public_api FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public_api.resolve_host(text),
  public_api.resolve_route(text, text),
  public_api.site_routes(text)
TO cms_public_renderer;

-- The admin app reads the same projections through its own role when it needs
-- to show what is live; it does not get a second implementation of routing.
GRANT EXECUTE ON FUNCTION
  public_api.resolve_host(text),
  public_api.resolve_route(text, text),
  public_api.site_routes(text)
TO cms_authenticated_user;

-- Ownership for the functions created in this file (0002 ran before them).
DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
