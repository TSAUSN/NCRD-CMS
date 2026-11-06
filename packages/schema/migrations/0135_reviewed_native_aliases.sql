-- Native identities inside immutable reviewed files survive content transfers.
-- Mappings carry UUIDs and closed image variants, never paths or storage keys.
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) RENAME TO site_file_bundle_defect_before_native;
CREATE FUNCTION app.site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;item jsonb;size jsonb;source uuid;target uuid;
BEGIN
 defect:=app.site_file_bundle_defect_before_native(p_site,p_bundle-'native');IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF NOT(p_bundle ? 'native')THEN RETURN NULL;END IF;
 IF NOT app.json_within(p_bundle,262144) OR jsonb_typeof(p_bundle->'native') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'native')>2000 THEN RETURN 'The original image and document choices are incomplete or too large.';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'native') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['kind','sourceId'])
   OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'sourceId') IS DISTINCT FROM 'string'
   OR item->>'sourceId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN 'Choose a complete original resource identity.';END IF;
  source:=(item->>'sourceId')::uuid;
  IF (SELECT count(*) FROM jsonb_array_elements(p_bundle->'native') entry WHERE entry.value->>'kind'=item->>'kind' AND lower(entry.value->>'sourceId')=source::text)>1 THEN RETURN 'Choose each original resource only once.';END IF;
  IF item->>'kind'='media' THEN
   IF item-ARRAY['kind','sourceId','mediaId','variants']<>'{}'::jsonb OR NOT(item ?& ARRAY['mediaId','variants'])
    OR jsonb_typeof(item->'mediaId') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'variants') IS DISTINCT FROM 'array'
    OR jsonb_array_length(item->'variants') NOT BETWEEN 1 AND 4 THEN RETURN 'Choose the image and its available sizes.';END IF;
   target:=(item->>'mediaId')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.media WHERE id=target AND site_id=p_site) THEN RETURN 'An original image must belong to this site.';END IF;
   IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(item->'variants')) THEN RETURN 'Choose each image size only once.';END IF;
   FOR size IN SELECT value FROM jsonb_array_elements(item->'variants') LOOP
    IF jsonb_typeof(size) IS DISTINCT FROM 'string' OR size#>>'{}' NOT IN ('original','thumbnail','card','wide')
     OR (size#>>'{}'<>'original' AND NOT EXISTS(SELECT 1 FROM public.media_variants WHERE media_id=target AND kind::text=size#>>'{}')) THEN RETURN 'An original image size is unavailable.';END IF;
   END LOOP;
  ELSIF item->>'kind'='asset' THEN
   IF item-ARRAY['kind','sourceId','assetId']<>'{}'::jsonb OR NOT(item ? 'assetId') OR jsonb_typeof(item->'assetId') IS DISTINCT FROM 'string' THEN RETURN 'Choose a complete document or font.';END IF;
   target:=(item->>'assetId')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.site_assets WHERE id=target AND site_id=p_site) THEN RETURN 'An original document or font must belong to this site.';END IF;
  ELSE RETURN 'Choose an image, document or font.';END IF;
 END LOOP;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN 'An original resource identity is invalid.';
END $$;

CREATE FUNCTION app.published_site_native_aliases(p_host text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT alias.value FROM public_api.resolve_host(p_host) host
 JOIN public.site_file_heads h ON h.site_id=host.site_id
 JOIN public.site_file_versions v ON v.site_id=h.site_id AND v.id=h.published_version_id
 JOIN public.sites s ON s.id=h.site_id
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.bundle->'native','[]')) alias
 WHERE NOT s.initial_release_required AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=s.id)
$$;
CREATE FUNCTION app.native_alias_target(p_alias jsonb,p_path text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_alias->>'kind'='asset' THEN jsonb_build_object('kind','asset','assetId',p_alias->>'assetId')
  ELSE jsonb_build_object('kind','media','mediaId',p_alias->>'mediaId','variant',split_part(p_path,'/',4)) END
 WHERE (p_alias->>'kind'='asset' AND lower(p_path)='/assets/'||lower(p_alias->>'sourceId'))
 OR (p_alias->>'kind'='media' AND lower(p_path)='/media/'||lower(p_alias->>'sourceId')||'/'||split_part(p_path,'/',4)
  AND p_alias->'variants' @> jsonb_build_array(split_part(p_path,'/',4)))
$$;
CREATE FUNCTION public_api.resolve_site_native_path(p_host text,p_path text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT target.value FROM app.published_site_native_aliases(p_host) alias
 CROSS JOIN LATERAL (SELECT app.native_alias_target(alias,p_path) AS value) target
 WHERE target.value IS NOT NULL LIMIT 1
$$;
CREATE FUNCTION public_api.resolve_canvas_native_path(p_host text,p_tokens text[],p_path text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT target.value FROM app.canvas_tickets_for_host(p_host,p_tokens) t
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.snapshot#>'{shell,site_files,bundle,native}','[]')) alias
 CROSS JOIN LATERAL (SELECT app.native_alias_target(alias.value,p_path) AS value) target
 WHERE target.value IS NOT NULL ORDER BY t.created_at DESC,t.id LIMIT 1
$$;

ALTER FUNCTION app.canvas_snapshot_asset_references(jsonb) RENAME TO canvas_snapshot_asset_references_before_native;
CREATE FUNCTION app.canvas_snapshot_asset_references(p_snapshot jsonb)
RETURNS TABLE(kind text,id uuid,variant text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized jsonb:=p_snapshot;alias jsonb;size jsonb;
BEGIN
 IF jsonb_typeof(p_snapshot#>'{shell,site_files,bundle}')='object' THEN
  normalized:=jsonb_set(p_snapshot,'{shell,site_files,bundle}',(p_snapshot#>'{shell,site_files,bundle}')-'native');END IF;
 RETURN QUERY SELECT * FROM app.canvas_snapshot_asset_references_before_native(normalized);
 FOR alias IN SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot#>'{shell,site_files,bundle,native}','[]')) LOOP
  IF alias->>'kind'='asset' THEN kind:='asset';id:=(alias->>'assetId')::uuid;variant:=NULL;RETURN NEXT;
  ELSIF alias->>'kind'='media' THEN
   FOR size IN SELECT value FROM jsonb_array_elements(alias->'variants') LOOP kind:='media';id:=(alias->>'mediaId')::uuid;variant:=size#>>'{}';RETURN NEXT;END LOOP;
  END IF;
 END LOOP;
END $$;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.published_site_native_aliases(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.native_alias_target(jsonb,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.canvas_snapshot_asset_references(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_site_native_path(text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_canvas_native_path(text,text[],text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_file_bundle_defect_before_native(uuid,jsonb),app.site_file_bundle_defect(uuid,jsonb),app.published_site_native_aliases(text),app.native_alias_target(jsonb,text),app.canvas_snapshot_asset_references_before_native(jsonb),app.canvas_snapshot_asset_references(jsonb),public_api.resolve_site_native_path(text,text),public_api.resolve_canvas_native_path(text,text[],text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION public_api.resolve_site_native_path(text,text),public_api.resolve_canvas_native_path(text,text[],text) TO cms_public_renderer;
