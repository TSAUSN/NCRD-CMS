-- Extend the existing release/recovery contract; no independent public write path.
DO $$BEGIN
 IF to_regprocedure('app.release_fingerprint_before_chapters(uuid)') IS NULL THEN ALTER FUNCTION app.release_fingerprint(uuid) RENAME TO release_fingerprint_before_chapters;END IF;
 IF to_regprocedure('app.lock_release_site_before_chapters(uuid)') IS NULL THEN ALTER FUNCTION app.lock_release_site(uuid) RENAME TO lock_release_site_before_chapters;END IF;
 IF to_regprocedure('app.capture_release_recovery_items_before_chapters(uuid,jsonb)') IS NULL THEN ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) RENAME TO capture_release_recovery_items_before_chapters;END IF;
 IF to_regprocedure('app.pin_release_recovery_items_before_chapters(uuid,uuid,jsonb)') IS NULL THEN ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) RENAME TO pin_release_recovery_items_before_chapters;END IF;
 IF to_regprocedure('app.release_recovery_payload_before_chapters(jsonb,boolean)') IS NULL THEN ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) RENAME TO release_recovery_payload_before_chapters;END IF;
END$$;
CREATE OR REPLACE FUNCTION app.release_recovery_payload(p_item jsonb,p_draft boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_item->>'type'='chapter_setup' THEN RETURN (SELECT config FROM public.chapter_versions WHERE id=(p_item->>CASE WHEN p_draft THEN 'draft' ELSE 'published' END)::uuid AND chapter_id=(p_item->>'id')::uuid);END IF;
 RETURN app.release_recovery_payload_before_chapters(p_item,p_draft);
END$$;
CREATE TABLE IF NOT EXISTS public.site_release_chapter_pins(
 release_id uuid NOT NULL REFERENCES public.site_releases(id),site_id uuid NOT NULL REFERENCES public.sites(id),version_id uuid NOT NULL REFERENCES public.chapter_versions(id),PRIMARY KEY(release_id,version_id)
);
ALTER TABLE public.site_release_chapter_pins OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_chapter_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_release_chapter_pins FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.site_release_chapter_pins TO cms_authenticated_user;
DROP POLICY IF EXISTS site_release_chapter_pins_visible ON public.site_release_chapter_pins;
CREATE POLICY site_release_chapter_pins_visible ON public.site_release_chapter_pins FOR SELECT TO cms_authenticated_user USING(app.site_role(site_id)='site_admin');
CREATE OR REPLACE FUNCTION app.pin_release_recovery_items(p_release uuid,p_site uuid,p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb;pin uuid;
BEGIN
 PERFORM app.pin_release_recovery_items_before_chapters(p_release,p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_items) WHERE value->>'type'<>'chapter_setup'));
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) WHERE value->>'type'='chapter_setup' LOOP
  FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(item->'draft',item->'published')) WHERE value IS NOT NULL LOOP
   IF NOT EXISTS(SELECT 1 FROM public.chapter_versions WHERE id=pin AND site_id=p_site) THEN RAISE EXCEPTION 'A chapter recovery version belongs to another site.' USING ERRCODE='CMS04';END IF;
   INSERT INTO public.site_release_chapter_pins(release_id,site_id,version_id) VALUES(p_release,p_site,pin) ON CONFLICT DO NOTHING;
  END LOOP;
 END LOOP;
END$$;
CREATE OR REPLACE FUNCTION app.release_fingerprint(p_site_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous text;state jsonb;
BEGIN
 PERFORM app.require_actor();previous:=app.release_fingerprint_before_chapters(p_site_id);
 SELECT jsonb_agg(jsonb_build_object('id',id,'revision',revision,'draft',draft_version_id,'published',published_version_id) ORDER BY id) INTO state FROM public.chapters WHERE site_id=p_site_id;
 IF state IS NULL THEN RETURN previous;END IF;
 RETURN encode(sha256(convert_to(previous||':chapters:'||state::text,'UTF8')),'hex');
END$$;
CREATE OR REPLACE FUNCTION app.lock_release_site(p_site_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM app.require_actor();PERFORM app.lock_release_site_before_chapters(p_site_id);PERFORM 1 FROM public.chapters WHERE site_id=p_site_id ORDER BY id FOR UPDATE;END$$;
CREATE OR REPLACE FUNCTION app.capture_release_recovery_items(p_site uuid,p_targets jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;target jsonb;head record;targets jsonb;
BEGIN
 result:=app.capture_release_recovery_items_before_chapters(p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_targets) WHERE value->>'type'<>'chapter_setup'));
 targets:=(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_targets) WHERE value->>'type'='chapter_setup');
 FOR head IN SELECT c.id FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=p_site AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_targets) p WHERE p->>'type'='page' AND p->>'id'=v.config->>'pageId') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(targets) t WHERE t->>'id'=head.id::text) THEN targets:=targets||jsonb_build_array(jsonb_build_object('key','chapter_setup:'||head.id::text,'type','chapter_setup','id',head.id,'implicit',true));END IF;
 END LOOP;
 FOR target IN SELECT value FROM jsonb_array_elements(targets) ORDER BY value->>'key' LOOP
  SELECT c.*,v.config->>'name' AS name INTO head FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=p_site AND c.id=(target->>'id')::uuid;
  IF head.id IS NULL THEN RAISE EXCEPTION 'Chapter setup is missing or belongs to another site.' USING ERRCODE='CMS04';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('key',target->>'key','type','chapter_setup','id',head.id,'label',head.name||' · chapter setup','revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id,'implicit',COALESCE((target->>'implicit')::boolean,false)));
 END LOOP;
 RETURN result;
END$$;
-- Add a closed case to the existing recovery implementation while retaining
-- its full revision, receipt, role, preservation and atomicity checks.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.prepare_site_release_recovery(uuid,uuid,jsonb)'::regprocedure);
 IF position('WHEN ''chapter_setup'' THEN' IN body)=0 THEN
  updated:=replace(body,'WHEN ''site_files'' THEN',$case$WHEN 'chapter_setup' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'A site administrator must recover chapter setup.' USING ERRCODE='CMS02';END IF;
        IF NOT was_unpublished THEN
          SELECT v.config,c.slug INTO src FROM public.chapter_versions v JOIN public.chapters c ON c.id=v.chapter_id WHERE v.id=(before_item->>'published')::uuid AND v.site_id=receipt.site_id;
          IF src.config IS NULL THEN RAISE EXCEPTION 'The retained chapter setup is unavailable.' USING ERRCODE='CMS04';END IF;
          PERFORM app.save_chapter_setup(receipt.site_id,(before_item->>'id')::uuid,(current_item->>'revision')::bigint,src.slug,src.config);
        END IF;
      WHEN 'site_files' THEN$case$);
  IF updated=body THEN RAISE EXCEPTION 'Chapter recovery insertion point changed.';END IF;
  updated:=replace(updated,'WHEN ''collection_schema'' THEN 0','WHEN ''chapter_setup'' THEN -1 WHEN ''collection_schema'' THEN 0');
  updated:=replace(updated,'IN (''theme'',''collection_schema'')','IN (''theme'',''collection_schema'',''chapter_setup'')');
  EXECUTE updated;
 END IF;
 body:=pg_get_functiondef('app.apply_release_recovery_unpublishes(uuid)'::regprocedure);
 IF position('WHEN ''chapter_setup'' THEN' IN body)=0 THEN
  updated:=replace(body,'WHEN ''site_files'' THEN',$case$WHEN 'chapter_setup' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'A site administrator must remove a chapter listing.' USING ERRCODE='CMS02';END IF;
        UPDATE public.chapters SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id RETURNING revision INTO rev;
        PERFORM app.emit_outbox(recovery.site_id,'page.published',jsonb_build_object('site_id',recovery.site_id,'paths',(SELECT COALESCE(jsonb_agg(path),'[]'::jsonb) FROM public.published_routes WHERE site_id=recovery.site_id),'revision',rev));
      WHEN 'site_files' THEN$case$);
  IF updated=body THEN RAISE EXCEPTION 'Chapter unpublish insertion point changed.';END IF;EXECUTE updated;
 END IF;
END$$;
ALTER FUNCTION app.release_fingerprint(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.lock_release_site(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.release_fingerprint(uuid),app.lock_release_site(uuid),app.capture_release_recovery_items(uuid,jsonb),app.release_fingerprint_before_chapters(uuid),app.lock_release_site_before_chapters(uuid),app.capture_release_recovery_items_before_chapters(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb),app.pin_release_recovery_items_before_chapters(uuid,uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.release_recovery_payload(jsonb,boolean),app.release_recovery_payload_before_chapters(jsonb,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.release_fingerprint(uuid),app.lock_release_site(uuid) TO cms_authenticated_user;
