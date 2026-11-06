-- Publication always rejects generic sample pictures on chapter-enabled sites.
-- Described imported photos, including explicitly marked borrowed photos, remain usable.
CREATE FUNCTION app.guard_echelon_published_photos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE content jsonb;
BEGIN
 IF NEW.published_version_id IS NULL OR NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id
 OR NOT EXISTS(SELECT 1 FROM public.sites WHERE id=NEW.site_id AND chapters_enabled) THEN RETURN NEW;END IF;
 SELECT v.content INTO content FROM public.page_versions v WHERE v.id=NEW.published_version_id AND v.page_id=NEW.id AND v.site_id=NEW.site_id;
 IF EXISTS(WITH RECURSIVE nodes(value) AS(SELECT content UNION ALL SELECT child.value FROM nodes CROSS JOIN LATERAL(SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END) UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)) child) SELECT 1 FROM nodes WHERE jsonb_typeof(value)='object' AND value->>'src' LIKE '/cms-samples/%') THEN
  RAISE EXCEPTION 'Choose Echelon photos from Media before publishing. Generic sample pictures cannot be published.' USING ERRCODE='CMS04';
 END IF;
 RETURN NEW;
END$$;
REVOKE ALL ON FUNCTION app.guard_echelon_published_photos() FROM PUBLIC;
ALTER FUNCTION app.guard_echelon_published_photos() OWNER TO cms_migration_owner;
CREATE TRIGGER guard_echelon_published_photos BEFORE UPDATE OF published_version_id ON public.pages FOR EACH ROW EXECUTE FUNCTION app.guard_echelon_published_photos();
