-- Exact, reviewed site-owned files. No section-field or trusted-code bypass.
CREATE TABLE public.site_files (
 id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES public.sites(id),
 kind text NOT NULL CHECK(kind IN ('script','stylesheet','image','font','data')),
 name text NOT NULL CHECK(name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'),
 source text NOT NULL CHECK(length(source) BETWEEN 1 AND 2000 AND source !~ '[[:cntrl:]]' AND source !~ '://[^/]*@'),
 object_key text NOT NULL UNIQUE,mime_type text NOT NULL,
 bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 26214400),sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,id),
 CHECK(object_key='site-files/'||site_id::text||'/'||id::text||'/'||sha256),
 CHECK((kind='script' AND mime_type='text/javascript' AND name ~* '\.js$' AND bytes<=5242880)
  OR (kind='stylesheet' AND mime_type='text/css' AND name ~* '\.css$' AND bytes<=5242880)
  OR (kind='image' AND mime_type IN ('image/png','image/jpeg','image/gif','image/webp','image/svg+xml'))
  OR (kind='font' AND mime_type IN ('font/woff','font/woff2','font/ttf','font/otf'))
  OR (kind='data' AND mime_type='application/json' AND name ~* '\.json$' AND bytes<=5242880))
);
CREATE TABLE public.site_file_versions (
 id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES public.sites(id),version bigint NOT NULL CHECK(version>0),
 bundle jsonb NOT NULL CHECK(app.json_within(bundle,262144)),
 reviewed_by uuid NOT NULL REFERENCES public.app_users(id),reviewed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,id),UNIQUE(site_id,version)
);
CREATE TABLE public.site_file_heads (
 site_id uuid PRIMARY KEY REFERENCES public.sites(id),revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 draft_version_id uuid,published_version_id uuid,
 FOREIGN KEY(site_id,draft_version_id) REFERENCES public.site_file_versions(site_id,id),
 FOREIGN KEY(site_id,published_version_id) REFERENCES public.site_file_versions(site_id,id)
);
CREATE TABLE public.site_release_file_pins (
 release_id uuid NOT NULL REFERENCES public.site_releases(id),site_id uuid NOT NULL REFERENCES public.sites(id),version_id uuid NOT NULL,
 PRIMARY KEY(release_id,version_id),FOREIGN KEY(site_id,version_id) REFERENCES public.site_file_versions(site_id,id)
);
ALTER TABLE public.site_files OWNER TO cms_migration_owner;
ALTER TABLE public.site_file_versions OWNER TO cms_migration_owner;
ALTER TABLE public.site_file_heads OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_file_pins OWNER TO cms_migration_owner;
ALTER TABLE public.site_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_file_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_file_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_release_file_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_files,public.site_file_versions,public.site_file_heads,public.site_release_file_pins FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT(id,site_id,kind,name,source,mime_type,bytes,sha256,created_by,created_at) ON public.site_files TO cms_authenticated_user;
GRANT SELECT ON public.site_file_versions,public.site_file_heads,public.site_release_file_pins TO cms_authenticated_user;
CREATE POLICY site_files_read ON public.site_files FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY site_file_versions_read ON public.site_file_versions FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY site_file_heads_read ON public.site_file_heads FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY site_release_file_pins_read ON public.site_release_file_pins FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE TRIGGER site_files_immutable BEFORE UPDATE OR DELETE ON public.site_files FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();
CREATE TRIGGER site_file_versions_immutable BEFORE UPDATE OR DELETE ON public.site_file_versions FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();
CREATE TRIGGER site_release_file_pins_immutable BEFORE UPDATE OR DELETE ON public.site_release_file_pins FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

CREATE FUNCTION app.register_site_file(p_site uuid,p_id uuid,p_kind text,p_name text,p_source text,p_mime text,p_bytes bigint,p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;old public.site_files;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can add or replace site files.' USING ERRCODE='CMS02';END IF;
 PERFORM 1 FROM public.sites WHERE id=p_site AND status<>'archived' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This site is unavailable.' USING ERRCODE='CMS03';END IF;
 SELECT * INTO old FROM public.site_files WHERE id=p_id;
 IF old.id IS NOT NULL THEN
  IF (old.site_id,old.kind,old.name,old.source,old.mime_type,old.bytes,old.sha256) IS DISTINCT FROM (p_site,p_kind,p_name,p_source,p_mime,p_bytes,p_hash) THEN
   RAISE EXCEPTION 'This file differs from its immutable reviewed receipt.' USING ERRCODE='CMS04';END IF;
  RETURN old.id;
 END IF;
 INSERT INTO public.site_files(id,site_id,kind,name,source,object_key,mime_type,bytes,sha256,created_by)
 VALUES(p_id,p_site,p_kind,p_name,p_source,'site-files/'||p_site::text||'/'||p_id::text||'/'||p_hash,p_mime,p_bytes,p_hash,actor);
 PERFORM app.write_audit(p_site,'user',actor,'site.file.register','site_file',p_id,NULL,p_id,jsonb_build_object('name',p_name,'source',p_source,'bytes',p_bytes,'sha256',p_hash));
 RETURN p_id;
END $$;

CREATE FUNCTION app.site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb;page jsonb;file public.site_files;seen uuid[]:='{}';selected_id uuid;
BEGIN
 IF jsonb_typeof(p_bundle) IS DISTINCT FROM 'object' OR p_bundle-ARRAY['version','files','scripts','styles']<>'{}'::jsonb
  OR p_bundle->'version' IS DISTINCT FROM '1'::jsonb THEN RETURN 'The reviewed file list is invalid.';END IF;
 IF jsonb_typeof(p_bundle->'files') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'files')>2000
  OR jsonb_typeof(p_bundle->'scripts') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'scripts')>64
  OR jsonb_typeof(p_bundle->'styles') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'styles')>64 THEN RETURN 'The reviewed file list is too large or incomplete.';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'files') LOOP
  IF jsonb_typeof(item)<>'string' THEN RETURN 'Every file needs its saved identity.';END IF;
  selected_id:=(item#>>'{}')::uuid;
  IF selected_id=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.site_files f WHERE f.id=selected_id AND f.site_id=p_site) THEN RETURN 'A file is repeated, missing or belongs to another site.';END IF;
  seen:=array_append(seen,selected_id);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'scripts') UNION ALL SELECT value FROM jsonb_array_elements(p_bundle->'styles') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'fileId') IS DISTINCT FROM 'string'
   OR item-ARRAY['fileId','pages','position','loading']<>'{}'::jsonb THEN RETURN 'A file loading choice is invalid.';END IF;
  SELECT * INTO file FROM public.site_files WHERE site_id=p_site AND public.site_files.id=(item->>'fileId')::uuid;
  IF file.id IS NULL OR NOT file.id=ANY(seen) THEN RETURN 'Every loaded file must belong to this reviewed version.';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_bundle->'scripts') s WHERE s=item) THEN
   IF file.kind<>'script' OR COALESCE(item->>'position','') NOT IN ('head','body-start','body-end') OR COALESCE(item->>'loading','') NOT IN ('normal','defer','async') THEN RETURN 'Choose the script position and loading order.';END IF;
  ELSIF file.kind<>'stylesheet' OR item-ARRAY['fileId','pages']<>'{}'::jsonb THEN RETURN 'Only a stylesheet can be loaded as a style.';END IF;
  IF jsonb_typeof(item->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'pages')>500 THEN RETURN 'Choose all pages or a list of pages on this site.';END IF;
  FOR page IN SELECT value FROM jsonb_array_elements(item->'pages') LOOP
   IF jsonb_typeof(page)<>'string' OR NOT EXISTS(SELECT 1 FROM public.pages p WHERE p.id=(page#>>'{}')::uuid AND p.site_id=p_site AND p.archived_at IS NULL) THEN RETURN 'A chosen page is unavailable or belongs to another site.';END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(item->'pages'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements(item->'pages')) THEN RETURN 'Choose each page only once.';END IF;
 END LOOP;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN 'A saved file or page identity is invalid.';
END $$;

CREATE FUNCTION app.save_site_file_bundle(p_site uuid,p_expected_revision bigint,p_bundle jsonb)
RETURNS TABLE(version_id uuid,revision bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.site_file_heads;defect text;created uuid:=gen_random_uuid();n bigint;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can review, replace or remove site scripts.' USING ERRCODE='CMS02';END IF;
 PERFORM 1 FROM public.sites WHERE id=p_site AND status<>'archived' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'This site is unavailable.' USING ERRCODE='CMS03';END IF;
 INSERT INTO public.site_file_heads(site_id) VALUES(p_site) ON CONFLICT DO NOTHING;
 SELECT * INTO head FROM public.site_file_heads WHERE site_id=p_site FOR UPDATE;
 IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'The reviewed files changed. Refresh and review them again.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 defect:=app.site_file_bundle_defect(p_site,p_bundle);
 IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 SELECT COALESCE(max(v.version),0)+1 INTO n FROM public.site_file_versions v WHERE v.site_id=p_site;
 INSERT INTO public.site_file_versions(id,site_id,version,bundle,reviewed_by) VALUES(created,p_site,n,p_bundle,actor);
 UPDATE public.site_file_heads SET draft_version_id=created,revision=head.revision+1 WHERE site_id=p_site;
 PERFORM app.write_audit(p_site,'user',actor,'site.files.review','site_files',p_site,head.draft_version_id,created,
  jsonb_build_object('version',n,'files',jsonb_array_length(p_bundle->'files'),'scripts',jsonb_array_length(p_bundle->'scripts')));
 RETURN QUERY SELECT created,head.revision+1;
END $$;

CREATE FUNCTION app.site_file_projection(p_site uuid,p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('versionId',v.id,'bundle',v.bundle,'files',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'id',f.id,'kind',f.kind,'name',f.name,'source',f.source,'bytes',f.bytes,'sha256',f.sha256) ORDER BY f.id)
 FROM public.site_files f WHERE f.site_id=p_site AND v.bundle->'files' @> to_jsonb(ARRAY[f.id::text])),'[]'::jsonb))
 FROM public.site_file_versions v WHERE v.site_id=p_site AND v.id=p_version
$$;
CREATE FUNCTION app.preview_site_files(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();
 IF NOT app.has_site_access(p_site) THEN RETURN NULL;END IF;
 RETURN app.site_file_projection(p_site,(SELECT draft_version_id FROM public.site_file_heads WHERE site_id=p_site));
END $$;
CREATE FUNCTION app.resolve_site_file(p_file uuid) RETURNS TABLE(id uuid,site_id uuid,kind text,name text,source text,object_key text,mime_type text,bytes bigint,sha256 text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();
 RETURN QUERY SELECT f.id,f.site_id,f.kind,f.name,f.source,f.object_key,f.mime_type,f.bytes,f.sha256 FROM public.site_files f WHERE f.id=p_file AND app.has_site_access(f.site_id);
END $$;
CREATE FUNCTION public_api.resolve_site_file(p_host text,p_file uuid) RETURNS TABLE(id uuid,site_id uuid,kind text,name text,source text,object_key text,mime_type text,bytes bigint,sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.id,f.site_id,f.kind,f.name,f.source,f.object_key,f.mime_type,f.bytes,f.sha256
 FROM public_api.resolve_host(p_host) host JOIN public.site_files f ON f.site_id=host.site_id
 JOIN public.site_file_heads h ON h.site_id=f.site_id JOIN public.site_file_versions v ON v.site_id=h.site_id AND v.id=h.published_version_id
 JOIN public.sites s ON s.id=h.site_id
 WHERE f.id=p_file AND v.bundle->'files' @> to_jsonb(ARRAY[f.id::text]) AND NOT s.initial_release_required
 AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=s.id)
$$;

ALTER FUNCTION app.rebuild_site_shell(uuid) RENAME TO rebuild_site_shell_before_site_files;
CREATE FUNCTION app.rebuild_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n bigint;projection jsonb;
BEGIN
 n:=app.rebuild_site_shell_before_site_files(p_site_id);
 projection:=app.site_file_projection(p_site_id,(SELECT published_version_id FROM public.site_file_heads WHERE site_id=p_site_id));
 IF projection IS NOT NULL THEN UPDATE public.published_site_shells SET payload=payload||jsonb_build_object('site_files',projection) WHERE site_id=p_site_id;END IF;
 RETURN n;
END $$;
ALTER FUNCTION app.release_fingerprint(uuid) RENAME TO release_fingerprint_before_site_files;
CREATE FUNCTION app.release_fingerprint(p_site_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous text;published uuid;
BEGIN
 PERFORM app.require_actor();
 previous:=app.release_fingerprint_before_site_files(p_site_id);
 SELECT published_version_id INTO published FROM public.site_file_heads WHERE site_id=p_site_id;
 IF published IS NULL THEN RETURN previous;END IF;
 RETURN encode(sha256(convert_to(previous||':site-files:'||published::text,'UTF8')),'hex');
END $$;
ALTER FUNCTION app.lock_release_site(uuid) RENAME TO lock_release_site_before_site_files;
CREATE FUNCTION app.lock_release_site(p_site_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();
 PERFORM app.lock_release_site_before_site_files(p_site_id);
 PERFORM 1 FROM public.site_file_heads WHERE site_id=p_site_id FOR UPDATE;
END $$;

CREATE FUNCTION app.publish_site_files(p_site uuid,p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.site_file_heads;defect text;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can publish approved site scripts.' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(p_site);
 SELECT * INTO head FROM public.site_file_heads WHERE site_id=p_site FOR UPDATE;
 IF head.site_id IS NULL OR head.draft_version_id IS NULL THEN RAISE EXCEPTION 'Review the site files before publishing.' USING ERRCODE='CMS04';END IF;
 IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'The reviewed files changed. Refresh and review again.' USING ERRCODE='CMS01';END IF;
 defect:=app.site_file_bundle_defect(p_site,(SELECT bundle FROM public.site_file_versions WHERE id=head.draft_version_id));
 IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 UPDATE public.site_file_heads SET published_version_id=head.draft_version_id,revision=head.revision+1 WHERE site_id=p_site;
 PERFORM app.rebuild_site_shell(p_site);
 PERFORM app.write_audit(p_site,'user',actor,'site.files.publish','site_files',p_site,head.published_version_id,head.draft_version_id,'{}');
 PERFORM app.emit_outbox(p_site,'site.files.published',jsonb_build_object('version_id',head.draft_version_id));
 RETURN head.revision+1;
END $$;
CREATE FUNCTION app.site_file_publication_must_finish() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.published_version_id IS DISTINCT FROM OLD.published_version_id AND EXISTS(SELECT 1 FROM public.site_file_heads h WHERE h.site_id=NEW.site_id AND h.published_version_id IS NOT DISTINCT FROM NEW.published_version_id)
 AND NOT EXISTS(SELECT 1 FROM public.site_releases r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot) item
  WHERE r.site_id=NEW.site_id AND r.status='applied' AND r.finished_at>=transaction_timestamp() AND item->>'type'='site_files' AND item->>'id'=NEW.site_id::text
  AND ((NEW.published_version_id IS NOT NULL AND item->>'versionId'=NEW.published_version_id::text AND COALESCE(item->>'action','publish')='publish')
   OR (NEW.published_version_id IS NULL AND item->>'action'='unpublish' AND item ? 'recoveryId'))) THEN
  RAISE EXCEPTION 'Site scripts must publish through a complete reviewed site release.' USING ERRCODE='CMS04';END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER site_file_publication_complete AFTER UPDATE ON public.site_file_heads
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.site_file_publication_must_finish();

ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) RENAME TO release_recovery_payload_before_site_files;
CREATE FUNCTION app.release_recovery_payload(p_item jsonb,p_draft boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF p_item->>'type'<>'site_files' THEN RETURN app.release_recovery_payload_before_site_files(p_item,p_draft);END IF;
 SELECT bundle INTO result FROM public.site_file_versions WHERE site_id=(p_item->>'id')::uuid AND id=(p_item->>CASE WHEN p_draft THEN 'draft' ELSE 'published' END)::uuid;
 RETURN result;
END $$;
ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.release_recovery_payload(jsonb,boolean),app.release_recovery_payload_before_site_files(jsonb,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) RENAME TO capture_release_recovery_items_before_site_files;
CREATE FUNCTION app.capture_release_recovery_items(p_site uuid,p_targets jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;target jsonb;head public.site_file_heads;
BEGIN
 result:=app.capture_release_recovery_items_before_site_files(p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_targets) WHERE value->>'type'<>'site_files'));
 FOR target IN SELECT value FROM jsonb_array_elements(p_targets) WHERE value->>'type'='site_files' LOOP
  SELECT * INTO head FROM public.site_file_heads WHERE site_id=p_site AND site_id=(target->>'id')::uuid;
  IF head.site_id IS NULL OR target->>'key'<>'site_files:'||p_site::text THEN RAISE EXCEPTION 'The site files are unavailable or belong to another site.' USING ERRCODE='CMS04';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('key',target->>'key','type','site_files','id',p_site,'implicit',false,'revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id,'label','Site scripts and files'));
 END LOOP;
 RETURN result;
END $$;
ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) RENAME TO pin_release_recovery_items_before_site_files;
CREATE FUNCTION app.pin_release_recovery_items(p_release uuid,p_site uuid,p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb;pin uuid;
BEGIN
 PERFORM app.pin_release_recovery_items_before_site_files(p_release,p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_items) WHERE value->>'type'<>'site_files'));
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) WHERE value->>'type'='site_files' LOOP
  FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(item->'draft',item->'published')) WHERE value IS NOT NULL LOOP
   INSERT INTO public.site_release_file_pins(release_id,site_id,version_id) VALUES(p_release,p_site,pin) ON CONFLICT DO NOTHING;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app.prepare_site_release_recovery(p_request uuid,p_release uuid,p_expected jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
<<recovery_prepare>>
DECLARE actor uuid; receipt public.site_releases; capture public.site_release_recovery_captures; previous public.site_release_recoveries;
  review jsonb; before_item jsonb; current_item jsonb; current_items jsonb; src RECORD; head RECORD; saved RECORD;
  entries jsonb; checkpoints jsonb:='[]'; items jsonb:='[]'; item jsonb; checkpoint uuid; was_unpublished boolean;
BEGIN
  actor:=app.require_actor();
  IF p_request IS NULL THEN RAISE EXCEPTION 'recovery needs a request reference' USING ERRCODE='CMS04'; END IF;
  SELECT * INTO receipt FROM public.site_releases WHERE id=p_release;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
  PERFORM app.lock_release_site(receipt.site_id);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,102));
  SELECT * INTO previous FROM public.site_release_recoveries WHERE id=p_request;
  IF previous.id IS NOT NULL THEN
    IF previous.source_release_id IS DISTINCT FROM p_release OR previous.prepared_by IS DISTINCT FROM actor
      OR previous.expected_state IS DISTINCT FROM p_expected THEN
      RAISE EXCEPTION 'this recovery request was already used for another intention' USING ERRCODE='CMS04';
    END IF;
    RETURN jsonb_build_object('recoveryId',previous.id,'siteId',previous.site_id,'sourceReleaseId',previous.source_release_id,
      'items',previous.items,'preservedDrafts',previous.preserved_drafts);
  END IF;
  review:=app.review_site_release_recovery(p_release);
  IF (review->>'available')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%',review->>'reason' USING ERRCODE='CMS04'; END IF;
  IF review->'expectedState' IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'the recovery targets changed; review their current state again' USING ERRCODE='CMS01'; END IF;
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=p_release;
  IF capture.was_private AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=receipt.site_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(capture.before_items) b WHERE b->>'type'='page' AND b->>'id'=r.page_id::text)) THEN
    RAISE EXCEPTION 'This first release can return to private only after later, unrelated published pages are reviewed and unpublished separately.' USING ERRCODE='CMS04';
  END IF;
  current_items:=p_expected->'items';
  PERFORM app.pin_release_recovery_items(p_release,receipt.site_id,current_items);
  INSERT INTO public.site_release_recoveries(id,site_id,source_release_id,expected_state,prepared_by)
    VALUES(p_request,receipt.site_id,p_release,p_expected,actor);
  -- Schemas precede record batches so restored records pin the newly created
  -- recovery schema. All mutations are rolled back together on any blocker.
  FOR before_item IN SELECT value FROM jsonb_array_elements(capture.before_items)
    ORDER BY CASE value->>'type' WHEN 'collection_schema' THEN 0 WHEN 'collection_entries' THEN 2 ELSE 1 END,value->>'key'
  LOOP
    SELECT value INTO current_item FROM jsonb_array_elements(current_items) WHERE value->>'key'=before_item->>'key';
    checkpoints:=checkpoints||jsonb_build_array(jsonb_build_object('key',current_item->>'key','type',current_item->>'type','id',current_item->>'id','label',current_item->>'label',
      'versionId',current_item->'draft','secondaryVersionId',current_item->'secondaryDraft','entryVersionIds',CASE WHEN current_item->>'type'='collection_entries'
        THEN (SELECT COALESCE(jsonb_agg(e->'draft' ORDER BY e->>'id'),'[]'::jsonb) FROM jsonb_array_elements(current_item->'entries') e WHERE e->>'draft' IS NOT NULL) ELSE NULL END));
    was_unpublished:=CASE WHEN before_item->>'type'='collection_entries' THEN before_item->>'publishedRevision'='0' ELSE before_item->>'published' IS NULL END;
    -- A content-policy refusal (deleted media, archived page, incomplete pair)
    -- aborts the whole preparation; name the affected item so the author can
    -- repair that blocker instead of guessing which part of the release failed.
    BEGIN
    CASE before_item->>'type'
      WHEN 'page' THEN
        SELECT * INTO head FROM public.pages WHERE id=(before_item->>'id')::uuid;
        IF head.archived_at IS NOT NULL THEN RAISE EXCEPTION 'restore this archived page before preparing release recovery' USING ERRCODE='CMS04'; END IF;
        IF head.draft_version_id IS NOT NULL THEN
          SELECT * INTO src FROM public.page_versions WHERE id=head.draft_version_id;
          SELECT * INTO saved FROM app.save_page_draft(head.id,head.revision,src.content,src.meta,'checkpoint','Draft preserved before coordinated release recovery');
          checkpoint:=saved.version_id;
          INSERT INTO public.site_release_pages(release_id,site_id,page_id,version_id) VALUES(p_release,receipt.site_id,head.id,checkpoint) ON CONFLICT DO NOTHING;
          checkpoints:=jsonb_set(checkpoints,ARRAY[(jsonb_array_length(checkpoints)-1)::text,'versionId'],to_jsonb(checkpoint));
          head.revision:=saved.revision;
        END IF;
        IF NOT was_unpublished THEN
          PERFORM app.restore_version_as_draft(head.id,head.revision,(before_item->>'published')::uuid,'Recover state before release '||p_release::text);
        END IF;
      WHEN 'site_files' THEN
        IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can restore reviewed site scripts.' USING ERRCODE='CMS02';END IF;
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.site_file_versions WHERE id=(before_item->>'published')::uuid AND site_id=receipt.site_id;
          IF src.id IS NULL THEN RAISE EXCEPTION 'The reviewed site files are unavailable.' USING ERRCODE='CMS04';END IF;
          PERFORM app.save_site_file_bundle(receipt.site_id,(current_item->>'revision')::bigint,src.bundle);
        END IF;
      WHEN 'theme' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'a site admin must recover theme changes' USING ERRCODE='CMS02'; END IF;
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.theme_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained theme version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_theme_draft(receipt.site_id,(current_item->>'revision')::bigint,src.tokens);
        END IF;
      WHEN 'navigation' THEN
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.navigation_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained navigation version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_navigation_draft(receipt.site_id,(current_item->>'revision')::bigint,src.tree,before_item->>'mode');
        END IF;
      WHEN 'frame' THEN
        IF (before_item->>'published' IS NULL) IS DISTINCT FROM (before_item->>'secondaryPublished' IS NULL) THEN
          RAISE EXCEPTION 'this historical frame does not retain a complete published pair' USING ERRCODE='CMS04';
        END IF;
        IF NOT was_unpublished THEN
          SELECT h.content AS header,f.content AS footer INTO src FROM public.global_element_versions h,public.global_element_versions f
            WHERE h.id=(before_item->>'published')::uuid AND f.id=(before_item->>'secondaryPublished')::uuid;
          IF src.header IS NULL OR src.footer IS NULL THEN RAISE EXCEPTION 'a retained frame version is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_global_elements_draft(receipt.site_id,(current_item->>'revision')::bigint,(current_item->>'secondaryRevision')::bigint,src.header,src.footer);
        END IF;
      WHEN 'collection_schema' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'a site admin must recover collection schema changes' USING ERRCODE='CMS02'; END IF;
        IF NOT was_unpublished THEN
          SELECT * INTO src FROM public.collection_schema_versions WHERE id=(before_item->>'published')::uuid;
          IF src.id IS NULL THEN RAISE EXCEPTION 'the retained collection schema is missing' USING ERRCODE='CMS04'; END IF;
          PERFORM app.save_collection_schema((before_item->>'id')::uuid,(current_item->>'revision')::bigint,src.fields,src.sort);
        END IF;
      WHEN 'collection_entries' THEN
        IF NOT was_unpublished THEN
          SELECT * INTO head FROM public.collections WHERE id=(before_item->>'id')::uuid;
          IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(capture.before_items) b WHERE b->>'type'='collection_schema' AND b->>'id'=before_item->>'id')
            AND (head.draft_schema_version_id IS DISTINCT FROM head.published_schema_version_id
              OR head.published_schema_version_id IS DISTINCT FROM (before_item->>'published')::uuid) THEN
            RAISE EXCEPTION 'The collection schema changed outside this release. Review that schema separately before recovering these records.' USING ERRCODE='CMS04';
          END IF;
          SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e->'id','stableKey',e->'stableKey','values',v."values") ORDER BY (e->>'publishedSort')::int,e->>'id'),'[]')
            INTO entries FROM jsonb_array_elements(before_item->'entries') e JOIN public.collection_entry_versions v ON v.id=(e->>'published')::uuid
            WHERE e->>'published' IS NOT NULL AND e->>'publishedArchived' IS NULL;
          PERFORM app.save_collection_entries(head.id,head.entry_revision,entries);
        END IF;
    END CASE;
    EXCEPTION WHEN SQLSTATE 'CMS04' THEN
      RAISE EXCEPTION 'Recovery is blocked for “%”: %',COALESCE(current_item->>'label',before_item->>'label','an affected item'),SQLERRM
        USING ERRCODE='CMS04';
    END;
  END LOOP;
  -- Pin every new recovery version and create the only permitted release scope.
  current_items:=app.capture_release_recovery_items(receipt.site_id,capture.before_items);
  PERFORM app.pin_release_recovery_items(p_release,receipt.site_id,current_items);
  FOR current_item IN SELECT value FROM jsonb_array_elements(current_items) LOOP
    SELECT value INTO before_item FROM jsonb_array_elements(capture.before_items) WHERE value->>'key'=current_item->>'key';
    was_unpublished:=CASE WHEN before_item->>'type'='collection_entries' THEN before_item->>'publishedRevision'='0' ELSE before_item->>'published' IS NULL END;
    item:=jsonb_build_object('key',current_item->>'key','type',current_item->>'type','id',current_item->>'id','label',current_item->>'label',
      'revision',current_item->>'revision','versionId',current_item->'draft','action',CASE WHEN was_unpublished THEN 'unpublish' ELSE 'publish' END,'recoveryId',p_request);
    IF current_item->>'type'='frame' THEN item:=item||jsonb_build_object('secondaryRevision',current_item->>'secondaryRevision','secondaryVersionId',current_item->'secondaryDraft'); END IF;
    IF current_item->>'type' IN ('theme','collection_schema') THEN item:=item||'{"requiresAdmin":true}'::jsonb; END IF;
    items:=items||jsonb_build_array(item);
  END LOOP;
  UPDATE public.site_release_recoveries SET items=recovery_prepare.items,prepared_state=current_items,preserved_drafts=checkpoints WHERE id=p_request;
  PERFORM app.write_audit(receipt.site_id,'user',actor,'release.recovery.prepare','site_release',p_release,NULL,NULL,
    jsonb_build_object('recovery_id',p_request,'affected_items',jsonb_array_length(items),'preserved_drafts',jsonb_array_length(checkpoints)));
  RETURN jsonb_build_object('recoveryId',p_request,'siteId',receipt.site_id,'sourceReleaseId',p_release,'items',items,'preservedDrafts',checkpoints);
END $$;

CREATE OR REPLACE FUNCTION app.apply_release_recovery_unpublishes(p_recovery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recovery public.site_release_recoveries; capture public.site_release_recovery_captures; actor uuid; item jsonb; target uuid; rev bigint;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO recovery FROM public.site_release_recoveries WHERE id=p_recovery FOR UPDATE;
  IF recovery.id IS NULL THEN RAISE EXCEPTION 'recovery not found' USING ERRCODE='CMS03'; END IF;
  PERFORM app.lock_release_site(recovery.site_id);
  PERFORM app.check_release_recovery_selection(recovery.site_id,recovery.items);
  SELECT * INTO capture FROM public.site_release_recovery_captures WHERE release_id=recovery.source_release_id;
  IF capture.was_private AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=recovery.site_id
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(recovery.items) i WHERE i->>'type'='page' AND i->>'action'='unpublish' AND i->>'id'=r.page_id::text)) THEN
    RAISE EXCEPTION 'Later, unrelated published pages must be reviewed and unpublished before this first release can return to private.' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.site_release_recoveries SET applying=true WHERE id=p_recovery;
  -- A coordinated old-schema/old-record restoration may remove a field present
  -- in the current live records. Stage those record pointers out of the way
  -- before the ordinary schema publisher validates them; its paired ordinary
  -- records publisher installs the reviewed batch immediately afterwards.
  -- No revisions are rewound or consumed for this transaction-local staging.
  -- The deferred guard forbids committing it without the complete receipt.
  UPDATE public.collection_entries e SET published_version_id=NULL
    WHERE e.site_id=recovery.site_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(recovery.items) schema_item
      JOIN LATERAL jsonb_array_elements(recovery.items) record_item ON record_item->>'id'=schema_item->>'id'
      WHERE schema_item->>'type'='collection_schema' AND schema_item->>'action'='publish'
        AND record_item->>'type'='collection_entries' AND record_item->>'action'='publish'
        AND schema_item->>'id'=e.collection_id::text);
  FOR item IN SELECT value FROM jsonb_array_elements(recovery.items) WHERE value->>'action'='unpublish'
    ORDER BY CASE value->>'type' WHEN 'page' THEN 0 WHEN 'collection_entries' THEN 1 ELSE 2 END,value->>'key'
  LOOP
    target:=(item->>'id')::uuid;
    CASE item->>'type'
      WHEN 'page' THEN PERFORM app.unpublish_page(target,(item->>'revision')::bigint);
      WHEN 'site_files' THEN
        IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can remove published site scripts.' USING ERRCODE='CMS02';END IF;
        UPDATE public.site_file_heads SET published_version_id=NULL,revision=revision+1 WHERE site_id=recovery.site_id;
      WHEN 'theme' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'a site admin must unpublish this theme' USING ERRCODE='CMS02'; END IF;
        UPDATE public.themes SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'navigation' THEN
        UPDATE public.navigations SET published_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'frame' THEN
        UPDATE public.global_elements SET published_version_id=NULL,revision=revision+1 WHERE site_id=recovery.site_id;
      WHEN 'collection_entries' THEN
        UPDATE public.collection_entries SET published_version_id=NULL,published_archived_at=NULL,published_sort_index=0,revision=revision+1
          WHERE collection_id=target AND site_id=recovery.site_id;
        UPDATE public.collections SET entry_revision=entry_revision+1,published_entry_revision=0 WHERE id=target AND site_id=recovery.site_id;
      WHEN 'collection_schema' THEN
        IF NOT app.can_administer_site(recovery.site_id) THEN RAISE EXCEPTION 'a site admin must unpublish this collection schema' USING ERRCODE='CMS02'; END IF;
        UPDATE public.collections SET published_schema_version_id=NULL,revision=revision+1 WHERE id=target AND site_id=recovery.site_id;
      ELSE RAISE EXCEPTION 'unsupported recovery action' USING ERRCODE='CMS04';
    END CASE;
    IF item->>'type'<>'page' THEN
      PERFORM app.write_audit(recovery.site_id,'user',actor,'release.recovery.unpublish','site_release',recovery.source_release_id,NULL,NULL,
        jsonb_build_object('recovery_id',p_recovery,'key',item->>'key'));
      PERFORM app.emit_outbox(recovery.site_id,'site.recovery.changed',jsonb_build_object('recovery_id',p_recovery,'key',item->>'key'));
    END IF;
  END LOOP;
  IF capture.was_private THEN
    IF EXISTS(SELECT 1 FROM public.published_routes WHERE site_id=recovery.site_id) THEN RAISE EXCEPTION 'recovery would hide unrelated published pages' USING ERRCODE='CMS04'; END IF;
    UPDATE public.sites SET initial_release_required=true WHERE id=recovery.site_id;
  END IF;
  PERFORM app.rebuild_site_shell(recovery.site_id);
END $$;

CREATE OR REPLACE FUNCTION app.schedule_release_action(
 p_release_id uuid,p_run_at timestamptz,p_override text,p_samples_confirmed boolean,p_request_id uuid,p_policy int
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; plan RECORD; old RECORD; created uuid; check_row jsonb; findings jsonb;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id;
 IF plan.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
 PERFORM app.lock_release_site(plan.site_id);
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id FOR UPDATE;
 IF (EXISTS(SELECT 1 FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'type'='site_files') AND NOT app.is_super_admin()) OR NOT app.can_publish(plan.site_id) OR (EXISTS(SELECT 1 FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'requiresAdmin'='true') AND NOT app.can_administer_site(plan.site_id)) THEN
  RAISE EXCEPTION 'you cannot schedule these changes' USING ERRCODE='CMS02';
 END IF;
 IF p_request_id IS NULL OR p_policy IS NULL OR p_policy<1 OR p_samples_confirmed IS NULL OR length(COALESCE(p_override,''))>2000 THEN
  RAISE EXCEPTION 'a schedule needs an explicit review and request reference' USING ERRCODE='CMS04';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,56));
 SELECT * INTO old FROM public.scheduled_actions WHERE request_id=p_request_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by<>actor OR old.item_type<>'release' OR old.item_id<>p_release_id OR old.run_at IS DISTINCT FROM p_run_at
   OR old.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') OR old.samples_confirmed IS DISTINCT FROM p_samples_confirmed OR old.readiness_policy_version IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'this schedule request was used for different choices' USING ERRCODE='CMS04';
  END IF;
  RETURN old.id;
 END IF;
 IF plan.status<>'planned' OR EXISTS(SELECT 1 FROM public.sites WHERE id=plan.site_id AND status='archived') THEN
  RAISE EXCEPTION 'only a pending release on an active site can be scheduled' USING ERRCODE='CMS04';
 END IF;
 IF app.release_fingerprint(plan.site_id) IS DISTINCT FROM plan.context_hash THEN
  RAISE EXCEPTION 'the site changed; review these changes again' USING ERRCODE='CMS01';
 END IF;
 IF NOT app.scheduling_available() THEN RAISE EXCEPTION 'no healthy scheduling worker is available' USING ERRCODE='CMS04'; END IF;
 IF p_run_at IS NULL OR p_run_at<clock_timestamp()+interval '1 minute' OR p_run_at>clock_timestamp()+interval '2 years' THEN
  RAISE EXCEPTION 'choose a time at least a minute from now and within two years' USING ERRCODE='CMS04';
 END IF;
 FOR check_row IN SELECT value FROM jsonb_array_elements(plan.preview_report) LOOP
  IF (check_row->'report'->>'policyVersion')::int IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'the publishing checks changed; review these changes again' USING ERRCODE='CMS04';
  END IF;
  findings:=check_row->'report'->'findings';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(findings) finding WHERE finding->>'rule'='sample_content' AND finding->>'severity'='blocking') AND NOT p_samples_confirmed THEN
   RAISE EXCEPTION 'confirm the sample content before scheduling' USING ERRCODE='CMS04';
  END IF;
  IF p_samples_confirmed THEN SELECT COALESCE(jsonb_agg(value),'[]') INTO findings FROM jsonb_array_elements(findings) WHERE value->>'rule'<>'sample_content'; END IF;
  PERFORM app.assert_publishable(findings,(check_row->'report'->>'policyVersion')::int,p_override);
 END LOOP;
 INSERT INTO public.scheduled_actions(site_id,item_type,item_id,version_id,action,run_at,created_by,readiness_policy_version,request_id,override_reason,authorized_findings,samples_confirmed)
 VALUES(plan.site_id,'release',plan.id,plan.id,'publish',p_run_at,actor,p_policy,p_request_id,NULLIF(btrim(p_override),''),plan.preview_report,p_samples_confirmed) RETURNING id INTO created;
 PERFORM app.write_audit(plan.site_id,'user',actor,'schedule.create','scheduled_action',created,NULL,plan.id,
  jsonb_build_object('release_id',plan.id,'run_at',p_run_at,'samples_confirmed',p_samples_confirmed,'override_reason',NULLIF(btrim(p_override),'')));
 RETURN created;
END $$;

ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_file_bundle_defect(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.site_file_projection(uuid,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_file_projection(uuid,uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.site_file_publication_must_finish() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_file_publication_must_finish() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.rebuild_site_shell(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.rebuild_site_shell(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.capture_release_recovery_items(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.register_site_file(uuid,uuid,text,text,text,text,bigint,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.register_site_file(uuid,uuid,text,text,text,text,bigint,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.save_site_file_bundle(uuid,bigint,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.save_site_file_bundle(uuid,bigint,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.publish_site_files(uuid,bigint) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.publish_site_files(uuid,bigint) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.preview_site_files(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.preview_site_files(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.resolve_site_file(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.resolve_site_file(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.release_fingerprint(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.release_fingerprint(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.lock_release_site(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.lock_release_site(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.register_site_file(uuid,uuid,text,text,text,text,bigint,text) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.save_site_file_bundle(uuid,bigint,jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_site_files(uuid,bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.preview_site_files(uuid) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.resolve_site_file(uuid) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.release_fingerprint(uuid) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.lock_release_site(uuid) TO cms_authenticated_user;
REVOKE ALL ON FUNCTION app.rebuild_site_shell_before_site_files(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.release_fingerprint_before_site_files(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.lock_release_site_before_site_files(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.capture_release_recovery_items_before_site_files(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
REVOKE ALL ON FUNCTION app.pin_release_recovery_items_before_site_files(uuid,uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION public_api.resolve_site_file(text,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.resolve_site_file(text,uuid) FROM PUBLIC,cms_authenticated_user,cms_worker;
GRANT EXECUTE ON FUNCTION public_api.resolve_site_file(text,uuid) TO cms_public_renderer;
