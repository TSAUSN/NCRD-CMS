-- A fixed display limit, not a public source connection or review setting.
DO $$ DECLARE source text;BEGIN
 source:=pg_get_functiondef('app.story_catalog_valid(jsonb)'::regprocedure);
 source:=replace(source,$old$(p_catalog-ARRAY['mainLabel','secondaryLabel','mainTags','secondaryTags'])$old$,$new$(p_catalog-ARRAY['mainLabel','secondaryLabel','mainTags','secondaryTags','sectorPageLimit'])$new$);
 source:=replace(source,'settings:=p_catalog||',$new$IF p_catalog ? 'sectorPageLimit' AND p_catalog->'sectorPageLimit' IS DISTINCT FROM '6'::jsonb THEN RETURN false;END IF;
 settings:=(p_catalog-'sectorPageLimit')||$new$);
 EXECUTE source;
 source:=pg_get_functiondef('app.with_story_catalog(jsonb,boolean)'::regprocedure);
 source:=replace(source,$old$RETURN p_binding||jsonb_build_object('storyCatalog',catalog);$old$,$new$IF settings->>'source'='sawso' THEN catalog:=catalog||'{"sectorPageLimit":6}'::jsonb;END IF;
 RETURN p_binding||jsonb_build_object('storyCatalog',catalog);$new$);
 EXECUTE source;
END $$;
