-- Explicit Story visibility applies to manual placements as well as feeds.
-- No content backfill, role grants, or publication bypass.
CREATE FUNCTION app.story_visible(p_values jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT p_values->'hidden' IS DISTINCT FROM 'true'::jsonb
 AND p_values->'feed_removed' IS DISTINCT FROM 'true'::jsonb
 AND p_values->'in_feed' IS DISTINCT FROM 'false'::jsonb
$$;
ALTER FUNCTION app.story_visible(jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.story_visible(jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE OR REPLACE FUNCTION app.normalize_list_selection(p_site uuid,p_reader text,p_selection jsonb,p_draft boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source record;field_spec jsonb;keys jsonb;tag_group text;tag_filter jsonb;date_field text:=p_selection->>'dateField';
BEGIN
 IF p_reader='stories' AND p_selection->>'mode'='manual' AND jsonb_typeof(p_selection->'stableKeys')='array' THEN
  IF (p_selection-ARRAY['mode','stableKeys'])<>'{}'::jsonb OR jsonb_array_length(p_selection->'stableKeys')>200
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selection->'stableKeys') k WHERE jsonb_typeof(k) IS DISTINCT FROM 'string' OR char_length(k#>>'{}')>80 OR k#>>'{}' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selection->'stableKeys') k GROUP BY k HAVING count(*)>1) THEN RETURN p_selection;END IF;
  -- Keep invalid/missing selections for the existing downstream validation.
  -- Remove only known, explicitly hidden source records, preserving order.
  SELECT COALESCE(jsonb_agg(w.key ORDER BY w.position),'[]'::jsonb) INTO keys
  FROM jsonb_array_elements(p_selection->'stableKeys') WITH ORDINALITY w(key,position)
  WHERE jsonb_typeof(w.key) IS DISTINCT FROM 'string' OR NOT EXISTS(
   SELECT 1 FROM public.collections c JOIN public.collection_entries e ON e.collection_id=c.id
    JOIN public.collection_entry_versions v ON v.id=CASE WHEN p_draft THEN e.draft_version_id ELSE e.published_version_id END AND v.entry_id=e.id
   WHERE c.site_id=p_site AND c.reader_key='stories' AND e.stable_key=w.key#>>'{}'
    AND NOT app.story_visible(v.values));
  p_selection:=jsonb_set(p_selection,'{stableKeys}',keys);
 END IF;
 IF p_reader='stories' AND p_selection->>'mode'='automatic' THEN
  IF p_selection ? 'dateField' AND p_selection->>'dateField' IS DISTINCT FROM 'published_date' THEN RAISE EXCEPTION 'Stories use the story date' USING ERRCODE='CMS04';END IF;
  IF p_selection ? 'maxAgeMonths' AND p_selection->'maxAgeMonths' IS DISTINCT FROM '13'::jsonb THEN RAISE EXCEPTION 'Stories use a 13-month feed limit' USING ERRCODE='CMS04';END IF;
  p_selection:=p_selection||jsonb_build_object('dateField','published_date','maxAgeMonths',13);
  date_field:='published_date';
 END IF;
 IF p_selection->>'mode' IS DISTINCT FROM 'automatic' OR (p_reader<>'stories' AND NOT(p_selection ?| ARRAY['order','filter','dateField','maxAgeMonths','excludeStableKey','storyTags'])) THEN RETURN p_selection;END IF;
 IF jsonb_typeof(p_selection) IS DISTINCT FROM 'object' OR (p_selection-ARRAY['mode','limit','order','filter','dateField','maxAgeMonths','excludeStableKey','storyTags'])<>'{}'::jsonb
  OR jsonb_typeof(p_selection->'limit') IS DISTINCT FROM 'number' OR COALESCE(p_selection->>'limit','') !~ '^(200|1[0-9]{2}|[1-9][0-9]?)$'
  OR (p_selection ? 'order' AND p_selection->>'order' IS DISTINCT FROM 'newest') THEN RAISE EXCEPTION 'invalid list selection' USING ERRCODE='CMS04';END IF;
 SELECT c.id,v.fields,CASE WHEN p_draft THEN d.sort ELSE v.sort END AS policy INTO source FROM public.collections c JOIN public.collection_schema_versions v
  ON v.id=CASE WHEN p_draft THEN COALESCE(c.published_schema_version_id,c.draft_schema_version_id) ELSE c.published_schema_version_id END AND v.collection_id=c.id
  LEFT JOIN public.collection_schema_versions d ON d.id=c.draft_schema_version_id AND d.collection_id=c.id
  WHERE c.site_id=p_site AND c.reader_key=p_reader;
 IF source.id IS NULL THEN RAISE EXCEPTION 'list is unavailable on this site' USING ERRCODE='CMS04';END IF;
 IF p_selection ? 'dateField' AND (jsonb_typeof(p_selection->'dateField') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.fields) f WHERE f->>'key'=date_field AND f->>'type'='date')) THEN
  RAISE EXCEPTION 'choose a published date field' USING ERRCODE='CMS04';END IF;
 IF p_selection ? 'maxAgeMonths' AND (date_field IS NULL OR jsonb_typeof(p_selection->'maxAgeMonths') IS DISTINCT FROM 'number' OR COALESCE(p_selection->>'maxAgeMonths','') !~ '^(120|1[01][0-9]|[1-9][0-9]?)$') THEN
  RAISE EXCEPTION 'choose a month limit from1to120 and a date field' USING ERRCODE='CMS04';END IF;
 IF p_selection ? 'excludeStableKey' AND (jsonb_typeof(p_selection->'excludeStableKey') IS DISTINCT FROM 'string' OR char_length(p_selection->>'excludeStableKey')>80 OR p_selection->>'excludeStableKey' !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') THEN
  RAISE EXCEPTION 'choose a valid related story' USING ERRCODE='CMS04';END IF;
 IF p_selection ? 'filter' THEN
  IF jsonb_typeof(p_selection->'filter') IS DISTINCT FROM 'object' OR ((p_selection->'filter')-ARRAY['field','value'])<>'{}'::jsonb OR NOT((p_selection->'filter') ?& ARRAY['field','value'])
   OR jsonb_typeof(p_selection#>'{filter,field}') IS DISTINCT FROM 'string' OR jsonb_typeof(p_selection#>'{filter,value}') IS DISTINCT FROM 'string' OR char_length(btrim(p_selection#>>'{filter,value}')) NOT BETWEEN 1 AND 120 THEN
   RAISE EXCEPTION 'choose a tag or category value' USING ERRCODE='CMS04';END IF;
  SELECT f INTO field_spec FROM jsonb_array_elements(source.fields) f WHERE f->>'key'=p_selection#>>'{filter,field}' AND (f->>'type'='select' OR (f->>'type'='text' AND f->>'key' IN ('tag','tags','category','categories')));
  IF field_spec IS NULL THEN RAISE EXCEPTION 'this list has no matching tag or category field' USING ERRCODE='CMS04';END IF;
 END IF;
 IF p_selection ? 'storyTags' THEN
  IF p_reader<>'stories' THEN RAISE EXCEPTION 'tag groups belong to Stories sections' USING ERRCODE='CMS04';END IF;
  tag_filter:=p_selection->'storyTags';
  IF jsonb_typeof(tag_filter) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'choose main and secondary tags' USING ERRCODE='CMS04';END IF;
  IF (tag_filter-ARRAY['main','secondary'])<>'{}'::jsonb OR NOT(tag_filter ?& ARRAY['main','secondary']) THEN
   RAISE EXCEPTION 'choose main and secondary tags' USING ERRCODE='CMS04';END IF;
  FOREACH tag_group IN ARRAY ARRAY['main','secondary'] LOOP
   IF jsonb_typeof(tag_filter->tag_group) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'choose tags from the list' USING ERRCODE='CMS04';END IF;
   IF jsonb_array_length(tag_filter->tag_group)>100 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(tag_filter->tag_group))<>jsonb_array_length(tag_filter->tag_group)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(tag_filter->tag_group) tag WHERE jsonb_typeof(tag) IS DISTINCT FROM 'string' OR char_length(tag#>>'{}')>80 OR (tag#>>'{}') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') THEN
    RAISE EXCEPTION 'choose each valid tag once, up to 100 per group' USING ERRCODE='CMS04';END IF;
  END LOOP;
 END IF;
 SELECT COALESCE(jsonb_agg(chosen.stable_key ORDER BY chosen.position),'[]'::jsonb) INTO keys FROM (
  SELECT e.stable_key,row_number() OVER(ORDER BY CASE WHEN date_field IS NOT NULL THEN v.values->>date_field END DESC NULLS LAST,
   CASE WHEN date_field IS NULL AND p_selection->>'order'='newest' THEN e.created_at END DESC,
   CASE WHEN date_field IS NOT NULL OR p_selection->>'order' IS DISTINCT FROM 'newest' THEN CASE WHEN p_draft THEN e.sort_index ELSE e.published_sort_index END END,e.id DESC) AS position
  FROM public.collection_entries e JOIN public.collection_entry_versions v ON v.id=CASE WHEN p_draft THEN e.draft_version_id ELSE e.published_version_id END AND v.entry_id=e.id
  WHERE e.collection_id=source.id AND CASE WHEN p_draft THEN e.archived_at ELSE e.published_archived_at END IS NULL
   AND (p_reader<>'stories' OR (v.values->'hidden' IS DISTINCT FROM 'true'::jsonb
    AND v.values->'feed_removed' IS DISTINCT FROM 'true'::jsonb AND v.values->'in_feed' IS DISTINCT FROM 'false'::jsonb
    AND (COALESCE(source.policy#>'{stories,publishUnreviewed}','true'::jsonb)='true'::jsonb OR v.values->'reviewed'='true'::jsonb)))
   AND (NOT(p_selection ? 'filter') OR EXISTS(SELECT 1 FROM regexp_split_to_table(COALESCE(v.values->>(p_selection#>>'{filter,field}'),''),CASE WHEN field_spec->>'key' IN ('tag','tags') THEN ',' ELSE chr(1) END) tag WHERE lower(btrim(tag))=lower(btrim(p_selection#>>'{filter,value}'))))
   AND (NOT(p_selection ? 'maxAgeMonths') OR COALESCE(v.values->>date_field,'')>=((CASE WHEN p_reader='stories' THEN (current_timestamp AT TIME ZONE 'UTC')::date ELSE current_date END)-make_interval(months=>(p_selection->>'maxAgeMonths')::int))::date::text)
   AND (NOT(p_selection ? 'storyTags') OR (
    (jsonb_array_length(tag_filter->'main')=0 OR EXISTS(SELECT 1 FROM regexp_split_to_table(COALESCE(v.values->>'tags',''),',') tag WHERE btrim(tag) IN (SELECT jsonb_array_elements_text(tag_filter->'main'))))
    AND (jsonb_array_length(tag_filter->'secondary')=0 OR EXISTS(SELECT 1 FROM regexp_split_to_table(COALESCE(NULLIF(btrim(v.values->>'regions'),''),v.values->>'region',''),',') tag WHERE btrim(tag) IN (SELECT jsonb_array_elements_text(tag_filter->'secondary'))))))
   AND (p_reader<>'stories' OR COALESCE(v.values->>'published_date','')<=(current_timestamp AT TIME ZONE 'UTC')::date::text)
   AND (NOT(p_selection ? 'excludeStableKey') OR e.stable_key<>p_selection->>'excludeStableKey')
  ORDER BY position LIMIT (p_selection->>'limit')::int
 ) chosen;
 RETURN jsonb_build_object('mode','manual','stableKeys',keys);
END $$;
REVOKE ALL ON FUNCTION app.normalize_list_selection(uuid,text,jsonb,boolean) FROM PUBLIC;
ALTER FUNCTION app.normalize_list_selection(uuid,text,jsonb,boolean) OWNER TO cms_migration_owner;

-- Only a canonical, registered Story article is suppressed. An ordinary page
-- containing a Story placement remains a page; that placement is filtered above.
CREATE FUNCTION app.story_article_visible(p_site uuid,p_version uuid,p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM public.page_versions pv
  JOIN public.section_defs d ON d.id=(pv.content#>>'{0,section_def_id}')::uuid
  JOIN public.collections c ON c.site_id=p_site AND c.reader_key='stories'
  JOIN public.collection_entries e ON e.collection_id=c.id
   AND e.stable_key=pv.content#>>'{0,values,story,selection,stableKeys,0}'
  JOIN public.collection_entry_versions v ON v.id=e.published_version_id AND v.entry_id=e.id
  WHERE pv.id=p_version AND pv.site_id=p_site AND d.slug='core-story-detail'
   AND pv.content#>>'{0,values,story,readerKey}'='stories'
   AND pv.content#>>'{0,values,story,selection,mode}'='manual'
   AND CASE WHEN jsonb_typeof(pv.content#>'{0,values,story,selection,stableKeys}')='array' THEN jsonb_array_length(pv.content#>'{0,values,story,selection,stableKeys}') ELSE 0 END=1
   AND v.values->>'story_url'=p_path AND NOT app.story_visible(v.values)
 )
$$;
ALTER FUNCTION app.story_article_visible(uuid,uuid,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.story_article_visible(uuid,uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE OR REPLACE FUNCTION public_api.resolve_route(p_host text,p_path text)
RETURNS TABLE(site_id uuid,path text,page_id uuid,page_version_id uuid,render_manifest jsonb,shell_revision bigint,shell_payload jsonb,is_staging boolean,canonical_host text,redirect_to text,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.site_id,r.path,r.page_id,r.page_version_id,r.render_manifest,
 sh.revision,sh.payload,h.is_staging,h.canonical_host,h.redirect_to,r.updated_at
 FROM public_api.resolve_host(p_host) h
 JOIN public.published_routes r ON r.site_id=h.site_id AND r.path=p_path
 LEFT JOIN public.published_site_shells sh ON sh.site_id=h.site_id
 WHERE app.story_article_visible(r.site_id,r.page_version_id,r.path)
$$;
CREATE OR REPLACE FUNCTION public_api.site_routes(p_host text)
RETURNS TABLE(page_id uuid,path text,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT r.page_id,r.path,r.updated_at FROM public_api.resolve_host(p_host) h
 JOIN public.published_routes r ON r.site_id=h.site_id
 WHERE app.story_article_visible(r.site_id,r.page_version_id,r.path) ORDER BY r.path
$$;
