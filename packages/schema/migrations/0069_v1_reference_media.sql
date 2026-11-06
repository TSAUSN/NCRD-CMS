-- A reference draft is not approved merely because its static markup is safe.
-- Preserve review as an exact immutable-version gate on every publish path.
CREATE FUNCTION app.require_v1_reference_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source_record uuid; approved_version uuid;
BEGIN
  IF NEW.published_version_id IS NULL OR NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id THEN RETURN NEW; END IF;
  SELECT r.id INTO source_record FROM public.v1_import_targets t JOIN public.v1_import_records r
    ON r.run_id=t.run_id AND r.source_key=t.source_key WHERE t.page_id=NEW.id;
  IF source_record IS NULL THEN RETURN NEW; END IF;
  SELECT CASE WHEN d.disposition='mapped' THEN d.target_page_version ELSE NULL END INTO approved_version
    FROM public.v1_import_decisions d WHERE d.record_id=source_record ORDER BY d.revision DESC LIMIT 1;
  IF approved_version IS DISTINCT FROM NEW.published_version_id THEN
    RAISE EXCEPTION 'This V1 reference requires a migration review of this exact saved version before publication.' USING ERRCODE='CMS04';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION app.require_v1_reference_review() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.require_v1_reference_review() FROM PUBLIC;
CREATE TRIGGER pages_v1_reference_review BEFORE UPDATE OF published_version_id ON public.pages
  FOR EACH ROW EXECUTE FUNCTION app.require_v1_reference_review();

CREATE TABLE public.v1_import_media (
  run_id uuid NOT NULL REFERENCES public.v1_import_runs(id),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  source_path text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  media_id uuid NOT NULL REFERENCES public.media(id),
  PRIMARY KEY(run_id,site_id,source_path)
);
ALTER TABLE public.v1_import_media OWNER TO cms_migration_owner;
ALTER TABLE public.v1_import_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY v1_import_media_read ON public.v1_import_media FOR SELECT TO cms_authenticated_user USING(app.is_super_admin());
GRANT SELECT ON public.v1_import_media TO cms_authenticated_user;
CREATE TRIGGER v1_import_media_immutable BEFORE UPDATE OR DELETE ON public.v1_import_media
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

CREATE FUNCTION app.import_v1_inspected_media(p_run uuid,p_site uuid,p_path text,p_source_hash text,p_media uuid,p_original jsonb,p_variants jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; existing RECORD; object_prefix text; variant jsonb; source_bundle jsonb;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin can import inspected V1 media' USING ERRCODE='CMS02'; END IF;
  SELECT bundle INTO source_bundle FROM public.v1_import_runs WHERE id=p_run;
  IF source_bundle IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source_bundle->'files') f
    WHERE f->>'path'=p_path AND f->>'sha256'=p_source_hash AND p_path LIKE 'asset/%/public/%') THEN
    RAISE EXCEPTION 'image is absent from the frozen V1 source manifest' USING ERRCODE='CMS04';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=p_site AND status<>'archived') THEN
    RAISE EXCEPTION 'import destination is unavailable' USING ERRCODE='CMS04'; END IF;
  object_prefix:='v1-imports/'||p_run::text||'/'||p_site::text||'/'||p_media::text||'/';
  IF p_media IS NULL OR jsonb_typeof(p_original) IS DISTINCT FROM 'object' OR jsonb_typeof(p_variants) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_variants)<>3 OR p_original->>'objectKey' NOT LIKE object_prefix||'%'
    OR COALESCE(p_original->>'sha256','') !~ '^[0-9a-f]{64}$'
    OR p_original->>'objectKey' ~ '(\.\.|[[:space:]\\])'
    OR (SELECT array_agg(v->>'kind' ORDER BY v->>'kind') FROM jsonb_array_elements(p_variants)v) IS DISTINCT FROM ARRAY['card','thumbnail','wide']::text[] THEN
    RAISE EXCEPTION 'invalid inspected V1 media package' USING ERRCODE='CMS04'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_run::text||p_site::text||p_path,69));
  SELECT x.*,m.object_key,m.content_hash INTO existing FROM public.v1_import_media x JOIN public.media m ON m.id=x.media_id
    WHERE x.run_id=p_run AND x.site_id=p_site AND x.source_path=p_path;
  IF existing IS NOT NULL THEN
    IF existing.media_id<>p_media OR existing.source_sha256<>p_source_hash OR existing.object_key<>p_original->>'objectKey'
      OR existing.content_hash<>p_original->>'sha256' THEN RAISE EXCEPTION 'V1 media retry does not match its immutable receipt' USING ERRCODE='CMS04'; END IF;
    RETURN existing.media_id;
  END IF;
  INSERT INTO public.media(id,site_id,object_key,original_name,mime_type,bytes,width,height,content_hash,alt_text,decorative,status,uploaded_by,folder,source,revision)
    VALUES(p_media,p_site,p_original->>'objectKey',regexp_replace(p_path,'^.*/',''),p_original->>'mimeType',(p_original->>'bytes')::bigint,
      (p_original->>'width')::int,(p_original->>'height')::int,p_original->>'sha256',p_original->>'altText',
      (p_original->>'decorative')::boolean,'ready',actor,'V1 migration',p_path,1);
  FOR variant IN SELECT value FROM jsonb_array_elements(p_variants) LOOP
    IF variant->>'objectKey' NOT LIKE object_prefix||'variants/'||(variant->>'kind')||'/%'
      OR variant->>'objectKey' ~ '(\.\.|[[:space:]\\])' OR variant->>'mimeType' IS DISTINCT FROM 'image/webp'
      OR COALESCE(variant->>'sha256','') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid inspected V1 media variant' USING ERRCODE='CMS04'; END IF;
    INSERT INTO public.media_variants(media_id,kind,object_key,width,height,bytes,mime_type,content_hash)
      VALUES(p_media,variant->>'kind',variant->>'objectKey',(variant->>'width')::int,(variant->>'height')::int,
        (variant->>'bytes')::bigint,variant->>'mimeType',variant->>'sha256');
  END LOOP;
  INSERT INTO public.v1_import_media(run_id,site_id,source_path,source_sha256,media_id) VALUES(p_run,p_site,p_path,p_source_hash,p_media);
  PERFORM app.write_audit(p_site,'migration',NULL,'migration.v1.media','media',p_media,NULL,p_media,
    jsonb_build_object('run_id',p_run,'source_sha256',p_source_hash,'inspected_sha256',p_original->>'sha256'));
  PERFORM app.emit_outbox(p_site,'media.ready',jsonb_build_object('media_id',p_media));
  RETURN p_media;
END $$;
ALTER FUNCTION app.import_v1_inspected_media(uuid,uuid,text,text,uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.import_v1_inspected_media(uuid,uuid,text,text,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.import_v1_inspected_media(uuid,uuid,text,text,uuid,jsonb,jsonb) TO cms_authenticated_user;
