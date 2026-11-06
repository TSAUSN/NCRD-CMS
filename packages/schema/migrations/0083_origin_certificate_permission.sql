-- The reverse proxy may request a certificate only for an active site's
-- staging name, or a custom name whose DNS ownership the worker verified.
CREATE FUNCTION public_api.certificate_allowed(p_hostname text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT p_hostname=lower(p_hostname) AND (
    EXISTS(SELECT 1 FROM public.sites s WHERE s.staging_hostname=p_hostname AND s.status<>'archived')
    OR EXISTS(SELECT 1 FROM public.domains d JOIN public.sites s ON s.id=d.site_id
      WHERE d.hostname_normalized=p_hostname AND d.removed_at IS NULL AND s.status<>'archived'
      AND d.status IN ('issuing_cert','live'))
  );
$$;
ALTER FUNCTION public_api.certificate_allowed(text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.certificate_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_api.certificate_allowed(text) TO cms_public_renderer;
