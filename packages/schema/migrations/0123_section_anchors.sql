-- Private section metadata cannot introduce duplicate or reserved document ids.
CREATE OR REPLACE FUNCTION app.validate_page_section_anchors() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; anchor text; seen text[] := '{}';
BEGIN
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF NOT (section->'values') ? '__cms_anchor' THEN CONTINUE; END IF;
    anchor := section#>>'{values,__cms_anchor}';
    IF jsonb_typeof(section#>'{values,__cms_anchor}') IS DISTINCT FROM 'string' OR anchor !~ '^[a-z][a-z0-9-]{0,63}$' OR anchor ~ '^s[0-9]+$' OR anchor LIKE 'cms-%' THEN
      RAISE EXCEPTION 'Use an anchor beginning with a letter, with lowercase letters, numbers and hyphens. The cms- prefix and numbered section addresses are reserved.' USING ERRCODE='CMS04';
    END IF;
    IF anchor = ANY(seen) THEN RAISE EXCEPTION 'Another section already uses that anchor.' USING ERRCODE='CMS04'; END IF;
    seen := array_append(seen,anchor);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.validate_page_section_anchors() FROM PUBLIC;
ALTER FUNCTION app.validate_page_section_anchors() OWNER TO cms_migration_owner;
DROP TRIGGER IF EXISTS page_section_anchors ON public.page_versions;
CREATE TRIGGER page_section_anchors BEFORE INSERT OR UPDATE OF content ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.validate_page_section_anchors();
