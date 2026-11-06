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

CREATE OR REPLACE FUNCTION app.validate_mobile_stack_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; doc jsonb; core boolean;
BEGIN
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF section#>>'{appearance,mobileOrder}' IS NULL THEN CONTINUE; END IF;
    SELECT v.structured_doc,(d.scope='global' AND d.slug LIKE 'core-%' AND v.slots#>>'{0,constraints,coreLibrary}'='r8' AND v.slots#>>'{0,constraints,coreCapabilities,phoneOrder}'='true') INTO doc,core
      FROM public.section_def_versions v JOIN public.section_defs d ON d.id=v.section_def_id
      WHERE v.section_def_id::text=section->>'section_def_id' AND v.version::text=section->>'section_def_version';
    IF core THEN CONTINUE; END IF;
    IF NOT app.supports_mobile_stack_order(doc) THEN
      RAISE EXCEPTION 'phone column order requires one two-column group from the visual builder' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
