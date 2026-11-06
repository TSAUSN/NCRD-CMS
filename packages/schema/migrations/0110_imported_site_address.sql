-- An imported site gets a private preview address, as a site made with the
-- wizard does. Until now only begin_site_setup assigned one, so "Import an
-- existing site" produced a site nobody could preview or visit — not even after
-- publishing — until a domain was connected. The import command runs inside the
-- same transaction (apps/admin/src/lib/site-portability.ts), so the address and
-- the site appear together or not at all; the import itself is already in the
-- activity history.
CREATE FUNCTION app.assign_imported_site_address(p_site_id uuid,p_host text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head RECORD;
BEGIN
  PERFORM app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may import a site' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO head FROM public.sites WHERE id=p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'site not found' USING ERRCODE='CMS03'; END IF;
  -- A retried import repeats the same address.
  IF head.staging_hostname IS NOT DISTINCT FROM p_host THEN RETURN p_host; END IF;
  IF head.staging_hostname IS NOT NULL OR head.creation_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'this site already has its preview address' USING ERRCODE='CMS04';
  END IF;
  IF char_length(COALESCE(p_host,'')) NOT BETWEEN 1 AND 253
    OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR p_host<>lower(p_host)
    OR EXISTS(SELECT 1 FROM regexp_split_to_table(p_host,'\.') label WHERE label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') THEN
    RAISE EXCEPTION 'the preview address is invalid' USING ERRCODE='CMS04';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sites WHERE staging_hostname=p_host)
    OR EXISTS(SELECT 1 FROM public.domains WHERE hostname_normalized=p_host) THEN
    RAISE EXCEPTION 'that preview address is already in use' USING ERRCODE='23505';
  END IF;
  UPDATE public.sites SET staging_hostname=p_host WHERE id=p_site_id;
  RETURN p_host;
END $$;
REVOKE ALL ON FUNCTION app.assign_imported_site_address(uuid,text) FROM PUBLIC,cms_public_renderer,cms_worker;
ALTER FUNCTION app.assign_imported_site_address(uuid,text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.assign_imported_site_address(uuid,text) TO cms_authenticated_user;
