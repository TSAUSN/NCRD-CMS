-- Source authoring belongs to super admins. Ordinary content edits may retain
-- a source tuple that already exists in this same page's immutable history.
-- Include both definition id and version: moving old code onto another layout
-- is a new source combination, even when the HTML/CSS bytes are unchanged.
CREATE FUNCTION app.require_page_source_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb;
BEGIN
  IF app.is_super_admin() THEN RETURN NEW; END IF;
  -- Keep malformed-content diagnostics with the existing validation guards.
  IF jsonb_typeof(NEW.content) IS DISTINCT FROM 'array' THEN RETURN NEW; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF COALESCE(section->>'raw_html','')='' AND COALESCE(section->>'custom_css','')='' THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.page_versions previous
      CROSS JOIN LATERAL jsonb_array_elements(previous.content) AS retained(value)
      WHERE previous.page_id=NEW.page_id AND previous.site_id=NEW.site_id
        AND retained.value->'section_def_id' IS NOT DISTINCT FROM section->'section_def_id'
        AND retained.value->'section_def_version' IS NOT DISTINCT FROM section->'section_def_version'
        AND COALESCE(retained.value->>'raw_html','')=COALESCE(section->>'raw_html','')
        AND COALESCE(retained.value->>'custom_css','')=COALESCE(section->>'custom_css','')
    ) THEN
      RAISE EXCEPTION 'You can edit ordinary content while keeping this page''s existing custom code. Changing that code or combining it with a new section version requires a super admin.'
        USING ERRCODE='CMS02';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
ALTER FUNCTION app.require_page_source_authority() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.require_page_source_authority() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE TRIGGER page_versions_require_source_authority BEFORE INSERT ON public.page_versions
FOR EACH ROW EXECUTE FUNCTION app.require_page_source_authority();
