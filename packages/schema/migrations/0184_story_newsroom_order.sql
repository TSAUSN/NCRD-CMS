-- Optional Story feature positions remain ordinary content drafts. Preserve the
-- existing actor, role, revision and value checks; add one batch integrity rule.
DO $migration$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=pg_get_functiondef('app.save_collection_entries(uuid,bigint,jsonb)'::regprocedure);
 needle:=$old$  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) GROUP BY value->>'stableKey' HAVING count(*)>1)$old$;
 replacement:=$new$  IF head.reader_key='stories' THEN
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) e WHERE e->'values' ? 'newsroom_rank'
      AND e#>'{values,newsroom_rank}' NOT IN ('null'::jsonb,'""'::jsonb) AND (jsonb_typeof(e#>'{values,newsroom_rank}') IS DISTINCT FROM 'number' OR e#>>'{values,newsroom_rank}' !~ '^[0-5]$'))
      OR (SELECT count(*) FROM jsonb_array_elements(p_entries) e WHERE e#>>'{values,newsroom_rank}' ~ '^[1-5]$')>5
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) e WHERE e#>>'{values,newsroom_rank}' ~ '^[1-5]$' GROUP BY e#>>'{values,newsroom_rank}' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'Choose up to 5 featured stories, each with its own position' USING ERRCODE='CMS04';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) GROUP BY value->>'stableKey' HAVING count(*)>1)$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story save command changed; review newsroom guard placement';END IF;
 EXECUTE replace(definition,needle,replacement);

 definition:=pg_get_functiondef('app.normalize_list_selection_bounded(uuid,text,jsonb,boolean,integer)'::regprocedure);
 needle:=$old$row_number() OVER(ORDER BY CASE WHEN date_field IS NOT NULL THEN v.values->>date_field END DESC NULLS LAST,$old$;
 replacement:=$new$row_number() OVER(ORDER BY
   CASE WHEN p_reader='stories' AND p_max=200 AND NOT(p_selection ? 'filter')
     AND COALESCE(jsonb_array_length(tag_filter->'main'),0)=0 AND COALESCE(jsonb_array_length(tag_filter->'secondary'),0)=0
    THEN CASE WHEN jsonb_typeof(v.values->'newsroom_rank')='number' AND v.values->>'newsroom_rank' ~ '^[1-5]$' THEN (v.values->>'newsroom_rank')::int ELSE 6 END END,
   CASE WHEN date_field IS NOT NULL THEN v.values->>date_field END DESC NULLS LAST,$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story selection changed; review featured ordering';END IF;
 EXECUTE replace(definition,needle,replacement);

 definition:=pg_get_functiondef('app.full_story_widget_source(uuid,jsonb,jsonb,boolean,jsonb)'::regprocedure);
 needle:=$old$ARRAY['title','summary','published_date'$old$;
 replacement:=$new$ARRAY['title','summary','newsroom_rank','published_date'$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story card projection changed; review newsroom metadata';END IF;
 EXECUTE replace(definition,needle,replacement);
 definition:=pg_get_functiondef('app.full_story_widget_source(uuid,jsonb,jsonb,boolean,jsonb)'::regprocedure);
 needle:=$old$RETURN p_base||jsonb_build_object('entries',entries,'schemas',schemas);$old$;
 replacement:=$new$IF p_base ? 'storyCatalog' THEN
  p_base:=jsonb_set(p_base,'{storyCatalog,newsroomOrder}',to_jsonb(NOT(p_selection ? 'filter')
   AND COALESCE(jsonb_array_length(p_selection#>'{storyTags,main}'),0)=0
   AND COALESCE(jsonb_array_length(p_selection#>'{storyTags,secondary}'),0)=0));
 END IF;
 RETURN p_base||jsonb_build_object('entries',entries,'schemas',schemas);$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story widget catalogue changed; review filtered date ordering';END IF;
 EXECUTE replace(definition,needle,replacement);
 definition:=pg_get_functiondef('app.story_catalog_valid(jsonb)'::regprocedure);
 needle:=$old$'secondaryTags','sectorPageLimit'$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story catalogue shape changed; review newsroom display flag';END IF;
 definition:=replace(definition,needle,$new$'secondaryTags','sectorPageLimit','newsroomOrder'$new$);
 needle:=$old$settings:=(p_catalog-'sectorPageLimit')||$old$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story catalogue validation changed; review newsroom display flag';END IF;
 replacement:=$new$IF p_catalog ? 'newsroomOrder' AND jsonb_typeof(p_catalog->'newsroomOrder') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 settings:=(p_catalog-ARRAY['sectorPageLimit','newsroomOrder'])||$new$;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
