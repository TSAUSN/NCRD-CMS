-- Original resource paths travel with the reviewed immutable file version.
-- Exact mappings only; no page dispatch, arbitrary storage key or URL proxy.
CREATE FUNCTION app.site_file_path_allowed(p_path text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE decoded bytea:=''::bytea;at integer:=1;letter text;
BEGIN
 IF p_path IS NULL OR length(p_path)>2048 OR p_path !~ '^/([A-Za-z0-9_.~!$&()*+,;=:@/-]|%[0-9A-Fa-f]{2})+$'
  OR p_path LIKE '%//%' OR p_path ~ '/\.{1,2}(/|$)' OR p_path ~* '%(0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)'
  OR p_path !~* '\.(js|css|json|jpe?g|png|gif|webp|svg|ico|woff2?|ttf|otf|eot)$'
  OR p_path ~* '^/(__cms|_next|api|internal|health|robots\.txt|sitemap\.xml)(/|$)' THEN RETURN false;END IF;
 WHILE at<=length(p_path) LOOP
  letter:=substring(p_path FROM at FOR 1);
  IF letter='%' THEN decoded:=decoded||decode(substring(p_path FROM at+1 FOR 2),'hex');at:=at+3;
  ELSE decoded:=decoded||convert_to(letter,'UTF8');at:=at+1;END IF;
 END LOOP;
 PERFORM convert_from(decoded,'UTF8');
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) RENAME TO site_file_bundle_defect_before_paths;
CREATE FUNCTION app.site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;item jsonb;file public.site_files;canonical text[];
BEGIN
 defect:=app.site_file_bundle_defect_before_paths(p_site,p_bundle-'paths');
 IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF NOT(p_bundle ? 'paths')THEN RETURN NULL;END IF;
 IF jsonb_typeof(p_bundle->'paths') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'paths')>2000 THEN RETURN 'The file addresses are incomplete or too large.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_bundle->'paths') entry GROUP BY entry.value->>'path' HAVING count(*)>1)THEN RETURN 'Choose each file address only once.';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_bundle->'paths') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['path','fileId']) OR item-ARRAY['path','fileId']<>'{}'::jsonb
   OR jsonb_typeof(item->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'fileId') IS DISTINCT FROM 'string'
   OR NOT app.site_file_path_allowed(item->>'path') THEN RETURN 'Use an exact local file address.';END IF;
  SELECT * INTO file FROM public.site_files WHERE site_id=p_site AND id=(item->>'fileId')::uuid;
  IF file.id IS NULL OR NOT(p_bundle->'files' @> jsonb_build_array(file.id::text)) THEN RETURN 'Every file address must name a file in this reviewed version.';END IF;
  IF (file.kind='script' AND item->>'path' !~* '\.js$') OR(file.kind='stylesheet' AND item->>'path' !~* '\.css$')
   OR(file.kind='data' AND item->>'path' !~* '\.json$') OR(file.kind='image' AND item->>'path' !~* '\.(png|jpe?g|gif|webp|svg|ico)$')
   OR(file.kind='font' AND item->>'path' !~* '\.(woff2?|ttf|otf|eot)$') THEN RETURN 'The file address must match its file type.';END IF;
  canonical:=regexp_match(item->>'path','^/site-files/([0-9a-f-]{36})/([0-9a-f]{64})/([A-Za-z0-9._-]+)$');
  IF left(item->>'path',12)='/site-files/' AND (canonical IS NULL OR canonical[2]<>file.sha256 OR canonical[3]<>file.name) THEN RETURN 'An immutable file address must keep its exact checksum and name.';END IF;
 END LOOP;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation THEN RETURN 'A file address names an unavailable file.';
END $$;
CREATE FUNCTION public_api.resolve_site_file_path(p_host text,p_path text)
RETURNS TABLE(id uuid,site_id uuid,kind text,name text,source text,object_key text,mime_type text,bytes bigint,sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.id,f.site_id,f.kind,f.name,f.source,f.object_key,f.mime_type,f.bytes,f.sha256
 FROM public_api.resolve_host(p_host) host JOIN public.site_file_heads h ON h.site_id=host.site_id
 JOIN public.site_file_versions v ON v.site_id=h.site_id AND v.id=h.published_version_id
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.bundle->'paths','[]')) mount
 JOIN public.site_files f ON f.site_id=h.site_id AND f.id::text=mount->>'fileId'
 JOIN public.sites s ON s.id=h.site_id
 WHERE mount->>'path'=p_path AND app.site_file_path_allowed(p_path) AND v.bundle->'files' @> to_jsonb(ARRAY[f.id::text])
 AND NOT s.initial_release_required AND EXISTS(SELECT 1 FROM public.published_routes r WHERE r.site_id=s.id)
$$;
CREATE FUNCTION public_api.resolve_canvas_file_path(p_host text,p_tokens text[],p_path text)
RETURNS TABLE(id uuid,site_id uuid,kind text,name text,source text,object_key text,mime_type text,bytes bigint,sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.id,f.site_id,f.kind,f.name,f.source,f.object_key,f.mime_type,f.bytes,f.sha256
 FROM app.canvas_tickets_for_host(p_host,p_tokens) t
 CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.snapshot#>'{shell,site_files,bundle,paths}','[]')) mount
 JOIN public.site_files f ON f.site_id=t.site_id AND f.id::text=mount->>'fileId'
 WHERE mount->>'path'=p_path AND app.site_file_path_allowed(p_path)
 AND t.snapshot#>'{shell,site_files,bundle,files}' @> to_jsonb(ARRAY[f.id::text])
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.snapshot#>'{shell,site_files,files}') item WHERE item->>'id'=f.id::text AND item->>'sha256'=f.sha256)
 ORDER BY t.created_at DESC,t.id LIMIT 1
$$;
ALTER FUNCTION app.site_file_path_allowed(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_site_file_path(text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_canvas_file_path(text,text[],text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_file_path_allowed(text),app.site_file_bundle_defect_before_paths(uuid,jsonb),app.site_file_bundle_defect(uuid,jsonb),public_api.resolve_site_file_path(text,text),public_api.resolve_canvas_file_path(text,text[],text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION public_api.resolve_site_file_path(text,text),public_api.resolve_canvas_file_path(text,text[],text) TO cms_public_renderer;
