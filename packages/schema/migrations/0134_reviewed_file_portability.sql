-- Reviewed artifacts travel as private history, never inherited publication.
ALTER FUNCTION app.export_site_content(uuid) RENAME TO export_site_content_before_site_files;
CREATE FUNCTION app.export_site_content(p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE archive jsonb;
BEGIN
 archive:=app.export_site_content_before_site_files(p_site_id);
 archive:=jsonb_set(archive,'{content}',archive->'content'||jsonb_build_object(
  'site_files',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM (SELECT id,kind,name,source,sha256,bytes,created_at FROM public.site_files WHERE site_id=p_site_id) r),'[]'::jsonb),
  'site_file_versions',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.version) FROM (SELECT id,version,bundle,reviewed_at FROM public.site_file_versions WHERE site_id=p_site_id) r),'[]'::jsonb),
  'site_file_heads',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT revision,draft_version_id,published_version_id FROM public.site_file_heads WHERE site_id=p_site_id) r),'[]'::jsonb)));
 RETURN jsonb_set(archive,'{objects}',archive->'objects'||COALESCE((SELECT jsonb_agg(jsonb_build_object('media_id',id,'kind','site-file','object_key',object_key,'sha256',sha256) ORDER BY id) FROM public.site_files WHERE site_id=p_site_id),'[]'::jsonb));
END $$;

-- Archived bindings may name an archived page. Keep those immutable choices;
-- a fresh publication still runs the ordinary present-day availability check.
CREATE FUNCTION app.archived_site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized jsonb:=p_bundle;kind text;binding jsonb;page jsonb;
BEGIN
 FOREACH kind IN ARRAY ARRAY['scripts','styles'] LOOP
  IF jsonb_typeof(p_bundle->kind) IS DISTINCT FROM 'array' THEN RETURN 'The reviewed loading choices are incomplete.';END IF;
  FOR binding IN SELECT value FROM jsonb_array_elements(p_bundle->kind) LOOP
   IF jsonb_typeof(binding->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(binding->'pages')>500
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(binding->'pages')) THEN RETURN 'The archived page choices are invalid.';END IF;
   FOR page IN SELECT value FROM jsonb_array_elements(binding->'pages') LOOP
    IF jsonb_typeof(page) IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM public.pages WHERE site_id=p_site AND id::text=page#>>'{}') THEN RETURN 'An archived file names a foreign or missing page.';END IF;
   END LOOP;
  END LOOP;
  normalized:=jsonb_set(normalized,ARRAY[kind],COALESCE((SELECT jsonb_agg(jsonb_set(value,'{pages}','[]'::jsonb)) FROM jsonb_array_elements(p_bundle->kind)),'[]'::jsonb));
 END LOOP;
 RETURN app.site_file_bundle_defect(p_site,normalized);
END $$;

ALTER FUNCTION app.import_site_content(uuid,jsonb,jsonb) RENAME TO import_site_content_before_site_files;
CREATE FUNCTION app.import_site_content(p_request_id uuid,p_bundle jsonb,p_source_heads jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;result uuid;was_imported boolean;table_name text;item jsonb;head jsonb;defect text;file_count integer;version_count integer;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can import site files.' USING ERRCODE='CMS02';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,61));
 was_imported:=EXISTS(SELECT 1 FROM app.site_content_imports WHERE request_id=p_request_id);
 -- This fingerprints the complete supplied bundle, including all new lists
 -- and the review acknowledgement; retries cannot swap an artifact or choice.
 result:=app.import_site_content_before_site_files(p_request_id,p_bundle,p_source_heads);
 IF was_imported THEN RETURN result;END IF;
 IF NOT(p_bundle ?| ARRAY['site_files','site_file_versions','site_file_heads'])THEN RETURN result;END IF;
 FOREACH table_name IN ARRAY ARRAY['site_files','site_file_versions','site_file_heads'] LOOP
  IF jsonb_typeof(p_bundle->table_name) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->table_name)>(CASE table_name WHEN 'site_files' THEN 2000 WHEN 'site_file_heads' THEN 1 ELSE 20000 END) THEN
   RAISE EXCEPTION 'The reviewed file archive is incomplete or too large.' USING ERRCODE='CMS04';END IF;
 END LOOP;
 file_count:=jsonb_array_length(p_bundle->'site_files');version_count:=jsonb_array_length(p_bundle->'site_file_versions');
 IF file_count>0 AND p_bundle->'site_file_reviewed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Review every site file before importing it.' USING ERRCODE='CMS04';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'site_files') LOOP
  IF item-ARRAY['id','kind','name','source','sha256','bytes','created_at','object_key','mime_type']<>'{}'::jsonb
   OR item->>'object_key' IS DISTINCT FROM 'site-files/'||result::text||'/'||(item->>'id')||'/'||(item->>'sha256')
   OR item->>'source' ~ '[[:cntrl:]]|://[^/]*@' THEN RAISE EXCEPTION 'An imported file receipt is invalid.' USING ERRCODE='CMS04';END IF;
  INSERT INTO public.site_files(id,site_id,kind,name,source,object_key,mime_type,bytes,sha256,created_by,created_at)
   VALUES((item->>'id')::uuid,result,item->>'kind',item->>'name',item->>'source',item->>'object_key',item->>'mime_type',(item->>'bytes')::bigint,item->>'sha256',actor,(item->>'created_at')::timestamptz);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'site_file_versions') LOOP
  IF item-ARRAY['id','version','bundle','reviewed_at']<>'{}'::jsonb THEN RAISE EXCEPTION 'An imported reviewed version is invalid.' USING ERRCODE='CMS04';END IF;
  defect:=app.archived_site_file_bundle_defect(result,item->'bundle');
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
  INSERT INTO public.site_file_versions(id,site_id,version,bundle,reviewed_by,reviewed_at)
   VALUES((item->>'id')::uuid,result,(item->>'version')::bigint,item->'bundle',actor,(item->>'reviewed_at')::timestamptz);
 END LOOP;
 head:=p_bundle->'site_file_heads'->0;
 IF head IS NULL AND version_count>0 THEN RAISE EXCEPTION 'The reviewed file head is missing.' USING ERRCODE='CMS04';END IF;
 IF head IS NOT NULL THEN
  IF head-ARRAY['revision','draft_version_id','published_version_id']<>'{}'::jsonb OR (head->>'revision')::bigint<version_count OR (version_count=0 AND (head->>'revision')::bigint<>0)
   OR EXISTS(SELECT 1 FROM public.site_file_versions WHERE site_id=result AND version>version_count)
   OR (version_count>0 AND head->>'draft_version_id' IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_each(head) field WHERE field.key IN ('draft_version_id','published_version_id') AND field.value<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM public.site_file_versions WHERE site_id=result AND id::text=field.value#>>'{}')) THEN
   RAISE EXCEPTION 'The reviewed file history or pointers are invalid.' USING ERRCODE='CMS04';END IF;
  INSERT INTO public.site_file_heads(site_id,revision,draft_version_id,published_version_id)
   VALUES(result,(head->>'revision')::bigint,(head->>'draft_version_id')::uuid,NULL);
 END IF;
 IF file_count>0 OR version_count>0 THEN PERFORM app.write_audit(result,'user',actor,'site.files.import','site_files',result,NULL,(head->>'draft_version_id')::uuid,
  jsonb_build_object('files',file_count,'versions',version_count,'publication','private','reviewed',true));END IF;
 RETURN result;
END $$;
ALTER FUNCTION app.export_site_content(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.import_site_content(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.archived_site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.export_site_content_before_site_files(uuid),app.import_site_content_before_site_files(uuid,jsonb,jsonb),app.archived_site_file_bundle_defect(uuid,jsonb),app.export_site_content(uuid),app.import_site_content(uuid,jsonb,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.export_site_content(uuid),app.import_site_content(uuid,jsonb,jsonb) TO cms_authenticated_user;
