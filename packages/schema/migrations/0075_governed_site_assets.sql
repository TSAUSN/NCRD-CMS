-- Immutable, private-until-used documents and exact registered migration fonts.
CREATE FUNCTION app.registered_font_matches(p_key text,p_hash text,p_mime text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT CASE p_key
 WHEN 'trajan-regular' THEN p_hash='b258e7ebe568f70dfc384dfe04a2fdaa74eef872cb5c56e0043cfe069ced02bc' AND p_mime='font/otf'
 WHEN 'proxima-regular' THEN p_hash='f715d9c3a8a59c2f8079955680d811dfdf069f769d8521d830c85ae3393dc6a8' AND p_mime='font/ttf'
 WHEN 'jenson-regular' THEN p_hash='68b3689550cac18a2c209785203f7d67922a51064e7b44992156f62b9dc9e611' AND p_mime='font/woff2'
 WHEN 'jenson-italic' THEN p_hash='e70fba59ad76f97a1f4a68020bcc5d1ae4975392b97767029ba0fe3a6c1477e6' AND p_mime='font/woff2'
 WHEN 'jenson-light' THEN p_hash='9b15b11877c9adf34720d2ef5d8ca2ced9b42807db5c347aa1a6c6be10d9c509' AND p_mime='font/woff2'
 WHEN 'jenson-semibold' THEN p_hash='5411c003271a7bf8332019f08a47034a160f4244885cc45fed8291484885d69a' AND p_mime='font/woff2'
 WHEN 'jenson-bold' THEN p_hash='91a515f88997c48342409aa05288783f951e09f2fbc7aa69b665944d55167c4b' AND p_mime='font/woff2' ELSE false END $$;

CREATE TABLE public.site_assets (
 id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES public.sites(id),
 kind text NOT NULL CHECK(kind IN ('document','font')), object_key text NOT NULL UNIQUE,
 mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 26214400),
 content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 original_name text NOT NULL CHECK(char_length(original_name) BETWEEN 1 AND 255 AND original_name !~ '[[:cntrl:]/\\]'),
 font_key text, provenance jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL REFERENCES public.app_users(id),
 CHECK((kind='document' AND mime_type='application/pdf' AND font_key IS NULL)
   OR (kind='font' AND font_key IS NOT NULL AND app.registered_font_matches(font_key,content_hash,mime_type))),
 CHECK(object_key ~ '^(site-assets|site-imports)/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-z0-9/.-]+$' AND object_key !~ '\.\.'),
 CHECK(jsonb_typeof(provenance)='object' AND COALESCE(provenance->>'sha256','')=content_hash
   AND COALESCE(provenance->>'manifest_sha256','') ~ '^[a-f0-9]{64}$'
   AND char_length(COALESCE(provenance->>'path','')) BETWEEN 1 AND 1000),
 UNIQUE(site_id,id)
);
CREATE TABLE public.site_asset_usage (
 asset_id uuid NOT NULL, site_id uuid NOT NULL, page_id uuid NOT NULL REFERENCES public.pages(id),
 version_id uuid NOT NULL REFERENCES public.page_versions(id), PRIMARY KEY(asset_id,version_id),
 FOREIGN KEY(site_id,asset_id) REFERENCES public.site_assets(site_id,id)
);
ALTER TABLE public.site_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_asset_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_assets_read ON public.site_assets FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY site_asset_usage_read ON public.site_asset_usage FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
REVOKE ALL ON public.site_assets,public.site_asset_usage FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT(id,site_id,kind,mime_type,bytes,content_hash,original_name,font_key,provenance,created_at) ON public.site_assets TO cms_authenticated_user;
GRANT SELECT ON public.site_asset_usage TO cms_authenticated_user;
CREATE TRIGGER site_assets_immutable BEFORE UPDATE OR DELETE ON public.site_assets FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();
CREATE TRIGGER site_asset_usage_immutable BEFORE UPDATE OR DELETE ON public.site_asset_usage FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

CREATE FUNCTION app.import_site_asset(p_site uuid,p_id uuid,p_kind text,p_key text,p_mime text,p_bytes bigint,p_hash text,p_name text,p_font text,p_provenance jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; existing public.site_assets;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may import frozen assets' USING ERRCODE='CMS02'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=p_site AND status<>'archived') THEN RAISE EXCEPTION 'asset destination is unavailable' USING ERRCODE='CMS03'; END IF;
 IF p_key IS DISTINCT FROM 'site-assets/'||p_site::text||'/'||p_id::text||'/'||p_hash THEN RAISE EXCEPTION 'invalid immutable asset key' USING ERRCODE='CMS04'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,75));
 SELECT * INTO existing FROM public.site_assets WHERE id=p_id;
 IF existing.id IS NOT NULL THEN
  IF (existing.site_id,existing.kind,existing.object_key,existing.mime_type,existing.bytes,existing.content_hash,existing.original_name,existing.font_key,existing.provenance)
    IS DISTINCT FROM (p_site,p_kind,p_key,p_mime,p_bytes,p_hash,p_name,p_font,p_provenance) THEN RAISE EXCEPTION 'asset retry differs from immutable receipt' USING ERRCODE='CMS04'; END IF;
  RETURN p_id;
 END IF;
 INSERT INTO public.site_assets(id,site_id,kind,object_key,mime_type,bytes,content_hash,original_name,font_key,provenance,created_by)
 VALUES(p_id,p_site,p_kind,p_key,p_mime,p_bytes,p_hash,p_name,p_font,p_provenance,actor);
 PERFORM app.write_audit(p_site,'user',actor,'asset.import','media',p_id,NULL,p_id,jsonb_build_object('kind',p_kind,'sha256',p_hash));
 RETURN p_id;
END $$;

CREATE FUNCTION app.site_asset_references(p_content jsonb) RETURNS SETOF uuid
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE node jsonb; candidate text; match text[];
BEGIN
 FOR node IN WITH RECURSIVE walk(value) AS (
  SELECT p_content UNION ALL SELECT child.value FROM walk CROSS JOIN LATERAL (
   SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(walk.value)='array' THEN walk.value ELSE '[]'::jsonb END)
   UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(walk.value)='object' THEN walk.value ELSE '{}'::jsonb END)
  ) child
 ) SELECT value FROM walk LOOP
  IF jsonb_typeof(node)='object' AND node ? 'asset_id' THEN
   candidate:=node->>'asset_id';
   IF candidate IS NULL OR candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid site asset reference' USING ERRCODE='CMS04'; END IF;
   RETURN NEXT candidate::uuid;
  ELSIF jsonb_typeof(node)='string' THEN
   FOR match IN SELECT regexp_matches(node#>>'{}','/assets/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})([^0-9a-f-]|$)','gi') LOOP
    RETURN NEXT match[1]::uuid;
   END LOOP;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION app.index_new_page_site_assets() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE asset uuid;
BEGIN
 FOR asset IN SELECT DISTINCT app.site_asset_references(jsonb_build_object('content',NEW.content,'meta',NEW.meta)) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.site_assets WHERE id=asset AND site_id=NEW.site_id) THEN RAISE EXCEPTION 'page asset is missing or belongs to another site' USING ERRCODE='CMS04'; END IF;
  INSERT INTO public.site_asset_usage(asset_id,site_id,page_id,version_id) VALUES(asset,NEW.site_id,NEW.page_id,NEW.id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER page_versions_index_site_assets AFTER INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.index_new_page_site_assets();

CREATE FUNCTION app.resolve_site_asset(p_asset uuid) RETURNS TABLE(id uuid,kind text,object_key text,mime_type text,bytes bigint,content_hash text,original_name text,font_key text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();
 RETURN QUERY SELECT a.id,a.kind,a.object_key,a.mime_type,a.bytes,a.content_hash,a.original_name,a.font_key FROM public.site_assets a WHERE a.id=p_asset AND app.has_site_access(a.site_id);
END $$;
CREATE FUNCTION public_api.resolve_site_asset(p_host text,p_asset uuid) RETURNS TABLE(id uuid,kind text,object_key text,mime_type text,bytes bigint,content_hash text,original_name text,font_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT a.id,a.kind,a.object_key,a.mime_type,a.bytes,a.content_hash,a.original_name,a.font_key FROM public_api.resolve_host(p_host) h JOIN public.site_assets a ON a.site_id=h.site_id
 WHERE a.id=p_asset AND EXISTS(SELECT 1 FROM public.site_asset_usage u JOIN public.pages p ON p.id=u.page_id AND p.site_id=u.site_id
  WHERE u.asset_id=a.id AND u.version_id=p.published_version_id AND p.status='published' AND p.archived_at IS NULL)
$$;

ALTER FUNCTION app.build_render_manifest_internal(uuid) RENAME TO build_render_manifest_before_site_assets;
CREATE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manifest jsonb;
BEGIN
 manifest:=app.build_render_manifest_before_site_assets(p_page_version_id);
 RETURN manifest||jsonb_build_object('fonts',COALESCE((SELECT jsonb_agg(jsonb_build_object('assetId',a.id,'fontKey',a.font_key) ORDER BY a.font_key)
  FROM public.site_assets a JOIN public.site_asset_usage u ON u.asset_id=a.id WHERE u.version_id=p_page_version_id AND a.kind='font'),'[]'::jsonb));
END $$;

ALTER FUNCTION app.export_site_content(uuid) RENAME TO export_site_content_before_assets;
CREATE FUNCTION app.export_site_content(p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE archive jsonb;
BEGIN
 archive:=app.export_site_content_before_assets(p_site_id);
 RETURN jsonb_set(archive,'{content}',archive->'content'||jsonb_build_object('site_assets',COALESCE((SELECT jsonb_agg(to_jsonb(a)-'site_id'-'object_key'-'created_by' ORDER BY a.id) FROM public.site_assets a WHERE a.site_id=p_site_id),'[]'::jsonb)))
 ||jsonb_build_object('objects',(archive->'objects')||COALESCE((SELECT jsonb_agg(jsonb_build_object('media_id',a.id,'kind','asset','object_key',a.object_key,'sha256',a.content_hash) ORDER BY a.id) FROM public.site_assets a WHERE a.site_id=p_site_id),'[]'::jsonb));
END $$;

-- Replace the latest immutable import command, including its existing guards.
CREATE OR REPLACE FUNCTION app.import_site_content(p_request_id uuid,p_bundle jsonb,p_source_heads jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; fingerprint text; existing RECORD; item jsonb; defect text; row_value jsonb; header_kind text; table_name text; reference text[];
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may import a site' USING ERRCODE='CMS02'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_bundle) IS DISTINCT FROM 'object'
 OR octet_length(p_bundle::text)>67108864 OR octet_length(p_source_heads::text)>4194304 THEN
 RAISE EXCEPTION 'invalid or oversized site import' USING ERRCODE='CMS04'; END IF;
 FOREACH table_name IN ARRAY ARRAY['pages','page_versions','themes','theme_versions','site_settings','site_setting_versions','navigations','navigation_versions','global_elements','global_element_versions','section_defs','section_def_versions','collections','collection_schema_versions','collection_entries','collection_entry_versions','media','media_variants'] LOOP
 IF jsonb_typeof(p_bundle->table_name) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->table_name)>20000 THEN
 RAISE EXCEPTION 'site import is missing a bounded content list' USING ERRCODE='CMS04'; END IF;
 END LOOP;
 IF jsonb_array_length(p_bundle->'themes')<>1 OR jsonb_array_length(p_bundle->'navigations')<>1
 OR jsonb_array_length(p_bundle->'site_settings')<>1 OR jsonb_array_length(p_bundle->'global_elements')<>2 THEN
 RAISE EXCEPTION 'site import is missing shared workspaces' USING ERRCODE='CMS04'; END IF;
 fingerprint:=encode(sha256(convert_to(p_bundle::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,61));
 SELECT * INTO existing FROM app.site_content_imports WHERE request_id=p_request_id;
 IF existing.request_id IS NOT NULL THEN
 IF existing.actor_id<>actor OR existing.fingerprint<>fingerprint THEN RAISE EXCEPTION 'this import request was used for different content' USING ERRCODE='CMS04'; END IF;
 RETURN existing.site_id;
 END IF;
 IF COALESCE(p_bundle->'site'->>'slug','') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(p_bundle->'site'->>'slug')>40
 OR char_length(btrim(COALESCE(p_bundle->'site'->>'name',''))) NOT BETWEEN 1 AND 120 THEN
 RAISE EXCEPTION 'invalid import destination' USING ERRCODE='CMS04'; END IF;
 INSERT INTO public.sites(id,slug,name,kind,status,created_by)
 VALUES(p_request_id,p_bundle->'site'->>'slug',p_bundle->'site'->>'name',(p_bundle->'site'->>'kind')::site_kind,'in_progress',actor);
 -- The normal site-insert trigger seeds a frame. This new site's baseline is
 -- replaced inside this transaction; no pre-existing site is touched.
 UPDATE public.global_elements SET draft_version_id=NULL,published_version_id=NULL WHERE site_id=p_request_id;
 DELETE FROM public.global_element_versions WHERE site_id=p_request_id;
 DELETE FROM public.global_elements WHERE site_id=p_request_id;

 -- Assets precede page versions so immutable usage is indexed by the same
 -- transaction, before any private draft becomes visible to its new owner.
 IF p_bundle ? 'site_assets' AND (jsonb_typeof(p_bundle->'site_assets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'site_assets')>2000) THEN
 RAISE EXCEPTION 'invalid bounded site asset list' USING ERRCODE='CMS04'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_bundle->'site_assets','[]'::jsonb)) LOOP
 IF COALESCE(item->>'object_key','') NOT LIKE 'site-imports/'||p_request_id::text||'/'||(item->>'id')||'/asset/%'
  OR item->>'object_key' ~ '(\.\.|[[:space:]\\])' THEN RAISE EXCEPTION 'invalid imported site asset key' USING ERRCODE='CMS04'; END IF;
 INSERT INTO public.site_assets(id,site_id,kind,object_key,mime_type,bytes,content_hash,original_name,font_key,provenance,created_at,created_by)
 VALUES((item->>'id')::uuid,p_request_id,item->>'kind',item->>'object_key',item->>'mime_type',(item->>'bytes')::bigint,item->>'content_hash',item->>'original_name',item->>'font_key',item->'provenance',(item->>'created_at')::timestamptz,actor);
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'media') LOOP
 IF COALESCE(item->>'object_key','') NOT LIKE 'site-imports/'||p_request_id::text||'/%'
  OR item->>'object_key' ~ '(\.\.|[[:space:]\\])' THEN RAISE EXCEPTION 'invalid imported media key' USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'uploaded_by',actor,'revision',1,'status','ready','deleted_at',NULL);
 INSERT INTO public.media("id","width","height","bytes","mime_type","content_hash","original_name","alt_text","decorative","focal","status","deleted_at","folder","attribution","source","tags","created_at","site_id","object_key","uploaded_by","revision")
 SELECT r."id",r."width",r."height",r."bytes",r."mime_type",r."content_hash",r."original_name",r."alt_text",r."decorative",r."focal",r."status",r."deleted_at",r."folder",r."attribution",r."source",r."tags",r."created_at",r."site_id",r."object_key",r."uploaded_by",r."revision" FROM jsonb_populate_record(NULL::public.media,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'media_variants') LOOP
 IF COALESCE(item->>'object_key','') NOT LIKE 'site-imports/'||p_request_id::text||'/%'
  OR item->>'object_key' ~ '(\.\.|[[:space:]\\])' THEN RAISE EXCEPTION 'invalid imported media key' USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id);
 INSERT INTO public.media_variants("id","media_id","width","height","bytes","mime_type","content_hash","kind","object_key")
 SELECT r."id",r."media_id",r."width",r."height",r."bytes",r."mime_type",r."content_hash",r."kind",r."object_key" FROM jsonb_populate_record(NULL::public.media_variants,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'section_defs') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'created_by',actor,'scope','site');
 INSERT INTO public.section_defs("id","slug","name","category","status","scope","site_id","created_by")
 SELECT r."id",r."slug",r."name",r."category",r."status",r."scope",r."site_id",r."created_by" FROM jsonb_populate_record(NULL::public.section_defs,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'section_def_versions') LOOP
 SELECT slug INTO defect FROM public.section_defs WHERE id=(item->>'section_def_id')::uuid AND site_id=p_request_id;
 IF defect IS NULL THEN RAISE EXCEPTION 'imported section version is foreign' USING ERRCODE='CMS04'; END IF;
 defect:=COALESCE(app.structured_section_defect(item->>'definition_kind',item->'structured_doc',(item->>'structured_schema_version')::int),
 app.render_ast_defect(item->'compiled_ast',(item->>'sanitizer_policy_version')::int),
 app.compiled_css_defect(item->>'compiled_css',(item->>'css_policy_version')::int,'.cms-section--'||defect));
 IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid imported section: %',defect USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'created_by',actor);
 INSERT INTO public.section_def_versions("id","section_def_id","version","source_html","source_css","slots","definition_kind","structured_doc","structured_schema_version","changelog","created_at","created_by","compiled_css","compiled_ast","render_hash","sanitizer_policy_version","css_policy_version","carries_trusted_code")
 SELECT r."id",r."section_def_id",r."version",r."source_html",r."source_css",r."slots",r."definition_kind",r."structured_doc",r."structured_schema_version",r."changelog",r."created_at",r."created_by",r."compiled_css",r."compiled_ast",r."render_hash",r."sanitizer_policy_version",r."css_policy_version",r."carries_trusted_code" FROM jsonb_populate_record(NULL::public.section_def_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'pages') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL,'status',CASE WHEN item->>'status'='archived' THEN 'archived' ELSE 'draft' END);
 INSERT INTO public.pages("id","revision","draft_version_id","published_version_id","slug","title","layout_mode","status","editor_label","sort_index","archived_at","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."slug",r."title",r."layout_mode",r."status",r."editor_label",r."sort_index",r."archived_at",r."site_id" FROM jsonb_populate_record(NULL::public.pages,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'themes') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL);
 INSERT INTO public.themes("id","revision","draft_version_id","published_version_id","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."site_id" FROM jsonb_populate_record(NULL::public.themes,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'navigations') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL);
 INSERT INTO public.navigations("id","revision","draft_version_id","published_version_id","mode","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."mode",r."site_id" FROM jsonb_populate_record(NULL::public.navigations,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'global_elements') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL,'use_on_live',false);
 INSERT INTO public.global_elements("id","revision","draft_version_id","published_version_id","kind","use_on_live","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."kind",r."use_on_live",r."site_id" FROM jsonb_populate_record(NULL::public.global_elements,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'collections') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_schema_version_id',NULL,'published_schema_version_id',NULL,'published_entry_revision',0);
 INSERT INTO public.collections("id","revision","slug","name","reader_key","source","draft_schema_version_id","published_schema_version_id","entry_revision","published_entry_revision","site_id")
 SELECT r."id",r."revision",r."slug",r."name",r."reader_key",r."source",r."draft_schema_version_id",r."published_schema_version_id",r."entry_revision",r."published_entry_revision",r."site_id" FROM jsonb_populate_record(NULL::public.collections,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'collection_entries') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL,'published_sort_index',NULL,'published_archived_at',NULL);
 INSERT INTO public.collection_entries("id","revision","draft_version_id","published_version_id","collection_id","stable_key","sort_index","published_sort_index","archived_at","published_archived_at","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."collection_id",r."stable_key",r."sort_index",r."published_sort_index",r."archived_at",r."published_archived_at",r."site_id" FROM jsonb_populate_record(NULL::public.collection_entries,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'page_versions') LOOP
 defect:=app.page_meta_defect(item->'meta');
 IF jsonb_typeof(item->'content') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'imported page content must be a list' USING ERRCODE='CMS04'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(item->'content') section WHERE NOT EXISTS(
 SELECT 1 FROM public.section_defs d JOIN public.section_def_versions v ON v.section_def_id=d.id
 WHERE d.site_id=p_request_id AND d.id=(section->>'section_def_id')::uuid AND v.version=(section->>'section_def_version')::int)) THEN
 RAISE EXCEPTION 'imported page names a foreign section' USING ERRCODE='CMS04'; END IF;
 IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid imported content: %',defect USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor,'carries_trusted_code',app.content_carries_trusted_code(item->'content'));
 INSERT INTO public.page_versions("id","revision","created_at","page_id","content","meta","kind","note","page_title","page_slug","site_id","author_id","carries_trusted_code")
 SELECT r."id",r."revision",r."created_at",r."page_id",r."content",r."meta",r."kind",r."note",r."page_title",r."page_slug",r."site_id",r."author_id",r."carries_trusted_code" FROM jsonb_populate_record(NULL::public.page_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'theme_versions') LOOP
 -- Historical themes may omit the defaults that the editor adds in memory.
 -- Validate their merged shape but retain the original immutable JSON bytes.
 defect:=app.theme_tokens_defect(
 '{"radius":"0.5rem","spacing":"comfortable","buttons":{"style":"solid","color":"primary","radius":"0.25rem","weight":"bold","hover":"darken","speed":"normal"}}'::jsonb
 || (item->'tokens') || jsonb_build_object('colors',
 '{"accent":"#d22630","surfaceAlt":"#f4f6f8","muted":"#5f6b7a","primaryContrast":"#ffffff","accentContrast":"#ffffff"}'::jsonb || (item->'tokens'->'colors')));
 IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid imported content: %',defect USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.theme_versions("id","revision","created_at","theme_id","tokens","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."theme_id",r."tokens",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.theme_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'navigation_versions') LOOP
 defect:=app.navigation_tree_defect(item->'tree');
 IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid imported content: %',defect USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.navigation_versions("id","revision","created_at","navigation_id","tree","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."navigation_id",r."tree",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.navigation_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'global_element_versions') LOOP
 SELECT kind::text INTO header_kind FROM public.global_elements WHERE id=(item->>'global_element_id')::uuid AND site_id=p_request_id;
 defect:=CASE WHEN header_kind='header' THEN app.global_header_defect(item->'content') ELSE app.global_footer_defect(item->'content') END;
 IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid imported content: %',defect USING ERRCODE='CMS04'; END IF;
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.global_element_versions("id","revision","created_at","global_element_id","content","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."global_element_id",r."content",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.global_element_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'collection_schema_versions') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.collection_schema_versions("id","revision","created_at","collection_id","fields","sort","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."collection_id",r."fields",r."sort",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.collection_schema_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'collection_entry_versions') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.collection_entry_versions("id","revision","created_at","entry_id","collection_id","schema_version_id","values","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."entry_id",r."collection_id",r."schema_version_id",r."values",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.collection_entry_versions,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'site_settings') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'draft_version_id',NULL,'published_version_id',NULL);
 INSERT INTO public.site_settings("id","revision","draft_version_id","published_version_id","site_id")
 SELECT r."id",r."revision",r."draft_version_id",r."published_version_id",r."site_id" FROM jsonb_populate_record(NULL::public.site_settings,row_value) r;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'site_setting_versions') LOOP
 row_value:=item||jsonb_build_object('site_id',p_request_id,'author_id',actor);
 INSERT INTO public.site_setting_versions("id","revision","created_at","site_settings_id","settings","site_id","author_id")
 SELECT r."id",r."revision",r."created_at",r."site_settings_id",r."settings",r."site_id",r."author_id" FROM jsonb_populate_record(NULL::public.site_setting_versions,row_value) r;
 END LOOP;
 UPDATE public.pages head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'pages') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.themes head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'themes') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.navigations head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'navigations') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.global_elements head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'global_elements') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.site_settings head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'site_settings') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.collection_entries head SET draft_version_id=COALESCE((item->>'draft_version_id')::uuid,(item->>'published_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'collection_entries') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 UPDATE public.collections head SET draft_schema_version_id=COALESCE((item->>'draft_schema_version_id')::uuid,(item->>'published_schema_version_id')::uuid) FROM jsonb_array_elements(p_bundle->'collections') item WHERE head.site_id=p_request_id AND head.id=(item->>'id')::uuid;
 -- JSON references are not relational foreign keys. Enforce site ownership
 -- here as well as in the strict archive parser, including HTML media URLs.
 FOR row_value IN
 WITH RECURSIVE nodes(value,depth) AS (
 SELECT p_bundle,0 UNION ALL
 SELECT child.value,n.depth+1 FROM nodes n CROSS JOIN LATERAL (
 SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.value)='array' THEN n.value ELSE '[]'::jsonb END)
 UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(n.value)='object' THEN n.value ELSE '{}'::jsonb END)
 ) child WHERE n.depth<80
 ) SELECT value FROM nodes LOOP
 IF jsonb_typeof(row_value)='object' THEN
 FOREACH table_name IN ARRAY ARRAY['media_id','logoMediaId','compactLogoMediaId','social_image'] LOOP
 IF jsonb_typeof(row_value->table_name)='string' AND row_value->>table_name ~* '^[0-9a-f-]{36}$'
 AND NOT EXISTS(SELECT 1 FROM public.media WHERE id=(row_value->>table_name)::uuid AND site_id=p_request_id) THEN
 RAISE EXCEPTION 'imported content references foreign media' USING ERRCODE='CMS04'; END IF;
 END LOOP;
 IF row_value->>'type'='page' AND NOT EXISTS(SELECT 1 FROM public.pages WHERE site_id=p_request_id AND id=(row_value->>'page_id')::uuid) THEN
 RAISE EXCEPTION 'imported navigation references a foreign page' USING ERRCODE='CMS04'; END IF;
 IF row_value ? 'readerKey' AND row_value ? 'selection' AND NOT EXISTS(SELECT 1 FROM public.collections WHERE site_id=p_request_id AND reader_key=row_value->>'readerKey') THEN
 RAISE EXCEPTION 'imported content references a missing collection' USING ERRCODE='CMS04'; END IF;
 ELSIF jsonb_typeof(row_value)='string' THEN
 FOR reference IN SELECT regexp_matches(row_value #>> '{}','/media/([0-9a-f-]{36})/(original|thumbnail|card|wide)','gi') LOOP
 IF NOT EXISTS(SELECT 1 FROM public.media WHERE site_id=p_request_id AND id=reference[1]::uuid)
 OR (reference[2]<>'original' AND NOT EXISTS(SELECT 1 FROM public.media_variants WHERE media_id=reference[1]::uuid AND kind=reference[2])) THEN
 RAISE EXCEPTION 'imported content references a foreign or missing media variant' USING ERRCODE='CMS04'; END IF;
 END LOOP;
 END IF;
 END LOOP;
 -- The export retains historical content; import intentionally creates no
 -- public projections, domain bindings, schedules or inherited approvals.
 UPDATE public.media m SET status=(item->>'status')::media_status,deleted_at=(item->>'deleted_at')::timestamptz FROM jsonb_array_elements(p_bundle->'media') item WHERE m.site_id=p_request_id AND m.id=(item->>'id')::uuid;
 UPDATE public.site_settings SET published_version_id=NULL WHERE site_id=p_request_id;
 DELETE FROM public.published_site_shells WHERE site_id=p_request_id;
 PERFORM app.index_collection_entry_media(v.id,v.site_id,v.entry_id,s.fields,v."values")
 FROM public.collection_entry_versions v JOIN public.collection_schema_versions s ON s.id=v.schema_version_id WHERE v.site_id=p_request_id;
 INSERT INTO app.site_content_imports(request_id,site_id,actor_id,fingerprint,source_heads)
 VALUES(p_request_id,p_request_id,actor,fingerprint,p_source_heads);
 PERFORM app.write_audit(p_request_id,'user',actor,'site.import','site',p_request_id,NULL,NULL,
 jsonb_build_object('format_version',1,'request_id',p_request_id,'fingerprint',fingerprint,
 'pages',jsonb_array_length(p_bundle->'pages'),'media',jsonb_array_length(p_bundle->'media'),'publication','draft-only'));
 -- The site and its thumbnail work commit together. A repeated import returns
 -- above and cannot enqueue duplicate pictures for existing imported versions.
 PERFORM app.emit_outbox(p_request_id,'section_def.thumbnail_requested',
 jsonb_build_object('section_def_id',d.id,'version',v.version,'slug',d.slug))
 FROM public.section_defs d JOIN public.section_def_versions v ON v.section_def_id=d.id
 WHERE d.site_id=p_request_id AND d.status='active';
 RETURN p_request_id;
END $$;

ALTER TABLE public.site_assets OWNER TO cms_migration_owner;
ALTER TABLE public.site_asset_usage OWNER TO cms_migration_owner;
DO $$ DECLARE obj RECORD; BEGIN
 FOR obj IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='app' AND p.proname IN ('registered_font_matches','import_site_asset','site_asset_references','index_new_page_site_assets','resolve_site_asset','build_render_manifest_internal','export_site_content','import_site_content'))
 OR (n.nspname='public_api' AND p.proname='resolve_site_asset') LOOP
 EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',obj.sig);
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',obj.sig);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION app.export_site_content_before_assets(uuid),app.build_render_manifest_before_site_assets(uuid) FROM cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.import_site_asset(uuid,uuid,text,text,text,bigint,text,text,text,jsonb),app.resolve_site_asset(uuid),app.export_site_content(uuid),app.import_site_content(uuid,jsonb,jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION public_api.resolve_site_asset(text,uuid) TO cms_public_renderer;
