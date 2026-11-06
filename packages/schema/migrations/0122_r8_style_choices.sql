-- Closed revision 8 style choices. Existing custom-source, capability and AA guards remain.
CREATE OR REPLACE FUNCTION app.section_appearance_defect(p_content jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE section jsonb; choice RECORD; valid boolean;
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'array' THEN RETURN 'page content must be a list'; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(p_content) LOOP
    IF NOT section ? 'appearance' THEN CONTINUE; END IF;
    IF jsonb_typeof(section->'appearance') IS DISTINCT FROM 'object' THEN RETURN 'section appearance must be named choices'; END IF;
    FOR choice IN SELECT key,value FROM jsonb_each(section->'appearance') LOOP
      IF jsonb_typeof(choice.value) IS DISTINCT FROM 'string' THEN RETURN 'appearance choices must be text'; END IF;
      valid := CASE choice.key
        WHEN 'surface' THEN choice.value #>> '{}' IN ('page','soft','primary','accent','dark')
        WHEN 'spacing' THEN choice.value #>> '{}' IN ('compact','comfortable','spacious')
        WHEN 'width' THEN choice.value #>> '{}' IN ('reading','standard','wide','full')
        WHEN 'align' THEN choice.value #>> '{}' IN ('start','center','end')
        WHEN 'imagePosition' THEN choice.value #>> '{}' IN ('left','right')
        WHEN 'mobileOrder' THEN choice.value #>> '{}'='reverse' ELSE false END;
      IF NOT valid THEN RETURN 'unsupported section appearance choice'; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

-- Global core capabilities are closed style choices; custom source and contrast guards remain.
CREATE OR REPLACE FUNCTION app.validate_page_appearance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE section jsonb; definition RECORD; defect text; flags jsonb; choice RECORD;
BEGIN
  defect := app.section_appearance_defect(NEW.content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04'; END IF;
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF NOT section ? 'appearance' OR section->'appearance'='{}'::jsonb THEN CONTINUE; END IF;
    IF COALESCE(btrim(section->>'raw_html'),'')<>'' OR COALESCE(btrim(section->>'custom_css'),'')<>'' THEN
      RAISE EXCEPTION 'reset appearance before using custom section HTML or CSS' USING ERRCODE='CMS04';
    END IF;
    SELECT v.definition_kind,v.structured_doc,v.slots,d.scope,d.slug INTO definition FROM public.section_def_versions v JOIN public.section_defs d ON d.id=v.section_def_id
      WHERE v.section_def_id::text=section->>'section_def_id' AND v.version::text=section->>'section_def_version';
    IF definition.scope='global' AND definition.slug LIKE 'core-%' AND definition.slots#>>'{0,constraints,coreLibrary}'='r8' THEN
      flags:=definition.slots#>'{0,constraints,coreCapabilities}';
      FOR choice IN SELECT key,value FROM jsonb_each(section->'appearance') LOOP
        IF flags->>(CASE choice.key WHEN 'surface' THEN 'background' WHEN 'align' THEN 'alignment' WHEN 'mobileOrder' THEN 'phoneOrder' ELSE choice.key END) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'this section does not support that style choice' USING ERRCODE='CMS04';
        END IF;
      END LOOP;
      CONTINUE;
    END IF;
    IF section#>>'{appearance,imagePosition}' IS NOT NULL THEN RAISE EXCEPTION 'this section controls its picture position' USING ERRCODE='CMS04'; END IF;
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


CREATE OR REPLACE FUNCTION app.assert_section_appearance_contrast(p_manifest jsonb,p_theme jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE section jsonb; surface text; background text; foreground text; colors jsonb;
BEGIN
  colors := '{"surface":"#ffffff","surfaceAlt":"#f4f6f8","ink":"#172033","primary":"#003087","primaryContrast":"#ffffff","accent":"#d22630","accentContrast":"#ffffff"}'::jsonb || COALESCE(p_theme->'colors','{}'::jsonb);
  FOR section IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) LOOP
    surface := section #>> '{instance,appearance,surface}';
    IF surface IS NULL OR section #>> '{instance,hidden}'='true' THEN CONTINUE; END IF;
    background := colors->>CASE surface WHEN 'page' THEN 'surface' WHEN 'soft' THEN 'surfaceAlt' WHEN 'dark' THEN 'ink' ELSE surface END;
    foreground := colors->>CASE surface WHEN 'primary' THEN 'primaryContrast' WHEN 'accent' THEN 'accentContrast' WHEN 'dark' THEN 'surface' ELSE 'ink' END;
    IF COALESCE(app.theme_contrast_ratio(foreground,background),0)<4.5 THEN
      RAISE EXCEPTION 'section appearance needs at least 4.5:1 text contrast; choose another background or adjust its paired colours in Site look' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
END $$;

