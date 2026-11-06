-- A reviewed old document without a doctype needs the same browser layout.
-- This boolean changes framing only. All ownership, pins, attributes, source
-- sanitizing and Super Admin review requirements remain in the existing check.
DO $$ BEGIN
 IF to_regprocedure('app.original_layout_defect_before_browser_mode(uuid,jsonb,boolean)') IS NULL THEN
  ALTER FUNCTION app.original_layout_defect(uuid,jsonb,boolean) RENAME TO original_layout_defect_before_browser_mode;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.original_layout_defect(p_site uuid,layout jsonb,p_archived boolean) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE normalized jsonb:=layout;pages jsonb;
BEGIN
 IF jsonb_typeof(layout->'pages')='array' THEN
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(layout->'pages') page WHERE jsonb_typeof(page)<>'object')
   THEN RETURN app.original_layout_defect_before_browser_mode(p_site,layout,p_archived);END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(layout->'pages') page
    WHERE page ? 'quirks' AND jsonb_typeof(page->'quirks') IS DISTINCT FROM 'boolean')
   THEN RETURN 'Choose the saved original browser layout.';END IF;
  SELECT COALESCE(jsonb_agg(page-'quirks' ORDER BY ord),'[]'::jsonb) INTO pages
   FROM jsonb_array_elements(layout->'pages') WITH ORDINALITY item(page,ord);
  normalized:=jsonb_set(layout,'{pages}',pages);
 END IF;
 RETURN app.original_layout_defect_before_browser_mode(p_site,normalized,p_archived);
END $$;
ALTER FUNCTION app.original_layout_defect(uuid,jsonb,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.original_layout_defect_before_browser_mode(uuid,jsonb,boolean),app.original_layout_defect(uuid,jsonb,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
