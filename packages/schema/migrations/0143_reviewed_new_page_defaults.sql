-- A Super Admin may review a bounded frame and existing file bindings for
-- future template pages. Explicit imported-page choices always retain priority.
-- No new files, hashes, origins, grants or editor script authority are added.
DO $$ BEGIN
 IF to_regprocedure('app.original_layout_defect_before_new_pages(uuid,jsonb,boolean)') IS NULL THEN
  ALTER FUNCTION app.original_layout_defect(uuid,jsonb,boolean) RENAME TO original_layout_defect_before_new_pages;
 END IF;
 IF to_regprocedure('app.site_file_bundle_defect_before_new_pages(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) RENAME TO site_file_bundle_defect_before_new_pages;
 END IF;
 IF to_regprocedure('app.archived_site_file_bundle_defect_before_new_pages(uuid,jsonb)') IS NULL THEN
  ALTER FUNCTION app.archived_site_file_bundle_defect(uuid,jsonb) RENAME TO archived_site_file_bundle_defect_before_new_pages;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION app.original_layout_defect(p_site uuid,layout jsonb,p_archived boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defaults jsonb;
BEGIN
 IF layout ? 'newPages' THEN
  defaults:=layout->'newPages';
  IF jsonb_typeof(defaults) IS DISTINCT FROM 'object'
   OR defaults-ARRAY['html','body','header','footer','quirks']<>'{}'::jsonb
   OR NOT(defaults ?& ARRAY['html','body','header','footer'])
   OR jsonb_typeof(defaults->'header') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(defaults->'footer') IS DISTINCT FROM 'boolean'
   OR (defaults ? 'quirks' AND jsonb_typeof(defaults->'quirks') IS DISTINCT FROM 'boolean')
   OR NOT app.original_document_attributes_valid(defaults->'html')
   OR NOT app.original_document_attributes_valid(defaults->'body')
   THEN RETURN 'Review complete original layout choices for new pages.';END IF;
 END IF;
 RETURN app.original_layout_defect_before_new_pages(p_site,layout-'newPages',p_archived);
END $$;

CREATE OR REPLACE FUNCTION app.new_page_file_choices_defect(bundle jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE key text;item jsonb;
BEGIN
 FOREACH key IN ARRAY ARRAY['scripts','styles'] LOOP
  IF jsonb_typeof(bundle->key)='array' THEN
   IF jsonb_array_length(bundle->key)>64 THEN RETURN 'The reviewed file loading list is too large.';END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(bundle->key) LOOP
    IF item ? 'newPages' THEN
     IF jsonb_typeof(item->'newPages') IS DISTINCT FROM 'boolean' THEN RETURN 'Choose whether this file runs on new pages.';END IF;
     IF item->'newPages'='true'::jsonb AND bundle#>'{original,newPages}' IS NULL
      THEN RETURN 'Review the original layout for new pages before choosing their files.';END IF;
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.without_new_page_file_choices(bundle jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE normalized jsonb:=bundle;key text;items jsonb;
BEGIN
 FOREACH key IN ARRAY ARRAY['scripts','styles'] LOOP
  IF jsonb_typeof(bundle->key)='array' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->key) item WHERE jsonb_typeof(item) IS DISTINCT FROM 'object') THEN
   SELECT COALESCE(jsonb_agg(item-'newPages' ORDER BY ordinal),'[]'::jsonb) INTO items
    FROM jsonb_array_elements(bundle->key) WITH ORDINALITY source(item,ordinal);
   normalized:=jsonb_set(normalized,ARRAY[key],items);
  END IF;
 END LOOP;
 RETURN normalized;
END $$;

CREATE OR REPLACE FUNCTION app.site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;
BEGIN
 defect:=app.new_page_file_choices_defect(p_bundle);IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF p_bundle#>'{original,newPages}' IS NOT NULL AND NOT app.json_within(p_bundle,262144)
  THEN RETURN 'The reviewed original layouts are too large.';END IF;
 RETURN app.site_file_bundle_defect_before_new_pages(p_site,app.without_new_page_file_choices(p_bundle));
END $$;

CREATE OR REPLACE FUNCTION app.archived_site_file_bundle_defect(p_site uuid,p_bundle jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE defect text;
BEGIN
 defect:=app.new_page_file_choices_defect(p_bundle);IF defect IS NOT NULL THEN RETURN defect;END IF;
 IF p_bundle#>'{original,newPages}' IS NOT NULL AND NOT app.json_within(p_bundle,262144)
  THEN RETURN 'The reviewed original layouts are too large.';END IF;
 RETURN app.archived_site_file_bundle_defect_before_new_pages(p_site,app.without_new_page_file_choices(p_bundle));
END $$;

ALTER FUNCTION app.original_layout_defect(uuid,jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.new_page_file_choices_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.without_new_page_file_choices(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.archived_site_file_bundle_defect(uuid,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.original_layout_defect_before_new_pages(uuid,jsonb,boolean),app.original_layout_defect(uuid,jsonb,boolean),app.new_page_file_choices_defect(jsonb),app.without_new_page_file_choices(jsonb),app.site_file_bundle_defect_before_new_pages(uuid,jsonb),app.site_file_bundle_defect(uuid,jsonb),app.archived_site_file_bundle_defect_before_new_pages(uuid,jsonb),app.archived_site_file_bundle_defect(uuid,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
