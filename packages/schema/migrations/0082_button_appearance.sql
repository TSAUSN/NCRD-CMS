-- The value owns a closed appearance choice; no CSS or executable value is stored.
CREATE FUNCTION app.button_appearance_defect(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RETURN 'button appearance must be named choices'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_value))<>4
    OR NOT p_value ?& ARRAY['style','color','radius','hover']
    OR jsonb_typeof(p_value->'style') IS DISTINCT FROM 'string' OR p_value->>'style' NOT IN ('solid','outline')
    OR jsonb_typeof(p_value->'color') IS DISTINCT FROM 'string' OR p_value->>'color' NOT IN ('primary','accent')
    OR jsonb_typeof(p_value->'radius') IS DISTINCT FROM 'string' OR p_value->>'radius' NOT IN ('square','soft','rounded','pill')
    OR jsonb_typeof(p_value->'hover') IS DISTINCT FROM 'string' OR p_value->>'hover' NOT IN ('none','lift','invert','underline') THEN
    RETURN 'unsupported button appearance choice';
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION app.validate_page_button_appearance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; field RECORD; slots jsonb; slot jsonb; defect text;
BEGIN
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    FOR field IN SELECT key,value FROM jsonb_each(COALESCE(section->'values','{}'::jsonb)) LOOP
      IF jsonb_typeof(field.value) IS DISTINCT FROM 'object' OR NOT field.value ? 'buttonAppearance' THEN CONTINUE; END IF;
      defect := app.button_appearance_defect(field.value->'buttonAppearance');
      IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04'; END IF;
      IF COALESCE(btrim(section->>'raw_html'),'')<>'' OR COALESCE(btrim(section->>'custom_css'),'')<>'' THEN
        RAISE EXCEPTION 'reset button appearance before using custom section HTML or CSS' USING ERRCODE='CMS04';
      END IF;
      SELECT v.slots INTO slots FROM public.section_def_versions v
        WHERE v.section_def_id::text=section->>'section_def_id' AND v.version::text=section->>'section_def_version';
      SELECT value INTO slot FROM jsonb_array_elements(COALESCE(slots,'[]'::jsonb)) WHERE value->>'id'=field.key;
      IF slot IS NULL OR COALESCE(slot->>'kind','') NOT IN ('button','link')
        OR slot #>> '{constraints,destinationOnly}'='true' THEN
        RAISE EXCEPTION 'button appearance is available only on editable link and button fields' USING ERRCODE='CMS04';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER page_versions_validate_button_appearance BEFORE INSERT ON public.page_versions
FOR EACH ROW EXECUTE FUNCTION app.validate_page_button_appearance();

CREATE FUNCTION app.assert_button_appearance_contrast(p_manifest jsonb,p_theme jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; field jsonb; choice text; colors jsonb;
BEGIN
  colors := '{"primary":"#003087","primaryContrast":"#ffffff","accent":"#d22630","accentContrast":"#ffffff"}'::jsonb || COALESCE(p_theme->'colors','{}'::jsonb);
  FOR section IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) LOOP
    IF section #>> '{instance,hidden}'='true' THEN CONTINUE; END IF;
    FOR field IN SELECT value FROM jsonb_each(COALESCE(section #> '{instance,values}','{}'::jsonb)) LOOP
      IF jsonb_typeof(field) IS DISTINCT FROM 'object' OR NOT field ? 'buttonAppearance' THEN CONTINUE; END IF;
      choice := field #>> '{buttonAppearance,color}';
      IF app.button_appearance_defect(field->'buttonAppearance') IS NOT NULL
        OR COALESCE(app.theme_contrast_ratio(colors->>(choice||'Contrast'),colors->>choice),0)<4.5 THEN
        RAISE EXCEPTION 'button appearance needs at least 4.5:1 text contrast; choose another colour or adjust its paired colours in Design' USING ERRCODE='CMS04';
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION app.check_route_button_contrast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE theme jsonb;
BEGIN
  SELECT payload->'theme' INTO theme FROM public.published_site_shells WHERE site_id=NEW.site_id;
  PERFORM app.assert_button_appearance_contrast(NEW.render_manifest,theme);
  RETURN NEW;
END $$;
CREATE TRIGGER routes_button_contrast BEFORE INSERT OR UPDATE ON public.published_routes
FOR EACH ROW EXECUTE FUNCTION app.check_route_button_contrast();

CREATE FUNCTION app.check_shell_button_contrast() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE route RECORD;
BEGIN
  FOR route IN SELECT render_manifest FROM public.published_routes WHERE site_id=NEW.site_id LOOP
    PERFORM app.assert_button_appearance_contrast(route.render_manifest,NEW.payload->'theme');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER shell_button_contrast BEFORE INSERT OR UPDATE ON public.published_site_shells
FOR EACH ROW EXECUTE FUNCTION app.check_shell_button_contrast();

REVOKE ALL ON FUNCTION app.button_appearance_defect(jsonb),app.validate_page_button_appearance(),
  app.assert_button_appearance_contrast(jsonb,jsonb),app.check_route_button_contrast(),app.check_shell_button_contrast() FROM PUBLIC;
ALTER FUNCTION app.button_appearance_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.validate_page_button_appearance() OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_button_appearance_contrast(jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_route_button_contrast() OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_shell_button_contrast() OWNER TO cms_migration_owner;
