-- Bounded, dynamic choices. The canonical resolver still verifies every chosen
-- published record/schema and supplies the same immutable renderer envelope.
CREATE OR REPLACE FUNCTION app.normalize_list_selection(p_site uuid,p_reader text,p_selection jsonb,p_draft boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source record; field_spec jsonb; keys jsonb;
BEGIN
  IF p_selection->>'mode' IS DISTINCT FROM 'automatic' OR NOT(p_selection ?| ARRAY['order','filter']) THEN RETURN p_selection; END IF;
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object'
    OR (p_selection-ARRAY['mode','limit','order','filter'])<>'{}'::jsonb
    OR jsonb_typeof(p_selection->'limit') IS DISTINCT FROM 'number'
    OR COALESCE(p_selection->>'limit','') !~ '^(100|[1-9][0-9]?)$'
    OR (p_selection ? 'order' AND p_selection->>'order' IS DISTINCT FROM 'newest') THEN
    RAISE EXCEPTION 'invalid list selection' USING ERRCODE='CMS04'; END IF;
  SELECT c.id,v.fields INTO source FROM public.collections c JOIN public.collection_schema_versions v
    ON v.id=CASE WHEN p_draft THEN COALESCE(c.published_schema_version_id,c.draft_schema_version_id) ELSE c.published_schema_version_id END AND v.collection_id=c.id
    WHERE c.site_id=p_site AND c.reader_key=p_reader;
  IF source.id IS NULL THEN RAISE EXCEPTION 'list is unavailable on this site' USING ERRCODE='CMS04'; END IF;
  IF p_selection ? 'filter' THEN
    IF jsonb_typeof(p_selection->'filter') IS DISTINCT FROM 'object'
      OR ((p_selection->'filter')-ARRAY['field','value'])<>'{}'::jsonb
      OR NOT((p_selection->'filter') ?& ARRAY['field','value'])
      OR jsonb_typeof(p_selection#>'{filter,field}') IS DISTINCT FROM 'string'
      OR jsonb_typeof(p_selection#>'{filter,value}') IS DISTINCT FROM 'string'
      OR char_length(btrim(p_selection#>>'{filter,value}')) NOT BETWEEN 1 AND 120 THEN
      RAISE EXCEPTION 'choose a tag or category value' USING ERRCODE='CMS04'; END IF;
    SELECT f INTO field_spec FROM jsonb_array_elements(source.fields) f WHERE f->>'key'=p_selection#>>'{filter,field}'
      AND (f->>'type'='select' OR (f->>'type'='text' AND f->>'key' IN ('tag','tags','category','categories')));
    IF field_spec IS NULL THEN RAISE EXCEPTION 'this list has no matching tag or category field' USING ERRCODE='CMS04'; END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(chosen.stable_key ORDER BY chosen.position),'[]'::jsonb) INTO keys FROM (
    SELECT e.stable_key,row_number() OVER(ORDER BY CASE WHEN p_selection->>'order'='newest' THEN e.created_at END DESC,
      CASE WHEN p_selection->>'order' IS DISTINCT FROM 'newest' THEN CASE WHEN p_draft THEN e.sort_index ELSE e.published_sort_index END END,e.id DESC) AS position
    FROM public.collection_entries e JOIN public.collection_entry_versions v
      ON v.id=CASE WHEN p_draft THEN e.draft_version_id ELSE e.published_version_id END AND v.entry_id=e.id
    WHERE e.collection_id=source.id AND CASE WHEN p_draft THEN e.archived_at ELSE e.published_archived_at END IS NULL
      AND (NOT(p_selection ? 'filter') OR EXISTS(SELECT 1 FROM regexp_split_to_table(
        COALESCE(v.values->>(p_selection#>>'{filter,field}'),''),CASE WHEN field_spec->>'key' IN ('tag','tags') THEN ',' ELSE chr(1) END) tag
        WHERE lower(btrim(tag))=lower(btrim(p_selection#>>'{filter,value}'))))
    ORDER BY position LIMIT (p_selection->>'limit')::int
  ) chosen;
  RETURN jsonb_build_object('mode','manual','stableKeys',keys);
END $$;
REVOKE ALL ON FUNCTION app.normalize_list_selection(uuid,text,jsonb,boolean) FROM PUBLIC;
ALTER FUNCTION app.normalize_list_selection(uuid,text,jsonb,boolean) OWNER TO cms_migration_owner;

DO $$ DECLARE source text; signature text; BEGIN
  FOREACH signature IN ARRAY ARRAY['app.resolve_collection_repeat(uuid,text,jsonb,jsonb)','app.resolve_initial_preview_repeat(uuid,text,jsonb,jsonb)'] LOOP
    source:=pg_get_functiondef(signature::regprocedure);
    IF position('app.normalize_list_selection' IN source)=0 THEN
      source:=replace(source,E'BEGIN\n',E'BEGIN\n  p_selection:=app.normalize_list_selection(p_site_id,p_reader_key,p_selection,'||CASE WHEN signature LIKE '%initial%' THEN 'NOT EXISTS(SELECT 1 FROM public.collections WHERE site_id=p_site_id AND reader_key=p_reader_key AND published_schema_version_id IS NOT NULL)' ELSE 'false' END||E');\n');
      EXECUTE source;
    END IF;
  END LOOP;
  -- Recipes retain the dynamic choice; validate a normalized copy only.
  source:=pg_get_functiondef('app.assert_page_recipe_content(uuid,jsonb)'::regprocedure);
  IF position('app.normalize_list_selection' IN source)=0 THEN
    source:=replace(source,'IF binding#>>''{selection,mode}''=''automatic'' THEN',
      'binding:=jsonb_set(binding,''{selection}'',app.normalize_list_selection(p_site,binding->>''readerKey'',binding->''selection'',true)); IF binding#>>''{selection,mode}''=''automatic'' THEN');
    EXECUTE source;
  END IF;
END $$;
