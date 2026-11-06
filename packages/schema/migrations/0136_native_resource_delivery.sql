-- An approved native mapping is an explicit published reference, never a
-- bearer permission for all owned assets. Preserve the prior readers intact.
ALTER FUNCTION public_api.resolve_media(text,uuid,text) RENAME TO resolve_media_before_native;
CREATE FUNCTION public_api.resolve_media(p_host text,p_media_id uuid,p_variant text)
RETURNS TABLE(media_id uuid,variant text,object_key text,mime_type text,bytes bigint,width integer,height integer,content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH existing AS MATERIALIZED(SELECT * FROM public_api.resolve_media_before_native(p_host,p_media_id,p_variant))
 SELECT * FROM existing
 UNION ALL
 SELECT m.id,p_variant,CASE WHEN p_variant='original' THEN m.object_key ELSE v.object_key END,
  CASE WHEN p_variant='original' THEN m.mime_type ELSE v.mime_type END,
  CASE WHEN p_variant='original' THEN m.bytes ELSE v.bytes END,
  CASE WHEN p_variant='original' THEN m.width ELSE v.width END,
  CASE WHEN p_variant='original' THEN m.height ELSE v.height END,
  CASE WHEN p_variant='original' THEN m.content_hash ELSE v.content_hash END
 FROM public_api.resolve_host(p_host) h JOIN public.media m ON m.site_id=h.site_id
 LEFT JOIN public.media_variants v ON v.media_id=m.id AND v.kind=p_variant AND p_variant<>'original'
 WHERE m.id=p_media_id AND m.status='ready' AND m.deleted_at IS NULL AND m.purged_at IS NULL
 AND p_variant IN('original','thumbnail','card','wide') AND(p_variant='original' OR v.id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM existing)
 AND EXISTS(SELECT 1 FROM app.published_site_native_aliases(p_host) a
  WHERE a->>'kind'='media' AND (a->>'mediaId')::uuid=m.id AND a->'variants' @> jsonb_build_array(p_variant))
$$;
ALTER FUNCTION public_api.resolve_site_asset(text,uuid) RENAME TO resolve_site_asset_before_native;
CREATE FUNCTION public_api.resolve_site_asset(p_host text,p_asset uuid)
RETURNS TABLE(id uuid,kind text,object_key text,mime_type text,bytes bigint,content_hash text,original_name text,font_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH existing AS MATERIALIZED(SELECT * FROM public_api.resolve_site_asset_before_native(p_host,p_asset))
 SELECT * FROM existing
 UNION ALL
 SELECT a.id,a.kind,a.object_key,a.mime_type,a.bytes,a.content_hash,a.original_name,a.font_key
 FROM public_api.resolve_host(p_host) h JOIN public.site_assets a ON a.site_id=h.site_id
 WHERE a.id=p_asset AND NOT EXISTS(SELECT 1 FROM existing)
 AND EXISTS(SELECT 1 FROM app.published_site_native_aliases(p_host) n
  WHERE n->>'kind'='asset' AND(n->>'assetId')::uuid=a.id)
$$;

-- A separate immutable usage ledger avoids misclassifying site files as pages.
CREATE TABLE public.site_file_media_usage(
 media_id uuid NOT NULL REFERENCES public.media(id),site_id uuid NOT NULL,
 version_id uuid NOT NULL,PRIMARY KEY(media_id,version_id),
 FOREIGN KEY(site_id,version_id) REFERENCES public.site_file_versions(site_id,id)
);
ALTER TABLE public.site_file_media_usage OWNER TO cms_migration_owner;
ALTER TABLE public.site_file_media_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_file_media_usage FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.site_file_media_usage TO cms_authenticated_user;
CREATE POLICY site_file_media_usage_read ON public.site_file_media_usage FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
INSERT INTO public.site_file_media_usage(media_id,site_id,version_id)
 SELECT DISTINCT(a.value->>'mediaId')::uuid,v.site_id,v.id FROM public.site_file_versions v
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.bundle->'native','[]')) a
 WHERE a.value->>'kind'='media' ON CONFLICT DO NOTHING;
CREATE FUNCTION app.capture_site_file_media_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Match media deletion's row lock. A concurrent delete cannot overlook a
 -- newly committed reference; drafts may retain deleted historical choices.
 PERFORM 1 FROM public.media m WHERE m.id IN(SELECT(a.value->>'mediaId')::uuid
  FROM jsonb_array_elements(COALESCE(NEW.bundle->'native','[]')) a WHERE a.value->>'kind'='media') ORDER BY m.id FOR SHARE;
 INSERT INTO public.site_file_media_usage(media_id,site_id,version_id)
 SELECT DISTINCT(a.value->>'mediaId')::uuid,NEW.site_id,NEW.id
 FROM jsonb_array_elements(COALESCE(NEW.bundle->'native','[]')) a WHERE a.value->>'kind'='media';
 RETURN NEW;
END $$;
CREATE TRIGGER site_file_media_usage_capture AFTER INSERT ON public.site_file_versions FOR EACH ROW EXECUTE FUNCTION app.capture_site_file_media_usage();

ALTER FUNCTION app.publish_site_files(uuid,bigint) RENAME TO publish_site_files_before_native_availability;
CREATE FUNCTION app.publish_site_files(p_site uuid,p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected uuid;loaded_revision bigint;
BEGIN
 PERFORM app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can publish approved site scripts.' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(p_site);
 SELECT draft_version_id,revision INTO selected,loaded_revision FROM public.site_file_heads WHERE site_id=p_site FOR UPDATE;
 IF loaded_revision IS NOT NULL AND loaded_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'The reviewed files changed. Refresh and review again.' USING ERRCODE='CMS01';END IF;
 -- Use the same site-head then media-lock order as review/transfer commands.
 PERFORM 1 FROM public.media m JOIN public.site_file_media_usage u ON u.media_id=m.id
 WHERE u.version_id=selected ORDER BY m.id FOR SHARE OF m;
 IF EXISTS(SELECT 1 FROM public.site_file_media_usage u JOIN public.media m ON m.id=u.media_id
  WHERE u.version_id=selected AND(m.status<>'ready' OR m.deleted_at IS NOT NULL OR m.purged_at IS NOT NULL))THEN
  RAISE EXCEPTION 'A reviewed image is unavailable. Restore it or change the site file choices before publishing.' USING ERRCODE='CMS04';END IF;
 RETURN app.publish_site_files_before_native_availability(p_site,p_expected_revision);
END $$;

-- Preserve authorization, revision, audit and retention semantics; include
-- immutable reviewed-file usage in the existing break-reference decision.
CREATE OR REPLACE FUNCTION app.soft_delete_media(
  p_media_id uuid, p_expected_revision bigint,
  p_break_references boolean, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid; row public.media%ROWTYPE; usage_count bigint;
  next_revision bigint; deleted timestamptz; retention_until timestamptz; event_id bigint;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.can_administer_site(row.site_id)) THEN
    RAISE EXCEPTION 'only a site admin may delete media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'ready' THEN
    RAISE EXCEPTION 'only ready media can be deleted' USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;

  SELECT count(*) INTO usage_count FROM(
    SELECT version_id FROM public.media_usage WHERE media_id=row.id
    UNION SELECT version_id FROM public.site_file_media_usage WHERE media_id=row.id
  ) references_to_image;
  IF p_reason IS NOT NULL AND p_reason <> ''
     AND (p_reason <> btrim(p_reason) OR char_length(p_reason) > 1000
          OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'media deletion reason is invalid' USING ERRCODE = 'CMS04';
  END IF;
  IF usage_count > 0 AND NOT COALESCE(p_break_references, false) THEN
    RAISE EXCEPTION 'media is referenced by % saved version(s)', usage_count
      USING ERRCODE = 'CMS04', DETAIL = usage_count::text;
  END IF;
  IF usage_count > 0 AND (p_reason IS NULL OR p_reason <> btrim(p_reason)
      OR char_length(p_reason) NOT BETWEEN 8 AND 1000 OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'breaking media references requires a bounded reason'
      USING ERRCODE = 'CMS04';
  END IF;

  deleted := statement_timestamp();
  retention_until := deleted + interval '30 days';
  next_revision := row.revision + 1;
  UPDATE public.media SET status = 'deleted', deleted_at = deleted, purged_at = NULL,
                          revision = next_revision WHERE id = row.id;

  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.delete', 'media', row.id,
    row.id, NULL,
    jsonb_build_object('revision', next_revision, 'usage_count', usage_count,
      'break_references', COALESCE(p_break_references, false),
      'reason', COALESCE(p_reason, ''), 'deleted_at', deleted,
      'retention_until', retention_until));
  PERFORM app.emit_outbox(row.site_id, 'media.deleted',
    jsonb_build_object('media_id', row.id, 'revision', next_revision));
  event_id := app.emit_outbox(row.site_id, 'media.cleanup_requested',
    jsonb_build_object('media_id', row.id, 'deleted_revision', next_revision,
      'not_before', retention_until));
  UPDATE public.outbox SET next_attempt_at = retention_until WHERE id = event_id;
  RETURN next_revision;
END
$$;

ALTER FUNCTION public_api.resolve_media(text,uuid,text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_site_asset(text,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.capture_site_file_media_usage() OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_site_files(uuid,bigint) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.resolve_media_before_native(text,uuid,text),public_api.resolve_site_asset_before_native(text,uuid),app.capture_site_file_media_usage(),app.publish_site_files_before_native_availability(uuid,bigint),public_api.resolve_media(text,uuid,text),public_api.resolve_site_asset(text,uuid),app.publish_site_files(uuid,bigint) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION public_api.resolve_media(text,uuid,text),public_api.resolve_site_asset(text,uuid) TO cms_public_renderer;
GRANT EXECUTE ON FUNCTION app.publish_site_files(uuid,bigint) TO cms_authenticated_user;


-- File publication affects every current page. Capture that route set in the
-- transaction, so the worker does not infer dependencies from later state.
CREATE FUNCTION app.capture_site_file_publication_routes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 NEW.payload:=NEW.payload||jsonb_build_object('paths',COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path) FROM public.published_routes r WHERE r.site_id=NEW.site_id),'[]'::jsonb),
  'revision',COALESCE((SELECT h.revision FROM public.site_file_heads h WHERE h.site_id=NEW.site_id),0));
 RETURN NEW;
END $$;
ALTER FUNCTION app.capture_site_file_publication_routes() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.capture_site_file_publication_routes() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE TRIGGER site_file_publication_routes BEFORE INSERT ON public.outbox FOR EACH ROW WHEN(NEW.event_type='site.files.published') EXECUTE FUNCTION app.capture_site_file_publication_routes();
-- Older reviewed-file releases emitted only their version identity. Retain
-- their work and add the current owned route set for safe delayed delivery.
UPDATE public.outbox e SET payload=e.payload||jsonb_build_object('paths',COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path) FROM public.published_routes r WHERE r.site_id=e.site_id),'[]'::jsonb),
 'revision',COALESCE((SELECT h.revision FROM public.site_file_heads h WHERE h.site_id=e.site_id),0))
 WHERE e.event_type='site.files.published' AND NOT(e.payload ? 'paths');
