-- Full managed Story widget sources use the existing2,000-record library bound.
-- Authored repeat selections and all other readers retain their200-row contract.
CREATE OR REPLACE FUNCTION app.normalize_list_selection_bounded(p_site uuid,p_reader text,p_selection jsonb,p_draft boolean,p_max integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source record;field_spec jsonb;keys jsonb;tag_group text;tag_filter jsonb;date_field text:=p_selection->>'dateField';
BEGIN
 IF p_max IS NULL OR p_max NOT IN (200,2000) OR (p_max=2000 AND p_reader IS DISTINCT FROM 'stories') THEN RAISE EXCEPTION 'invalid source bound' USING ERRCODE='CMS04';END IF;
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
  OR jsonb_typeof(p_selection->'limit') IS DISTINCT FROM 'number' OR (COALESCE(p_selection->>'limit','') !~ '^[1-9][0-9]{0,3}$' OR (p_selection->>'limit')::int>p_max)
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

ALTER FUNCTION app.normalize_list_selection_bounded(uuid,text,jsonb,boolean,integer) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.normalize_list_selection_bounded(uuid,text,jsonb,boolean,integer) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE OR REPLACE FUNCTION app.normalize_list_selection(p_site uuid,p_reader text,p_selection jsonb,p_draft boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.normalize_list_selection_bounded(p_site,p_reader,p_selection,p_draft,200)
$$;
CREATE FUNCTION app.full_story_widget_source(p_site uuid,p_selection jsonb,p_base jsonb,p_initial boolean,p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head record;draft boolean;selected jsonb;row record;projected jsonb;entries jsonb:='[]';schemas jsonb;defect text;
 keep text[]:=ARRAY['title','summary','published_date','tags','regions','region','region_label','countries','photo','photo_note','sector_links','story_url','reviewed','hidden','feed_removed','in_feed','photo_is_sample','body_is_sample'];
BEGIN
 IF p_base->>'readerKey' IS DISTINCT FROM 'stories' OR p_selection->>'mode' IS DISTINCT FROM 'automatic' THEN RETURN p_base;END IF;
 SELECT c.id,c.published_schema_version_id INTO head FROM public.collections c WHERE c.id=(p_base->>'collectionId')::uuid AND c.site_id=p_site AND c.reader_key='stories';
 IF head.id IS NULL THEN RAISE EXCEPTION 'Story source is unavailable' USING ERRCODE='CMS04';END IF;
 draft:=p_initial AND head.published_schema_version_id IS NULL;
 selected:=app.normalize_list_selection_bounded(p_site,'stories',p_selection||'{"limit":2000}'::jsonb,draft,2000);
 FOR row IN SELECT e.id,e.stable_key,v.schema_version_id,v.values,s.fields FROM jsonb_array_elements_text(selected->'stableKeys') WITH ORDINALITY wanted(key,position)
  JOIN public.collection_entries e ON e.collection_id=head.id AND e.stable_key=wanted.key
  JOIN public.collection_entry_versions v ON v.id=CASE WHEN draft THEN e.draft_version_id ELSE e.published_version_id END AND v.entry_id=e.id
  JOIN public.collection_schema_versions s ON s.id=v.schema_version_id AND s.collection_id=head.id ORDER BY wanted.position LOOP
  defect:=app.collection_repeat_item_defect(p_item,row.fields);
  IF defect IS NULL THEN defect:=app.collection_entry_values_defect(p_site,row.fields,row.values);END IF;
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'Story source needs review: %',defect USING ERRCODE='CMS04';END IF;

 END LOOP;
 -- Aggregate once after validation, avoiding repeated growing JSON copies.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'stableKey',e.stable_key,'schemaVersionId',v.schema_version_id,'values',projection.value) ORDER BY wanted.position),'[]'::jsonb) INTO entries
 FROM jsonb_array_elements_text(selected->'stableKeys') WITH ORDINALITY wanted(key,position)
 JOIN public.collection_entries e ON e.collection_id=head.id AND e.stable_key=wanted.key
 JOIN public.collection_entry_versions v ON v.id=CASE WHEN draft THEN e.draft_version_id ELSE e.published_version_id END AND v.entry_id=e.id
 JOIN public.collection_schema_versions schema ON schema.id=v.schema_version_id AND schema.collection_id=head.id
 CROSS JOIN LATERAL(SELECT COALESCE(jsonb_object_agg(k,datum),'{}'::jsonb) AS value FROM jsonb_each(v.values) field(k,datum)
  WHERE k=ANY(keep) OR EXISTS(SELECT 1 FROM jsonb_array_elements(schema.fields) f WHERE f->>'key'=k AND f->'required'='true'::jsonb)) projection;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'revision',s.revision::text,'fields',s.fields) ORDER BY s.revision),'[]'::jsonb) INTO schemas
 FROM public.collection_schema_versions s WHERE s.collection_id=head.id AND s.id IN(SELECT (e->>'schemaVersionId')::uuid FROM jsonb_array_elements(entries) e);
 RETURN p_base||jsonb_build_object('entries',entries,'schemas',schemas);
END $$;
ALTER FUNCTION app.full_story_widget_source(uuid,jsonb,jsonb,boolean,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.full_story_widget_source(uuid,jsonb,jsonb,boolean,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE FUNCTION app.expand_story_widget_values(p_site uuid,p_section jsonb,p_values jsonb,p_initial boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE slot jsonb;descriptor jsonb;field_name text;expected text;binding jsonb;
BEGIN
 expected:=CASE p_section#>>'{def,slug}' WHEN 'core-story-world' THEN 'world' WHEN 'core-story-split' THEN 'split' END;
 IF expected IS NULL THEN RETURN p_values;END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(p_section#>'{def,slots}') WHERE value->>'kind'='repeat' AND value#>>'{constraints,storyWidget}'=expected LOOP
  field_name:=slot->>'id';binding:=p_section#>ARRAY['instance','values',field_name];
  IF binding->>'readerKey' IS DISTINCT FROM 'stories' OR binding#>>'{selection,mode}' IS DISTINCT FROM 'automatic' THEN CONTINUE;END IF;
  SELECT value INTO descriptor FROM jsonb_array_elements(app.legacy_collection_repeat_descriptors(p_section->'def')) WHERE value->>'field'=field_name;
  IF descriptor IS NULL THEN RAISE EXCEPTION 'Story widget needs a valid item layout' USING ERRCODE='CMS04';END IF;
  p_values:=jsonb_set(p_values,ARRAY[field_name],app.full_story_widget_source(p_site,binding->'selection',p_values->field_name,p_initial,descriptor->'item'));
 END LOOP;
 RETURN p_values;
END $$;
ALTER FUNCTION app.expand_story_widget_values(uuid,jsonb,jsonb,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.expand_story_widget_values(uuid,jsonb,jsonb,boolean) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
DO $$ DECLARE definition text;old text;new text;BEGIN
 definition:=pg_get_functiondef('app.build_render_manifest_core(uuid,boolean,boolean)'::regprocedure);
 old:='section:=jsonb_set(section,''{instance,values}'',resolved_values);';
 new:='resolved_values:=app.expand_story_widget_values(site,section,resolved_values,p_initial_preview); '||old;
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Story source projection hook is unavailable';END IF;
 EXECUTE replace(definition,old,new);
 definition:=pg_get_functiondef('app.template_collection_binding_shape_valid_before_story_catalog(jsonb)'::regprocedure);
 old:='jsonb_array_length(binding->''schemas'')>200 OR jsonb_array_length(binding->''entries'')>200';
 new:='jsonb_array_length(binding->''schemas'')>(CASE WHEN binding->>''readerKey''=''stories'' THEN 2000 ELSE 200 END) OR jsonb_array_length(binding->''entries'')>(CASE WHEN binding->>''readerKey''=''stories'' THEN 2000 ELSE 200 END)';
 IF position(old IN definition)=0 THEN RAISE EXCEPTION 'Story source envelope bound hook is unavailable';END IF;
 EXECUTE replace(definition,old,new);
END $$;
