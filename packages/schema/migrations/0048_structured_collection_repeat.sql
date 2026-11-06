-- 0048 — structured schema v3: bounded collection-backed repeat nodes.

ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb)
  RENAME TO structured_node_defect_v2_0048;
ALTER FUNCTION app.structured_shape_defect(jsonb)
  RENAME TO structured_shape_defect_v2_0048;
ALTER FUNCTION app.structured_section_defect(text,jsonb,int)
  RENAME TO structured_section_defect_v2_0048;

CREATE OR REPLACE FUNCTION app.current_structured_schema_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 3 $$;

CREATE FUNCTION app.structured_node_defect(p_node jsonb, p_depth int, p_fields jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node_type text; declared text; stray text; child jsonb; defect text;
        empty_value jsonb;
BEGIN
  IF p_depth > 16 THEN RETURN 'nests deeper than 16 levels'; END IF;
  IF COALESCE(jsonb_typeof(p_node),'missing') <> 'object' THEN RETURN 'has a node that is not an object'; END IF;
  node_type := p_node->>'type';

  IF node_type = 'repeat' THEN
    IF p_fields IS NULL THEN RETURN 'contains a nested repeat, which schema version 3 does not define'; END IF;
    SELECT key INTO stray FROM jsonb_object_keys(p_node) key
     WHERE key NOT IN ('type','field','item','empty') LIMIT 1;
    IF stray IS NOT NULL THEN RETURN format('has a repeat node carrying %s, which schema version 3 does not define',stray); END IF;
    IF NOT app.is_slot_id(p_node->>'field') THEN RETURN 'has a repeat node whose field name is not usable'; END IF;
    declared := p_fields->>(p_node->>'field');
    IF declared IS NULL THEN RETURN format('uses field %s, which it never declares',p_node->>'field'); END IF;
    IF declared <> 'repeat' THEN RETURN format('uses field %s as repeat but declares it as %s',p_node->>'field',declared); END IF;
    IF COALESCE(jsonb_typeof(p_node->'item'),'missing') <> 'array'
       OR jsonb_array_length(p_node->'item') < 1 OR jsonb_array_length(p_node->'item') > 512 THEN
      RETURN 'a repeat item must contain between 1 and 512 typed nodes';
    END IF;
    empty_value := p_node->'empty';
    IF COALESCE(jsonb_typeof(empty_value),'missing') <> 'object' THEN RETURN 'a repeat must state its empty behavior'; END IF;
    IF empty_value->>'behavior' = 'hide' THEN
      IF (empty_value-ARRAY['behavior']) <> '{}'::jsonb OR NOT(empty_value ? 'behavior') THEN
        RETURN 'a hidden empty repeat contains unknown properties';
      END IF;
    ELSIF empty_value->>'behavior' = 'message' THEN
      IF (empty_value-ARRAY['behavior','text']) <> '{}'::jsonb
         OR NOT(empty_value ?& ARRAY['behavior','text'])
         OR jsonb_typeof(empty_value->'text') <> 'string'
         OR char_length(empty_value->>'text') NOT BETWEEN 1 AND 200 THEN
        RETURN 'an empty repeat message must contain between 1 and 200 characters';
      END IF;
    ELSE RETURN 'a repeat empty behavior must be hide or message';
    END IF;
    FOR child IN SELECT value FROM jsonb_array_elements(p_node->'item') LOOP
      defect := app.structured_node_defect(child,p_depth+1,NULL);
      IF defect IS NOT NULL THEN RETURN defect; END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  -- Inside an item subtree the collection schema, not the page field list,
  -- supplies declarations. The existing v2 validator still owns every node
  -- grammar; give it the one local declaration needed to validate this leaf.
  IF p_fields IS NULL AND node_type IN ('text','richtext','link','image') THEN
    RETURN app.structured_node_defect_v2_0048(
      p_node,p_depth,jsonb_build_object(p_node->>'field',node_type));
  END IF;
  RETURN app.structured_node_defect_v2_0048(p_node,p_depth,p_fields);
END
$$;

CREATE FUNCTION app.structured_shape_defect(p_doc jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node_count int; max_depth int; max_children int; max_attributes int;
        conflict boolean; long_attribute boolean; wide_tokens boolean;
        field_count int; long_label boolean;
BEGIN
  IF COALESCE(jsonb_typeof(p_doc->'nodes'),'missing') <> 'array' THEN RETURN NULL; END IF;
  IF COALESCE(jsonb_typeof(p_doc->'fields'),'missing') = 'array' THEN
    SELECT count(*),bool_or(char_length(COALESCE(value->>'label',''))>256)
      INTO field_count,long_label FROM jsonb_array_elements(p_doc->'fields');
    IF field_count>256 THEN RETURN format('declares %s fields, more than the 256 a section may have',field_count); END IF;
    IF long_label THEN RETURN 'has a field label longer than 256 characters'; END IF;
  END IF;
  IF jsonb_array_length(p_doc->'nodes')>2000 THEN RETURN 'has more than 2000 nodes'; END IF;

  WITH RECURSIVE walk(node,depth) AS (
    SELECT value,1 FROM jsonb_array_elements(p_doc->'nodes')
    UNION ALL
    SELECT child.value,walk.depth+1 FROM walk
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN walk.node->>'type'='repeat' AND jsonb_typeof(walk.node->'item')='array' THEN walk.node->'item'
        WHEN walk.node->>'type'<>'repeat' AND jsonb_typeof(walk.node->'children')='array' THEN walk.node->'children'
        ELSE '[]'::jsonb
      END) child
    WHERE walk.depth<64
  ), bounded AS (SELECT * FROM walk LIMIT 2001)
  SELECT count(*),max(depth),
    max(CASE WHEN node->>'type'='repeat' AND jsonb_typeof(node->'item')='array' THEN jsonb_array_length(node->'item')
             WHEN node->>'type'<>'repeat' AND jsonb_typeof(node->'children')='array' THEN jsonb_array_length(node->'children') ELSE 0 END),
    max(greatest(
      CASE WHEN jsonb_typeof(node->'attributes')='object' THEN (SELECT count(*) FROM jsonb_object_keys(node->'attributes')) ELSE 0 END,
      CASE WHEN jsonb_typeof(node->'staticAttributes')='object' THEN (SELECT count(*) FROM jsonb_object_keys(node->'staticAttributes')) ELSE 0 END)),
    bool_or((node->>'type'='repeat' AND node ? 'children') OR (node->>'type'<>'repeat' AND node ? 'item')),
    bool_or((jsonb_typeof(node->'attributes')='object' AND EXISTS(
      SELECT 1 FROM jsonb_each_text(node->'attributes') a(k,v) WHERE char_length(k)+char_length(v)>512))
      OR (jsonb_typeof(node->'staticAttributes')='object' AND EXISTS(
        SELECT 1 FROM jsonb_each(node->'staticAttributes') a(k,v) WHERE char_length(k)+CASE
          WHEN jsonb_typeof(v)='array' THEN COALESCE((SELECT sum(char_length(t #>> '{}'))+greatest(jsonb_array_length(v)-1,0) FROM jsonb_array_elements(v)t),0)
          ELSE char_length(COALESCE(v #>> '{}','')) END>512))),
    bool_or(jsonb_typeof(node->'staticAttributes')='object' AND EXISTS(
      SELECT 1 FROM jsonb_each(node->'staticAttributes') a(k,v)
       WHERE CASE WHEN jsonb_typeof(v)='array' THEN jsonb_array_length(v)>32 ELSE false END))
  INTO node_count,max_depth,max_children,max_attributes,conflict,long_attribute,wide_tokens
  FROM bounded;
  IF conflict THEN RETURN 'has a node carrying the child container of a different node type'; END IF;
  IF node_count>2000 THEN RETURN 'has more than 2000 nodes'; END IF;
  IF max_depth>16 THEN RETURN 'nests deeper than 16 levels'; END IF;
  IF max_children>512 THEN RETURN format('has an element with %s children, more than the 512 one element may have',max_children); END IF;
  IF max_attributes>64 THEN RETURN format('has an element carrying %s attributes, more than the 64 one element may carry',max_attributes); END IF;
  IF long_attribute THEN RETURN 'has an attribute longer than 512 characters'; END IF;
  IF wide_tokens THEN RETURN 'has an attribute of more than 32 tokens'; END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.structured_section_defect(p_kind text,p_doc jsonb,p_schema_version int)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE fields jsonb; field jsonb; node jsonb; defect text; stray text; declared_count int;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('legacy','structured') THEN RETURN 'does not name a supported section model'; END IF;
  IF p_kind='legacy' THEN
    IF p_doc IS NOT NULL AND COALESCE(jsonb_typeof(p_doc),'null')<>'null' THEN RETURN 'is marked legacy but carries a structured document'; END IF;
    IF p_schema_version IS NOT NULL THEN RETURN 'is marked legacy but names a structured schema version'; END IF;
    RETURN NULL;
  END IF;
  IF p_schema_version IS DISTINCT FROM 3 THEN RETURN format('was written against structured schema version %s, but this database requires version 3',COALESCE(p_schema_version::text,'null')); END IF;
  IF COALESCE(jsonb_typeof(p_doc),'missing')<>'object' THEN RETURN 'is not a structured document'; END IF;
  SELECT key INTO stray FROM jsonb_object_keys(p_doc) key WHERE key NOT IN ('schemaVersion','fields','nodes') LIMIT 1;
  IF stray IS NOT NULL THEN RETURN format('carries %s, which schema version 3 does not define',stray); END IF;
  IF jsonb_typeof(p_doc->'schemaVersion')<>'number' OR (p_doc->>'schemaVersion')::int<>3 THEN RETURN 'document and row structured schema versions disagree'; END IF;
  IF COALESCE(jsonb_typeof(p_doc->'fields'),'missing')<>'array' THEN RETURN 'has no field list'; END IF;
  IF COALESCE(jsonb_typeof(p_doc->'nodes'),'missing')<>'array' THEN RETURN 'has no node list'; END IF;
  defect:=app.structured_shape_defect(p_doc); IF defect IS NOT NULL THEN RETURN defect; END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(p_doc->'fields') LOOP
    IF jsonb_typeof(field)<>'object' THEN RETURN 'declares a field that is not an object'; END IF;
    SELECT key INTO stray FROM jsonb_object_keys(field) key WHERE key NOT IN ('name','type','label') LIMIT 1;
    IF stray IS NOT NULL THEN RETURN format('declares a field carrying %s',stray); END IF;
    IF NOT app.is_slot_id(field->>'name') THEN RETURN 'declares a field whose name is not usable'; END IF;
    IF COALESCE(field->>'type','') NOT IN ('text','richtext','link','image','repeat') THEN RETURN 'declares an unsupported field type'; END IF;
    IF COALESCE(field->>'label','')='' THEN RETURN 'declares a field with no label'; END IF;
  END LOOP;
  SELECT jsonb_object_agg(value->>'name',value->>'type'),count(DISTINCT value->>'name')
    INTO fields,declared_count FROM jsonb_array_elements(p_doc->'fields');
  fields:=COALESCE(fields,'{}'::jsonb);
  IF declared_count IS DISTINCT FROM jsonb_array_length(p_doc->'fields') THEN RETURN 'declares one field twice'; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(p_doc->'nodes') LOOP
    defect:=app.structured_node_defect(node,1,fields); IF defect IS NOT NULL THEN RETURN defect; END IF;
  END LOOP;
  RETURN NULL;
END
$$;

-- Schema v2 and v3 read every pre-existing node identically. Only the explicit
-- envelope version changes; no node, field, CSS artifact, or render hash does.
UPDATE public.section_def_versions
   SET structured_doc=jsonb_set(structured_doc,'{schemaVersion}','3'::jsonb,false),
       structured_schema_version=3
 WHERE definition_kind='structured' AND structured_schema_version=2
   AND structured_doc->'schemaVersion'='2'::jsonb;

CREATE FUNCTION app.collection_repeat_item_defect(p_item jsonb,p_fields jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE field_node record; collection_type text;
BEGIN
  WITH RECURSIVE walk(node) AS (
    SELECT value FROM jsonb_array_elements(p_item)
    UNION ALL
    SELECT child.value FROM walk
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN walk.node->>'type'='element' AND jsonb_typeof(walk.node->'children')='array'
           THEN walk.node->'children' ELSE '[]'::jsonb END) child
  )
  SELECT node->>'type' AS node_type,node->>'field' AS field_name INTO field_node
    FROM walk WHERE node->>'type'<>'element'
      AND (node->>'type'='repeat' OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f->>'key'=node->>'field'
          AND ((node->>'type'='text' AND f->>'type' IN ('text','number','date','boolean','select'))
            OR (node->>'type'='richtext' AND f->>'type'='richtext')
            OR (node->>'type'='image' AND f->>'type'='image'))))
    LIMIT 1;
  IF field_node.node_type='repeat' THEN RETURN 'a repeated item cannot contain another repeat'; END IF;
  IF field_node.field_name IS NOT NULL THEN
    SELECT f->>'type' INTO collection_type FROM jsonb_array_elements(p_fields) f
     WHERE f->>'key'=field_node.field_name;
    RETURN format('item field %s cannot render collection field type %s as %s',
      field_node.field_name,COALESCE(collection_type,'missing'),field_node.node_type);
  END IF;
  RETURN NULL;
END
$$;

CREATE FUNCTION app.resolve_collection_repeat(
  p_site_id uuid,p_reader_key text,p_selection jsonb,p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE collection_row record; selected jsonb; schemas jsonb; desired int;
        schema_row record; entry_value jsonb; defect text; limit_value int;
BEGIN
  IF p_reader_key IS NULL OR NOT(p_reader_key~'^[a-z][a-z0-9_]{0,63}$') THEN
    RAISE EXCEPTION 'a collection repeat has an invalid reader key' USING ERRCODE='CMS04';
  END IF;
  IF jsonb_typeof(p_selection)<>'object' THEN RAISE EXCEPTION 'a collection repeat has no selection' USING ERRCODE='CMS04'; END IF;
  SELECT collection.id,collection.reader_key,collection.published_schema_version_id,
         collection.published_entry_revision,schema.revision AS schema_revision,schema.fields
    INTO collection_row FROM public.collections collection
    JOIN public.collection_schema_versions schema
      ON schema.id=collection.published_schema_version_id AND schema.collection_id=collection.id
   WHERE collection.site_id=p_site_id AND collection.reader_key=p_reader_key;
  IF collection_row.id IS NULL THEN RAISE EXCEPTION 'collection binding is missing, private, or belongs to another site' USING ERRCODE='CMS04'; END IF;
  defect:=app.collection_repeat_item_defect(p_item,collection_row.fields);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'collection binding is incompatible: %',defect USING ERRCODE='CMS04'; END IF;

  IF p_selection->>'mode'='automatic' THEN
    IF (p_selection-ARRAY['mode','limit'])<>'{}'::jsonb OR NOT(p_selection ?& ARRAY['mode','limit'])
       OR jsonb_typeof(p_selection->'limit')<>'number'
       OR (p_selection->>'limit')::numeric<>trunc((p_selection->>'limit')::numeric)
       OR (p_selection->>'limit')::int NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'automatic collection selection needs only a limit from 1 to 100' USING ERRCODE='CMS04';
    END IF;
    limit_value:=(p_selection->>'limit')::int;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',chosen.id,'stableKey',chosen.stable_key,'schemaVersionId',chosen.schema_version_id,
      'values',chosen."values") ORDER BY chosen.published_sort_index),'[]'::jsonb)
      INTO selected FROM (
        SELECT entry.id,entry.stable_key,entry.published_sort_index,
               version.schema_version_id,version."values"
          FROM public.collection_entries entry
          JOIN public.collection_entry_versions version
            ON version.id=entry.published_version_id AND version.entry_id=entry.id
         WHERE entry.collection_id=collection_row.id AND entry.published_archived_at IS NULL
         ORDER BY entry.published_sort_index LIMIT limit_value) chosen;
  ELSIF p_selection->>'mode'='manual' THEN
    IF (p_selection-ARRAY['mode','stableKeys'])<>'{}'::jsonb OR NOT(p_selection ?& ARRAY['mode','stableKeys'])
       OR jsonb_typeof(p_selection->'stableKeys')<>'array'
       OR jsonb_array_length(p_selection->'stableKeys')>100
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selection->'stableKeys') value
                  WHERE jsonb_typeof(value)<>'string' OR char_length(value #>> '{}')>80
                    OR NOT(value #>> '{}'~'^[a-z0-9]+(?:-[a-z0-9]+)*$'))
       OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_selection->'stableKeys') value GROUP BY value HAVING count(*)>1) THEN
      RAISE EXCEPTION 'manual collection selection needs up to 100 unique stable keys' USING ERRCODE='CMS04';
    END IF;
    desired:=jsonb_array_length(p_selection->'stableKeys');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',entry.id,'stableKey',entry.stable_key,'schemaVersionId',version.schema_version_id,
      'values',version."values") ORDER BY wanted.ordinality),'[]'::jsonb)
      INTO selected
      FROM jsonb_array_elements_text(p_selection->'stableKeys') WITH ORDINALITY wanted(stable_key,ordinality)
      JOIN public.collection_entries entry ON entry.collection_id=collection_row.id
        AND entry.stable_key=wanted.stable_key AND entry.published_archived_at IS NULL
      JOIN public.collection_entry_versions version
        ON version.id=entry.published_version_id AND version.entry_id=entry.id;
    IF jsonb_array_length(selected)<>desired THEN RAISE EXCEPTION 'manual collection selection names an unpublished entry' USING ERRCODE='CMS04'; END IF;
  ELSE RAISE EXCEPTION 'collection selection mode is unsupported' USING ERRCODE='CMS04';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',schema.id,'revision',schema.revision::text,'fields',schema.fields)
                            ORDER BY schema.revision),'[]'::jsonb)
    INTO schemas FROM public.collection_schema_versions schema
   WHERE schema.id IN (SELECT DISTINCT (value->>'schemaVersionId')::uuid FROM jsonb_array_elements(selected));
  FOR schema_row IN SELECT value FROM jsonb_array_elements(schemas) LOOP
    defect:=app.collection_repeat_item_defect(p_item,schema_row.value->'fields');
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'collection entry schema is incompatible: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  FOR entry_value IN SELECT value FROM jsonb_array_elements(selected) LOOP
    SELECT app.collection_entry_values_defect(p_site_id,schema.fields,entry_value->'values') INTO defect
      FROM public.collection_schema_versions schema WHERE schema.id=(entry_value->>'schemaVersionId')::uuid;
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'published collection entry is invalid: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'kind','collection','collectionId',collection_row.id,'readerKey',collection_row.reader_key,
    'publishedSchemaVersionId',collection_row.published_schema_version_id,
    'publishedSchemaRevision',collection_row.schema_revision::text,
    'publishedEntryRevision',collection_row.published_entry_revision::text,
    'schemas',schemas,'entries',selected);
END
$$;

CREATE FUNCTION app.resolve_collection_repeat_values(
  p_site_id uuid,p_doc jsonb,p_values jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE result jsonb:=p_values; repeat_node jsonb; binding jsonb; field_name text;
BEGIN
  IF jsonb_typeof(result)<>'object' THEN RAISE EXCEPTION 'section values are not an object' USING ERRCODE='CMS04'; END IF;
  FOR repeat_node IN
    WITH RECURSIVE walk(node) AS (
      SELECT value FROM jsonb_array_elements(p_doc->'nodes')
      UNION ALL
      SELECT child.value FROM walk CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN walk.node->>'type'='element' AND jsonb_typeof(walk.node->'children')='array'
             THEN walk.node->'children' ELSE '[]'::jsonb END) child)
    SELECT node FROM walk WHERE node->>'type'='repeat'
  LOOP
    field_name:=repeat_node->>'field'; binding:=result->field_name;
    IF jsonb_typeof(binding)<>'object'
       OR (binding-ARRAY['readerKey','selection'])<>'{}'::jsonb
       OR NOT(binding ?& ARRAY['readerKey','selection'])
       OR jsonb_typeof(binding->'readerKey')<>'string' THEN
      RAISE EXCEPTION 'repeat field % has no valid collection binding',field_name USING ERRCODE='CMS04';
    END IF;
    result:=jsonb_set(result,ARRAY[field_name],app.resolve_collection_repeat(
      p_site_id,binding->>'readerKey',binding->'selection',repeat_node->'item'),false);
  END LOOP;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v record; sections jsonb; resolved_sections jsonb; expected int; resolved int; stale text;
BEGIN
  SELECT pv.id,pv.content,pv.meta,pv.page_id,pv.site_id,p.title,p.slug INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id=pv.page_id WHERE pv.id=p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE='CMS03'; END IF;
  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);
  SELECT jsonb_agg(jsonb_build_object(
    'def',jsonb_build_object('section_def_id',d.id,'version',dv.version,'slug',d.slug,
      'compiled_ast',dv.compiled_ast,'css',dv.compiled_css,'slots',dv.slots,'render_hash',dv.render_hash,
      'sanitizer_policy_version',dv.sanitizer_policy_version,'css_policy_version',dv.css_policy_version,
      'definition_kind',dv.definition_kind,'structured_doc',dv.structured_doc,
      'structured_schema_version',dv.structured_schema_version),
    'instance',jsonb_build_object('label',item.value->>'label',
      'hidden',COALESCE((item.value->>'hidden')::boolean,false),
      'hidden_at',COALESCE(item.value->'hidden_at','[]'::jsonb),
      'values',COALESCE(item.value->'values','{}'::jsonb),
      'custom_css',COALESCE(item.value->>'custom_css',''),'raw_html',COALESCE(item.value->>'raw_html','')))
    ORDER BY item.ordinality) INTO sections
   FROM jsonb_array_elements(v.content) WITH ORDINALITY item(value,ordinality)
   JOIN public.section_defs d ON d.id=(item.value->>'section_def_id')::uuid
   JOIN public.section_def_versions dv ON dv.section_def_id=d.id AND dv.version=(item.value->>'section_def_version')::int;
  resolved:=COALESCE(jsonb_array_length(sections),0);
  IF resolved<>expected THEN RAISE EXCEPTION 'page version refers to unresolved sections' USING ERRCODE='CMS04'; END IF;
  SELECT string_agg(DISTINCT (section->'def'->>'slug')||' ('||defect||')','; ') INTO stale
   FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) section
   CROSS JOIN LATERAL (SELECT COALESCE(
     app.structured_section_defect(section->'def'->>'definition_kind',section->'def'->'structured_doc',(section->'def'->>'structured_schema_version')::int),
     app.render_ast_defect(section->'def'->'compiled_ast',(section->'def'->>'sanitizer_policy_version')::int),
     app.compiled_css_defect(section->'def'->>'css',(section->'def'->>'css_policy_version')::int,'.cms-section--'||(section->'def'->>'slug'))) defect) check_result
   WHERE defect IS NOT NULL;
  IF stale IS NOT NULL THEN RAISE EXCEPTION 'this page uses a section that needs revalidating: %',stale USING ERRCODE='CMS04'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_set(section,ARRAY['instance','values'],
    CASE WHEN section->'def'->>'definition_kind'='structured' THEN app.resolve_collection_repeat_values(
      v.site_id,section->'def'->'structured_doc',section->'instance'->'values')
      ELSE section->'instance'->'values' END,false) ORDER BY ordinality),'[]'::jsonb)
    INTO resolved_sections FROM jsonb_array_elements(COALESCE(sections,'[]'::jsonb)) WITH ORDINALITY item(section,ordinality);
  IF NOT app.json_within(resolved_sections,1800000) THEN RAISE EXCEPTION 'resolved collection content makes this page manifest too large' USING ERRCODE='CMS04'; END IF;
  RETURN jsonb_build_object('page',jsonb_build_object('id',v.page_id,'version_id',v.id,'title',v.title,'path',app.page_path(v.slug)),
    'meta',COALESCE(v.meta,'{}'::jsonb),'sections',resolved_sections,
    'dependency_revision',md5(resolved_sections::text));
END
$$;

CREATE FUNCTION app.render_manifest_uses_collection(p_manifest jsonb,p_collection_id uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) section
    CROSS JOIN LATERAL jsonb_each(COALESCE(section->'instance'->'values','{}'::jsonb)) value
   WHERE value.value->>'kind'='collection' AND value.value->>'collectionId'=p_collection_id::text)
$$;

CREATE FUNCTION app.render_manifest_uses_collection_entry(
  p_manifest jsonb,p_collection_id uuid,p_entry_id uuid
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(
    SELECT 1
      FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) section
      CROSS JOIN LATERAL jsonb_each(COALESCE(section->'instance'->'values','{}'::jsonb)) value
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(value.value->'entries','[]'::jsonb)) entry
     WHERE value.value->>'kind'='collection'
       AND value.value->>'collectionId'=p_collection_id::text
       AND entry->>'id'=p_entry_id::text)
$$;

CREATE FUNCTION app.rebuild_collection_routes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.published_routes route
     SET render_manifest=app.build_render_manifest_internal(route.page_version_id),updated_at=clock_timestamp()
   WHERE route.site_id=NEW.site_id AND app.render_manifest_uses_collection(route.render_manifest,NEW.id);
  RETURN NEW;
END
$$;
CREATE TRIGGER collections_rebuild_dependent_routes
AFTER UPDATE OF published_schema_version_id,published_entry_revision ON public.collections
FOR EACH ROW WHEN (OLD.published_schema_version_id IS DISTINCT FROM NEW.published_schema_version_id
                OR OLD.published_entry_revision IS DISTINCT FROM NEW.published_entry_revision)
EXECUTE FUNCTION app.rebuild_collection_routes();

-- Collection commands in 0046 already emit one transactional publication
-- event. Decorate that event at insertion time with the exact dependent paths
-- after the collection update trigger above has rebuilt them. This keeps one
-- event per command, preserves the transactional outbox, and makes the event a
-- complete cache-invalidation contract instead of leaving the worker to query
-- mutable state later.
CREATE FUNCTION app.decorate_collection_publication_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE collection_id uuid; paths jsonb;
BEGIN
  IF NEW.event_type NOT IN ('collection.schema.published','collection.entries.published') THEN
    RETURN NEW;
  END IF;
  BEGIN collection_id := (NEW.payload->>'collection_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'collection publication event has no valid collection id' USING ERRCODE='CMS04';
  END;
  IF collection_id IS NULL THEN
    RAISE EXCEPTION 'collection publication event has no collection id' USING ERRCODE='CMS04';
  END IF;
  SELECT COALESCE(jsonb_agg(route.path ORDER BY route.path),'[]'::jsonb) INTO paths
    FROM public.published_routes route
   WHERE route.site_id=NEW.site_id
     AND app.render_manifest_uses_collection(route.render_manifest,collection_id);
  NEW.payload := NEW.payload || jsonb_build_object(
    'paths',paths,
    'revision',COALESCE(NEW.payload->'revision',NEW.payload->'entry_revision','0'::jsonb));
  RETURN NEW;
END
$$;
CREATE TRIGGER outbox_decorate_collection_publication
BEFORE INSERT ON public.outbox FOR EACH ROW
EXECUTE FUNCTION app.decorate_collection_publication_event();

-- A shared asset becomes public for a host only when the exact immutable entry
-- version using it is live and that collection is present in a published route.
CREATE OR REPLACE FUNCTION public_api.resolve_media(
  p_host text,p_media_id uuid,p_variant text
) RETURNS TABLE(media_id uuid,variant text,object_key text,mime_type text,
  bytes bigint,width integer,height integer,content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT media.id,p_variant,
    CASE WHEN p_variant='original' THEN media.object_key ELSE variant.object_key END,
    CASE WHEN p_variant='original' THEN media.mime_type ELSE variant.mime_type END,
    CASE WHEN p_variant='original' THEN media.bytes ELSE variant.bytes END,
    CASE WHEN p_variant='original' THEN media.width ELSE variant.width END,
    CASE WHEN p_variant='original' THEN media.height ELSE variant.height END,
    CASE WHEN p_variant='original' THEN media.content_hash ELSE variant.content_hash END
  FROM public_api.resolve_host(p_host) host
  JOIN public.media media ON media.site_id=host.site_id OR (media.site_id IS NULL AND (
    EXISTS(SELECT 1 FROM public.media_usage usage JOIN public.pages page
      ON page.id=usage.item_id AND usage.item_type='page'
      WHERE usage.media_id=media.id AND usage.site_id=host.site_id
        AND page.site_id=host.site_id AND page.archived_at IS NULL
        AND page.published_version_id=usage.version_id)
    OR EXISTS(SELECT 1 FROM public.global_elements element
      JOIN public.global_element_versions version ON version.id=element.published_version_id
      WHERE element.site_id=host.site_id AND element.kind='header'
        AND (version.content#>>'{brand,logoMediaId}'=media.id::text
          OR version.content#>>'{brand,compactLogoMediaId}'=media.id::text))
    OR EXISTS(SELECT 1 FROM public.media_usage usage
      JOIN public.collection_entries entry ON entry.id=usage.item_id
        AND usage.item_type='collection_entry' AND entry.published_version_id=usage.version_id
        AND entry.published_archived_at IS NULL
      JOIN public.collections collection ON collection.id=entry.collection_id
        AND collection.site_id=host.site_id
      WHERE usage.media_id=media.id AND usage.site_id=host.site_id
        AND EXISTS(SELECT 1 FROM public.published_routes route
          WHERE route.site_id=host.site_id
            AND app.render_manifest_uses_collection_entry(
              route.render_manifest,collection.id,entry.id)))
  ))
  LEFT JOIN public.media_variants variant
    ON variant.media_id=media.id AND variant.kind=p_variant AND p_variant<>'original'
  WHERE p_variant IN ('original','thumbnail','card','wide')
    AND media.id=p_media_id AND media.status='ready' AND media.deleted_at IS NULL
    AND (p_variant='original' OR variant.id IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION app.structured_node_defect_v2_0048(jsonb,int,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_shape_defect_v2_0048(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_section_defect_v2_0048(text,jsonb,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_node_defect(jsonb,int,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_shape_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_section_defect(text,jsonb,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.collection_repeat_item_defect(jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_collection_repeat_values(uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.render_manifest_uses_collection(jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.render_manifest_uses_collection_entry(jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.rebuild_collection_routes() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.decorate_collection_publication_event() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public_api.resolve_media(text,uuid,text)
  TO cms_public_renderer,cms_authenticated_user;

ALTER FUNCTION app.current_structured_schema_version() OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_node_defect_v2_0048(jsonb,int,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_shape_defect_v2_0048(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_section_defect_v2_0048(text,jsonb,int) OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_shape_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.structured_section_defect(text,jsonb,int) OWNER TO cms_migration_owner;
ALTER FUNCTION app.collection_repeat_item_defect(jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.resolve_collection_repeat(uuid,text,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.resolve_collection_repeat_values(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_internal(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.render_manifest_uses_collection(jsonb,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.render_manifest_uses_collection_entry(jsonb,uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.rebuild_collection_routes() OWNER TO cms_migration_owner;
ALTER FUNCTION app.decorate_collection_publication_event() OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_media(text,uuid,text) OWNER TO cms_migration_owner;
