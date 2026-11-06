-- Fixed approved Adobe kit; other themes retain the prior closed font contract.
DO $$ DECLARE source text; BEGIN
 source:=pg_get_functiondef('app.theme_tokens_defect(jsonb)'::regprocedure);
 source:=replace(source,'allowed_fonts constant text[] := ARRAY[',$fonts$allowed_fonts constant text[] := ARRAY[
          '''trajan-pro-3'', ''Source Serif 4'', Georgia, serif',
          '''proxima-nova'', ''Open Sans'', Arial, sans-serif',
          '''proxima-nova-condensed'', ''Open Sans'', Arial, sans-serif',
          '''proxima-nova-extra-condensed'', ''Open Sans'', Arial, sans-serif',
$fonts$);
 source:=replace(source,'fonts - ARRAY[''heading'',''body'']','fonts - ARRAY[''heading'',''body'',''adobeKit'']');
 source:=replace(source,'  IF jsonb_typeof(fonts->''heading'')',$kit$
  IF fonts ? 'adobeKit' AND (
    jsonb_typeof(fonts->'adobeKit') IS DISTINCT FROM 'object'
    OR ((fonts->'adobeKit') - ARRAY['id','enabled','domains']) <> '{}'::jsonb
    OR NOT ((fonts->'adobeKit') ?& ARRAY['id','enabled','domains'])
    OR fonts#>>'{adobeKit,id}' IS DISTINCT FROM 'euh2hvn'
    OR jsonb_typeof(fonts#>'{adobeKit,enabled}') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(fonts#>'{adobeKit,domains}') IS DISTINCT FROM 'array'
  ) THEN RETURN 'Use the approved Adobe kit and a list of allowed hostnames'; END IF;
  IF fonts ? 'adobeKit' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(fonts#>'{adobeKit,domains}') item WHERE jsonb_typeof(item) IS DISTINCT FROM 'string') THEN RETURN 'Font hostnames must be text'; END IF;
    IF jsonb_array_length(fonts#>'{adobeKit,domains}')>10 THEN RETURN 'Use at most ten font hostnames'; END IF;
    FOR value IN SELECT jsonb_array_elements_text(fonts#>'{adobeKit,domains}') LOOP
      IF value IS NULL OR length(value)>253 OR value<>lower(value) OR value !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' THEN RETURN 'Use a hostname without a protocol, port or path'; END IF;
    END LOOP;
  END IF;
  IF jsonb_typeof(fonts->'heading')$kit$);
 EXECUTE source;
END $$;

CREATE FUNCTION app.guard_chapter_heading_font() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM sites WHERE id=NEW.site_id AND chapters_enabled)
    AND NEW.tokens#>>'{fonts,heading}' LIKE '%trajan-pro-3%' THEN
   RAISE EXCEPTION 'Echelon chapter sites use sans-serif headings' USING ERRCODE='CMS04';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.guard_chapter_heading_font() FROM PUBLIC;
ALTER FUNCTION app.guard_chapter_heading_font() OWNER TO cms_migration_owner;
CREATE TRIGGER guard_chapter_heading_font BEFORE INSERT ON theme_versions FOR EACH ROW EXECUTE FUNCTION app.guard_chapter_heading_font();
