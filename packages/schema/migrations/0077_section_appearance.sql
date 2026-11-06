-- Closed instance choices; no authored CSS, new executable content, or rewrites
-- of existing section definitions. Missing appearance retains original output.
CREATE FUNCTION app.section_appearance_defect(p_content jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE section jsonb; choice RECORD; valid boolean;
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'array' THEN RETURN 'page content must be a list'; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    IF NOT section ? 'appearance' THEN CONTINUE; END IF;
    IF jsonb_typeof(section->'appearance') IS DISTINCT FROM 'object' THEN RETURN 'section appearance must be named choices'; END IF;
    FOR choice IN SELECT key,value FROM jsonb_each(section->'appearance') LOOP
      IF jsonb_typeof(choice.value) IS DISTINCT FROM 'string' THEN RETURN 'appearance choices must be text'; END IF;
      valid := CASE choice.key
        WHEN 'surface' THEN choice.value #>> '{}' IN ('page','soft','primary','accent')
        WHEN 'spacing' THEN choice.value #>> '{}' IN ('compact','comfortable','spacious')
        WHEN 'width' THEN choice.value #>> '{}' IN ('reading','standard','wide','full')
        WHEN 'align' THEN choice.value #>> '{}' IN ('start','center','end') ELSE false END;
      IF NOT valid THEN RETURN 'unsupported section appearance choice'; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

ALTER TABLE public.page_versions ADD CONSTRAINT page_versions_appearance_shape CHECK (app.section_appearance_defect(content) IS NULL);

CREATE FUNCTION app.validate_page_appearance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE section jsonb; definition RECORD; defect text;
BEGIN
  defect := app.section_appearance_defect(NEW.content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04'; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF NOT section ? 'appearance' OR section->'appearance'='{}'::jsonb THEN CONTINUE; END IF;
    IF COALESCE(btrim(section->>'raw_html'),'')<>'' OR COALESCE(btrim(section->>'custom_css'),'')<>'' THEN
      RAISE EXCEPTION 'reset appearance before using custom section HTML or CSS' USING ERRCODE='CMS04';
    END IF;
    SELECT definition_kind,structured_doc INTO definition FROM public.section_def_versions
      WHERE section_def_id::text=section->>'section_def_id' AND version::text=section->>'section_def_version';
    IF definition.definition_kind IS DISTINCT FROM 'structured'
      OR jsonb_typeof(definition.structured_doc->'nodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(definition.structured_doc->'nodes')<>1
      OR definition.structured_doc #>> '{nodes,0,type}' IS DISTINCT FROM 'element'
      OR COALESCE(definition.structured_doc #>> '{nodes,0,tag}','') NOT IN ('section','div','article') THEN
      RAISE EXCEPTION 'this section definition controls its own layout' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER page_versions_validate_appearance BEFORE INSERT ON public.page_versions
FOR EACH ROW EXECUTE FUNCTION app.validate_page_appearance();

ALTER FUNCTION app.build_render_manifest_internal(uuid) RENAME TO build_render_manifest_before_appearance_0077;
CREATE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE manifest jsonb; content jsonb; sections jsonb;
BEGIN
  manifest := app.build_render_manifest_before_appearance_0077(p_page_version_id);
  SELECT v.content INTO content FROM public.page_versions v WHERE id=p_page_version_id;
  SELECT COALESCE(jsonb_agg(CASE WHEN (content->((ordinality-1)::int)) ? 'appearance'
    THEN jsonb_set(value,'{instance,appearance}',content->((ordinality-1)::int)->'appearance',true)
    ELSE value END ORDER BY ordinality),'[]'::jsonb) INTO sections
    FROM jsonb_array_elements(manifest->'sections') WITH ORDINALITY;
  RETURN jsonb_set(manifest,'{sections}',sections);
END $$;

-- The chosen theme pair is a publication invariant, including when a later
-- theme change would make an already-published section unreadable.
CREATE FUNCTION app.assert_section_appearance_contrast(p_manifest jsonb,p_theme jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE section jsonb; surface text; background text; foreground text; colors jsonb;
BEGIN
  colors := '{"surface":"#ffffff","surfaceAlt":"#f4f6f8","ink":"#172033","primary":"#003087","primaryContrast":"#ffffff","accent":"#d22630","accentContrast":"#ffffff"}'::jsonb || COALESCE(p_theme->'colors','{}'::jsonb);
  FOR section IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) LOOP
    surface := section #>> '{instance,appearance,surface}';
    IF surface IS NULL OR section #>> '{instance,hidden}'='true' THEN CONTINUE; END IF;
    background := colors->>CASE surface WHEN 'page' THEN 'surface' WHEN 'soft' THEN 'surfaceAlt' ELSE surface END;
    foreground := colors->>CASE surface WHEN 'primary' THEN 'primaryContrast' WHEN 'accent' THEN 'accentContrast' ELSE 'ink' END;
    IF COALESCE(app.theme_contrast_ratio(foreground,background),0)<4.5 THEN
      RAISE EXCEPTION 'section appearance needs at least 4.5:1 text contrast; choose another background or adjust its paired colours in Design' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION app.check_route_appearance_contrast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE theme jsonb;
BEGIN
  SELECT payload->'theme' INTO theme FROM public.published_site_shells WHERE site_id=NEW.site_id;
  PERFORM app.assert_section_appearance_contrast(NEW.render_manifest,theme);
  RETURN NEW;
END $$;
CREATE TRIGGER routes_appearance_contrast BEFORE INSERT OR UPDATE ON public.published_routes
FOR EACH ROW EXECUTE FUNCTION app.check_route_appearance_contrast();

CREATE FUNCTION app.check_shell_appearance_contrast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE route RECORD;
BEGIN
  FOR route IN SELECT render_manifest FROM public.published_routes WHERE site_id=NEW.site_id LOOP
    PERFORM app.assert_section_appearance_contrast(route.render_manifest,NEW.payload->'theme');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER shell_appearance_contrast BEFORE INSERT OR UPDATE ON public.published_site_shells
FOR EACH ROW EXECUTE FUNCTION app.check_shell_appearance_contrast();

REVOKE ALL ON FUNCTION app.section_appearance_defect(jsonb),app.validate_page_appearance(),
  app.build_render_manifest_before_appearance_0077(uuid),app.build_render_manifest_internal(uuid),
  app.assert_section_appearance_contrast(jsonb,jsonb),app.check_route_appearance_contrast(),app.check_shell_appearance_contrast() FROM PUBLIC;
ALTER FUNCTION app.section_appearance_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.validate_page_appearance() OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_internal(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_section_appearance_contrast(jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_route_appearance_contrast() OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_shell_appearance_contrast() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.build_render_manifest_before_appearance_0077(uuid) FROM cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.build_render_manifest_internal(uuid) TO cms_worker;
