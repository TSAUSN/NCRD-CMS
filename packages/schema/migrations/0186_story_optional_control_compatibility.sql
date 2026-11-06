-- Immutable old Story versions can remain when existing fields are identical
-- and the only additions are the two approved optional controls. Every ordinary
-- ownership, value, media, revision, review and publication check still runs.
CREATE FUNCTION app.story_controls_schema_compatible(p_before uuid,p_after uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.collection_schema_versions old
  JOIN public.collection_schema_versions next_schema ON next_schema.collection_id=old.collection_id
  JOIN public.collections collection ON collection.id=old.collection_id
  WHERE old.id=p_before AND next_schema.id=p_after AND collection.reader_key='stories'
   AND old.fields=(SELECT COALESCE(jsonb_agg(field ORDER BY position),'[]'::jsonb)
    FROM jsonb_array_elements(next_schema.fields) WITH ORDINALITY item(field,position)
    WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(old.fields) prior WHERE prior->>'key'=field->>'key'))
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(next_schema.fields) added
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old.fields) prior WHERE prior->>'key'=added->>'key')
     AND added NOT IN ('{"key":"author","type":"text","label":"Author","required":false}'::jsonb,
      '{"key":"newsroom_rank","type":"number","label":"Newsroom order","required":false}'::jsonb))
 )
$$;
ALTER FUNCTION app.story_controls_schema_compatible(uuid,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.story_controls_schema_compatible(uuid,uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
-- Read-only shape checks use precisely the caller's existing row access.
GRANT EXECUTE ON FUNCTION app.story_controls_schema_compatible(uuid,uuid) TO cms_authenticated_user;
DO $migration$
DECLARE definition text;needle text;replacement text;signature text;
BEGIN
 definition:=pg_get_functiondef('app.save_collection_entries(uuid,bigint,jsonb)'::regprocedure);
 needle:=$old$AND version.collection_id=head.id AND version.schema_version_id=schema_head.id
             AND version."values"=normalized_values$old$;
 replacement:=$new$AND version.collection_id=head.id AND (
              (version.schema_version_id=schema_head.id AND version."values"=normalized_values)
              OR (app.story_controls_schema_compatible(version.schema_version_id,schema_head.id)
               AND app.normalize_collection_entry_values(schema_head.fields,version."values")=normalized_values))$new$;
 IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Story no-op guard changed; review optional-control compatibility';END IF;
 EXECUTE replace(definition,needle,replacement);
 FOREACH signature IN ARRAY ARRAY['app.publish_collection_entries_core(uuid,bigint)','app.publish_story_entries(uuid,bigint,uuid[])'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:=$old$IF draft_entry.schema_version_id<>schema_head.id THEN RAISE EXCEPTION 'entry drafts must be saved against the published collection schema'$old$;
  replacement:=$new$IF draft_entry.schema_version_id<>schema_head.id AND NOT app.story_controls_schema_compatible(draft_entry.schema_version_id,schema_head.id) THEN RAISE EXCEPTION 'entry drafts must be saved against the published collection schema'$new$;
  IF position(needle IN definition)=0 THEN RAISE EXCEPTION 'Entry publication model guard changed; review optional Story controls';END IF;
  EXECUTE replace(definition,needle,replacement);
 END LOOP;
END $migration$;
