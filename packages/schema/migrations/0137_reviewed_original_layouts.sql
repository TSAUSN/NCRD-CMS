-- Original document structure is an immutable Super Admin review choice.
-- Pins carry no HTML, executable bytes, field values or resource authority.
CREATE FUNCTION app.original_document_attributes_valid(p_attributes jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item record;
BEGIN
 IF jsonb_typeof(p_attributes) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_attributes))>64 THEN RETURN false;END IF;
 FOR item IN SELECT * FROM jsonb_each(p_attributes) LOOP
  IF item.key !~ '^(id|class|lang|dir|role|data-[a-z0-9]+(-[a-z0-9]+)*|aria-[a-z0-9]+(-[a-z0-9]+)*)$'
   OR item.key ~ '^data-cms(-|$)' OR jsonb_typeof(item.value) IS DISTINCT FROM 'string'
   OR length(item.value#>>'{}')>4096 OR (item.value#>>'{}') ~ '[[:cntrl:]]'
   OR (item.key='dir' AND item.value#>>'{}' NOT IN ('ltr','rtl','auto')) THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION app.original_layout_defect(p_site uuid,layout jsonb,p_archived boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;item jsonb;def record;
BEGIN
 IF jsonb_typeof(layout) IS DISTINCT FROM 'object'
  OR layout-ARRAY['version','definitions','pages']<>'{}'::jsonb OR layout->'version' IS DISTINCT FROM '1'::jsonb
  OR jsonb_typeof(layout->'definitions') IS DISTINCT FROM 'array' OR jsonb_array_length(layout->'definitions')>2000
  OR jsonb_typeof(layout->'pages') IS DISTINCT FROM 'array' OR jsonb_array_length(layout->'pages')>500 THEN RETURN 'The original page layout choices are incomplete or too large.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(layout->'definitions') pin GROUP BY pin->>'section_def_id',pin->>'section_def_version' HAVING count(*)>1)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(layout->'pages') page GROUP BY page->>'pageId' HAVING count(*)>1) THEN RETURN 'Choose each original layout and page only once.';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(layout->'definitions') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['section_def_id','section_def_version']<>'{}'::jsonb
   OR jsonb_typeof(item->'section_def_id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'section_def_version') IS DISTINCT FROM 'number'
   OR item->>'section_def_version' !~ '^[1-9][0-9]{0,9}$' THEN RETURN 'Choose a saved original layout version.';END IF;
  SELECT d.id AS definition_id,d.slug,d.scope,d.site_id,v.* INTO def FROM public.section_defs d
   JOIN public.section_def_versions v ON v.section_def_id=d.id
   WHERE d.id=(item->>'section_def_id')::uuid AND v.version=(item->>'section_def_version')::int;
  IF def.definition_id IS NULL OR def.scope<>'site' OR def.site_id<>p_site OR def.carries_trusted_code
   THEN RETURN 'An original layout must be a scriptless section owned by this site.';END IF;
  IF COALESCE(btrim(def.compiled_css),'')<>'' THEN RETURN 'Original layouts use reviewed site styles rather than a section wrapper stylesheet.';END IF;
  defect:=COALESCE(app.structured_section_defect(def.definition_kind,def.structured_doc,def.structured_schema_version),
   app.render_ast_defect(def.compiled_ast,def.sanitizer_policy_version),
   app.compiled_css_defect(def.compiled_css,def.css_policy_version,'.cms-section--'||def.slug));
  IF defect IS NOT NULL THEN RETURN 'An original layout needs revalidating: '||defect;END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(layout->'pages') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['pageId','html','body','header','footer']<>'{}'::jsonb
   OR NOT(item ?& ARRAY['pageId','html','body','header','footer']) OR jsonb_typeof(item->'pageId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'header') IS DISTINCT FROM 'boolean' OR jsonb_typeof(item->'footer') IS DISTINCT FROM 'boolean'
   OR NOT app.original_document_attributes_valid(item->'html') OR NOT app.original_document_attributes_valid(item->'body')
   THEN RETURN 'Use complete original page choices and plain document attributes.';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pages WHERE id=(item->>'pageId')::uuid AND site_id=p_site AND (p_archived OR archived_at IS NULL))
   THEN RETURN 'An original page must belong to this site.';END IF;
 END LOOP;
 RETURN NULL;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN 'A saved original layout or page is unavailable.';
END $$;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) RENAME TO site_file_bundle_defect_before_original;
CREATE FUNCTION app.site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;
BEGIN
 defect:=app.site_file_bundle_defect_before_original(p_site,p_bundle-'original');IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF NOT(p_bundle ? 'original')THEN RETURN NULL;END IF;
 IF NOT app.json_within(p_bundle,262144) THEN RETURN 'The reviewed original layouts are too large.';END IF;
 RETURN app.original_layout_defect(p_site,p_bundle->'original',false);
END $$;
ALTER FUNCTION app.archived_site_file_bundle_defect(uuid,jsonb) RENAME TO archived_site_file_bundle_defect_before_original;
CREATE FUNCTION app.archived_site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;
BEGIN
 defect:=app.archived_site_file_bundle_defect_before_original(p_site,p_bundle-'original');IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF NOT(p_bundle ? 'original')THEN RETURN NULL;END IF;
 IF NOT app.json_within(p_bundle,262144) THEN RETURN 'The reviewed original layouts are too large.';END IF;
 RETURN app.original_layout_defect(p_site,p_bundle->'original',true);
END $$;
ALTER FUNCTION app.import_site_content(uuid,jsonb,jsonb) RENAME TO import_site_content_before_original;
CREATE FUNCTION app.import_site_content(p_request_id uuid,p_bundle jsonb,p_source_heads jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can import site files.' USING ERRCODE='CMS02';END IF;
 IF p_bundle->'site_file_reviewed' IS DISTINCT FROM 'true'::jsonb AND EXISTS(
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_bundle->'site_file_versions')='array' THEN p_bundle->'site_file_versions' ELSE '[]'::jsonb END) v WHERE v#>'{bundle,original}' IS NOT NULL)
 THEN RAISE EXCEPTION 'Review the original page layouts before importing them.' USING ERRCODE='CMS04';END IF;
 RETURN app.import_site_content_before_original(p_request_id,p_bundle,p_source_heads);
END $$;
ALTER FUNCTION app.original_layout_defect(uuid,jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.archived_site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.import_site_content(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.original_layout_defect(uuid,jsonb,boolean),app.archived_site_file_bundle_defect_before_original(uuid,jsonb),app.archived_site_file_bundle_defect(uuid,jsonb),app.import_site_content_before_original(uuid,jsonb,jsonb),app.import_site_content(uuid,jsonb,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.import_site_content(uuid,jsonb,jsonb) TO cms_authenticated_user;

-- Attributes and pins introduce no media authority. Existing frozen snapshot
-- identity, references and exact native resource checks continue unchanged.
ALTER FUNCTION app.canvas_snapshot_asset_references(jsonb) RENAME TO canvas_snapshot_asset_references_before_original;
CREATE FUNCTION app.canvas_snapshot_asset_references(p_snapshot jsonb)
RETURNS TABLE(kind text,id uuid,variant text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized jsonb:=p_snapshot;
BEGIN
 IF jsonb_typeof(p_snapshot#>'{shell,site_files,bundle}')='object' THEN
  normalized:=jsonb_set(p_snapshot,'{shell,site_files,bundle}',(p_snapshot#>'{shell,site_files,bundle}')-'original');END IF;
 RETURN QUERY SELECT * FROM app.canvas_snapshot_asset_references_before_original(normalized);
END $$;
ALTER FUNCTION app.original_document_attributes_valid(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.canvas_snapshot_asset_references(jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.original_document_attributes_valid(jsonb),app.site_file_bundle_defect_before_original(uuid,jsonb),app.site_file_bundle_defect(uuid,jsonb),app.canvas_snapshot_asset_references_before_original(jsonb),app.canvas_snapshot_asset_references(jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
