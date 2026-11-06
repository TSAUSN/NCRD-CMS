-- Mutable library organization is separate from immutable PDF receipts/bytes.
-- Archiving only removes picker availability; public/history authorization is unchanged.
CREATE TABLE public.site_document_metadata (
  asset_id uuid PRIMARY KEY,
  site_id uuid NOT NULL,
  category text NOT NULL DEFAULT '' CHECK(char_length(category)<=80 AND category=btrim(category) AND category !~ '[[:cntrl:]]'),
  archived boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  FOREIGN KEY(site_id,asset_id) REFERENCES public.site_assets(site_id,id)
);
ALTER TABLE public.site_document_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_document_metadata_read ON public.site_document_metadata FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
REVOKE ALL ON public.site_document_metadata FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.site_document_metadata TO cms_authenticated_user;

CREATE FUNCTION app.initialize_document_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.kind='document' THEN
    INSERT INTO public.site_document_metadata(asset_id,site_id) VALUES(NEW.id,NEW.site_id);
  END IF;
  RETURN NEW;
END $$;
INSERT INTO public.site_document_metadata(asset_id,site_id) SELECT id,site_id FROM public.site_assets WHERE kind='document';
CREATE TRIGGER site_document_metadata_initialize AFTER INSERT ON public.site_assets FOR EACH ROW EXECUTE FUNCTION app.initialize_document_metadata();

CREATE FUNCTION app.organize_site_document(p_site uuid,p_asset uuid,p_revision bigint,p_category text,p_archived boolean)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; current public.site_document_metadata; next_revision bigint;
BEGIN
  PERFORM app.authorize_site_document_upload(p_site);
  actor:=app.require_actor();
  IF p_revision IS NULL OR p_revision<0 OR p_category IS NULL OR char_length(p_category)>80
    OR p_category<>btrim(p_category) OR p_category ~ '[[:cntrl:]]' OR p_archived IS NULL THEN
    RAISE EXCEPTION 'invalid document organization' USING ERRCODE='CMS04';
  END IF;
  SELECT * INTO current FROM public.site_document_metadata WHERE site_id=p_site AND asset_id=p_asset FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document unavailable' USING ERRCODE='CMS03'; END IF;
  -- A repeated completed mutation is harmless, including a lost-response retry.
  IF current.category=p_category AND current.archived=p_archived AND current.revision IN (p_revision,p_revision+1) THEN
    RETURN current.revision;
  END IF;
  IF current.revision<>p_revision THEN RAISE EXCEPTION 'document organization changed; refresh before retrying' USING ERRCODE='CMS01'; END IF;
  UPDATE public.site_document_metadata SET category=p_category,archived=p_archived,revision=revision+1
    WHERE asset_id=p_asset RETURNING revision INTO next_revision;
  PERFORM app.write_audit(p_site,'user',actor,'document.organize','media',p_asset,NULL,p_asset,
    jsonb_build_object('revision',next_revision,'archived',p_archived));
  RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION app.initialize_document_metadata(),app.organize_site_document(uuid,uuid,bigint,text,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.organize_site_document(uuid,uuid,bigint,text,boolean) TO cms_authenticated_user;
ALTER TABLE public.site_document_metadata OWNER TO cms_migration_owner;
ALTER FUNCTION app.initialize_document_metadata() OWNER TO cms_migration_owner;
ALTER FUNCTION app.organize_site_document(uuid,uuid,bigint,text,boolean) OWNER TO cms_migration_owner;
