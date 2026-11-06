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
        WHEN 'surface' THEN choice.value #>> '{}' IN ('page','soft','primary','accent')
        WHEN 'spacing' THEN choice.value #>> '{}' IN ('compact','comfortable','spacious')
        WHEN 'width' THEN choice.value #>> '{}' IN ('reading','standard','wide','full')
        WHEN 'align' THEN choice.value #>> '{}' IN ('start','center','end')
        WHEN 'mobileOrder' THEN choice.value #>> '{}'='reverse' ELSE false END;
      IF NOT valid THEN RETURN 'unsupported section appearance choice'; END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $$;

CREATE FUNCTION app.supports_mobile_stack_order(p_doc jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE stack jsonb; node jsonb; containers int:=0; visited int:=0;
BEGIN
  IF jsonb_typeof(p_doc->'nodes') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  stack:=p_doc->'nodes';
  WHILE jsonb_array_length(stack)>0 LOOP
    visited:=visited+1; IF visited>2000 THEN RETURN false; END IF;
    node:=stack->0; stack:=stack-0;
    IF node->>'type' IS DISTINCT FROM 'element' THEN CONTINUE; END IF;
    IF COALESCE(node#>>'{attributes,class}','') ~ '(^|[[:space:]])builder-columns([[:space:]]|$)' THEN
      IF jsonb_typeof(node->'children') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
      IF jsonb_array_length(node->'children')<>2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(node->'children') child WHERE child->>'type' IS DISTINCT FROM 'element') THEN RETURN false; END IF;
      containers:=containers+1;
    END IF;
    IF jsonb_typeof(node->'children')='array' THEN stack:=stack||(node->'children'); END IF;
  END LOOP;
  RETURN containers=1;
END $$;

CREATE FUNCTION app.validate_mobile_stack_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE section jsonb; doc jsonb;
BEGIN
  FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
    IF section#>>'{appearance,mobileOrder}' IS NULL THEN CONTINUE; END IF;
    SELECT structured_doc INTO doc FROM public.section_def_versions
      WHERE section_def_id::text=section->>'section_def_id' AND version::text=section->>'section_def_version';
    IF NOT app.supports_mobile_stack_order(doc) THEN
      RAISE EXCEPTION 'phone column order requires one two-column group from the visual builder' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER page_versions_mobile_stack BEFORE INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.validate_mobile_stack_order();
ALTER FUNCTION app.supports_mobile_stack_order(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.validate_mobile_stack_order() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.supports_mobile_stack_order(jsonb),app.validate_mobile_stack_order() FROM PUBLIC;
