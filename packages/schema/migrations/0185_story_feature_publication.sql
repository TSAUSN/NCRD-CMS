-- A scoped Story release must leave the combined public feature positions valid.
-- Keep the existing locks, permissions, review and revision checks unchanged.
DO $migration$
DECLARE definition text;needle text;replacement text;
BEGIN
 definition:=pg_get_functiondef('app.publish_story_entries(uuid,bigint,uuid[])'::regprocedure);
 needle:=$old$  UPDATE public.collection_entries SET published_version_id=draft_version_id,$old$;
 replacement:=$new$  IF (WITH chosen AS (
    SELECT version.values AS story_values FROM public.collection_entries entry
    JOIN public.collection_entry_versions version ON version.id=CASE WHEN entry.id=ANY(p_entry_ids) THEN entry.draft_version_id ELSE entry.published_version_id END AND version.entry_id=entry.id
    WHERE entry.collection_id=head.id AND CASE WHEN entry.id=ANY(p_entry_ids) THEN entry.archived_at ELSE entry.published_archived_at END IS NULL
   ), featured AS (SELECT story_values->>'newsroom_rank' AS position FROM chosen WHERE jsonb_typeof(story_values->'newsroom_rank')='number' AND story_values->>'newsroom_rank' ~ '^[1-5]$')
   SELECT count(*)>5 OR count(DISTINCT position)<>count(*) FROM featured) THEN
   RAISE EXCEPTION 'Publish the changed Newsroom order together from the site Publish screen. Other featured stories still have draft changes.' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.collection_entries SET published_version_id=draft_version_id,$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Scoped Story publication changed; review feature-order guard';END IF;
 EXECUTE replace(definition,needle,replacement);
 definition:=pg_get_functiondef('app.full_story_widget_source(uuid,jsonb,jsonb,boolean,jsonb)'::regprocedure);
 needle:=$old$IF p_base->>'readerKey' IS DISTINCT FROM 'stories' OR p_selection->>'mode' IS DISTINCT FROM 'automatic' THEN RETURN p_base;END IF;$old$;
 replacement:=$new$IF p_base->>'readerKey' IS DISTINCT FROM 'stories' THEN RETURN p_base;END IF;
 IF p_selection->>'mode' IS DISTINCT FROM 'automatic' THEN
  IF p_base ? 'storyCatalog' THEN p_base:=jsonb_set(p_base,'{storyCatalog,newsroomOrder}','false'::jsonb);END IF;
  RETURN p_base;
 END IF;$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story widget source changed; review manual ordering';END IF;
 EXECUTE replace(definition,needle,replacement);
 definition:=pg_get_functiondef('app.expand_story_widget_values(uuid,jsonb,jsonb,boolean)'::regprocedure);
 needle:=$old$IF binding->>'readerKey' IS DISTINCT FROM 'stories' OR binding#>>'{selection,mode}' IS DISTINCT FROM 'automatic' THEN CONTINUE;END IF;$old$;
 replacement:=$new$IF binding->>'readerKey' IS DISTINCT FROM 'stories' THEN CONTINUE;END IF;
  IF binding#>>'{selection,mode}' IS DISTINCT FROM 'automatic' THEN
   IF p_values#>ARRAY[field_name,'storyCatalog'] IS NOT NULL THEN
    p_values:=jsonb_set(p_values,ARRAY[field_name,'storyCatalog','newsroomOrder'],'false'::jsonb);
   END IF;
   CONTINUE;
  END IF;$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story widget expansion changed; review manual ordering';END IF;
 EXECUTE replace(definition,needle,replacement);
END $migration$;
