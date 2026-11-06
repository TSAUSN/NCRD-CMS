-- Archive is a page-content freeze, including an editor opened before archive.
-- Guard the rows both create/save/restore commands insert, so alternate command
-- paths cannot bypass the UI. Existing versions remain readable and immutable.
CREATE FUNCTION app.require_page_site_writable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state public.site_status;
BEGIN
  -- The share lock serializes content writes with archive_site's site UPDATE:
  -- either this write finishes first, or it observes archive and is rejected.
  SELECT status INTO state FROM public.sites WHERE id=NEW.site_id FOR SHARE;
  IF state='archived' THEN
    RAISE EXCEPTION 'pages on an archived site are read-only' USING ERRCODE='CMS04';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app.require_page_site_writable() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.require_page_site_writable() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE TRIGGER pages_require_writable_site BEFORE INSERT ON public.pages
FOR EACH ROW EXECUTE FUNCTION app.require_page_site_writable();
CREATE TRIGGER page_versions_require_writable_site BEFORE INSERT ON public.page_versions
FOR EACH ROW EXECUTE FUNCTION app.require_page_site_writable();
