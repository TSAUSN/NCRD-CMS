-- Native Lists fill only explicitly declared, sanitized legacy repeat bodies.
-- No interpolation grammar, raw HTML field or script permission is added.
CREATE OR REPLACE FUNCTION app.legacy_collection_repeat_descriptors(p_component jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE slot jsonb;spec jsonb;field jsonb;node jsonb;body jsonb;items jsonb;result jsonb:='[]';
 opened boolean;closed boolean;field_id text;seen text[];
BEGIN
 IF COALESCE(p_component->>'definition_kind','legacy')<>'legacy' THEN RETURN result;END IF;
 IF jsonb_typeof(p_component->'slots') IS DISTINCT FROM 'array' THEN RETURN result;END IF;
 FOR slot IN SELECT value FROM jsonb_array_elements(p_component->'slots') WHERE value->>'kind'='repeat' AND value#>'{constraints,collection}'='true'::jsonb LOOP
  spec:=slot#>'{constraints,item}';field_id:=slot->>'id';
  IF NOT app.is_slot_id(field_id) OR position('__' in field_id)>0
    OR jsonb_typeof(spec->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(spec->'fields') NOT BETWEEN 1 AND 32
    OR jsonb_typeof(p_component#>'{compiled_ast,nodes}') IS DISTINCT FROM 'array' THEN RETURN NULL;END IF;
  seen:='{}';
  FOR field IN SELECT value FROM jsonb_array_elements(spec->'fields') LOOP
   IF jsonb_typeof(field)<>'object' OR NOT app.is_slot_id(field->>'id') OR position('__' in field->>'id')>0
     OR length(field_id)+length(field->>'id')+12>64 OR COALESCE(field->>'kind','') NOT IN ('text','richtext','image','link')
     OR field->>'id'=ANY(seen) THEN RETURN NULL;END IF;
   seen:=array_append(seen,field->>'id');
  END LOOP;
  opened:=false;closed:=false;body:='[]';items:='[]';seen:='{}';
  FOR node IN SELECT value FROM jsonb_array_elements(p_component#>'{compiled_ast,nodes}') LOOP
   IF NOT opened THEN
    IF node->>'kind'='slot' AND node->>'slotKind'='repeat' AND node->>'marker'='start' AND node->>'slotId'=field_id THEN opened:=true;END IF;
    CONTINUE;
   END IF;
   IF node ? 'marker' THEN
    IF node->>'marker'<>'end' OR node->>'slotId'<>field_id THEN RETURN NULL;END IF;
    closed:=true;EXIT;
   END IF;
   body:=body||jsonb_build_array(node);
   IF node->>'kind'='slot' THEN
    SELECT value INTO field FROM jsonb_array_elements(spec->'fields') WHERE value->>'id'=node->>'slotId';
    IF field IS NULL OR field->>'kind' IS DISTINCT FROM node->>'slotKind' THEN RETURN NULL;END IF;
    IF NOT(field->>'id'=ANY(seen)) THEN items:=items||jsonb_build_array(jsonb_build_object('type',field->>'kind','field',field->>'id'));seen:=array_append(seen,field->>'id');END IF;
   END IF;
  END LOOP;
  IF NOT opened OR NOT closed OR jsonb_array_length(items)=0 OR jsonb_array_length(items)<>jsonb_array_length(spec->'fields') THEN RETURN NULL;END IF;
  result:=result||jsonb_build_array(jsonb_build_object('type','repeat','field',field_id,'item',items,'empty',jsonb_build_object('behavior','hide'),
   'body',jsonb_set(p_component->'compiled_ast','{nodes}',body),'slots',spec->'fields'));
 END LOOP;
 RETURN result;
END $$;

DO $$ BEGIN
 IF to_regprocedure('app.build_render_manifest_core_before_template_lists(uuid,boolean,boolean)') IS NULL THEN
  ALTER FUNCTION app.build_render_manifest_core(uuid,boolean,boolean) RENAME TO build_render_manifest_core_before_template_lists;
 END IF;
 IF to_regprocedure('app.page_component_uses_url_pattern_before_template_lists(jsonb,jsonb,text)') IS NULL THEN
  ALTER FUNCTION app.page_component_uses_url_pattern(jsonb,jsonb,text) RENAME TO page_component_uses_url_pattern_before_template_lists;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION app.build_render_manifest_core(p_page_version_id uuid,p_initial_preview boolean,p_editor_preview boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE manifest jsonb;sections jsonb:='[]';section jsonb;descriptors jsonb;doc jsonb;resolved_values jsonb;site uuid;
BEGIN
 manifest:=app.build_render_manifest_core_before_template_lists(p_page_version_id,p_initial_preview,p_editor_preview);
 SELECT site_id INTO site FROM public.page_versions WHERE id=p_page_version_id;
 FOR section IN SELECT value FROM jsonb_array_elements(manifest->'sections') LOOP
  descriptors:=app.legacy_collection_repeat_descriptors(section->'def');
  IF descriptors IS NULL THEN RAISE EXCEPTION 'This section needs a valid list item layout.' USING ERRCODE='CMS04';END IF;
  IF jsonb_array_length(descriptors)>0 THEN
   SELECT jsonb_build_object('nodes',jsonb_agg(item-ARRAY['body','slots'])) INTO doc FROM jsonb_array_elements(descriptors) item;
   IF p_editor_preview THEN resolved_values:=app.resolve_editor_preview_repeat_values(site,doc,section#>'{instance,values}',p_initial_preview);
   ELSIF p_initial_preview THEN resolved_values:=app.resolve_initial_preview_repeat_values(site,doc,section#>'{instance,values}');
   ELSE resolved_values:=app.resolve_collection_repeat_values(site,doc,section#>'{instance,values}');END IF;
   section:=jsonb_set(section,'{instance,values}',resolved_values);
  END IF;
  sections:=sections||jsonb_build_array(section);
 END LOOP;
 IF NOT app.json_within(sections,1800000) THEN RAISE EXCEPTION 'The list preview is too large. Show fewer items in this section.' USING ERRCODE='CMS04';END IF;
 RETURN jsonb_set(manifest,'{sections}',sections)||jsonb_build_object('dependency_revision',md5(sections::text));
END $$;
CREATE OR REPLACE FUNCTION app.build_render_manifest_core(p_page_version_id uuid,p_initial_preview boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT app.build_render_manifest_core(p_page_version_id,p_initial_preview,false) $$;

-- Mirror the renderer's closed resolved envelope before granting any item
-- resource. Reuse the existing value parser for shape; mask only canonical
-- native image addresses in that temporary copy. Ownership is still enforced
-- by the native resolver and delivery, not by this JSON-only shape predicate.
CREATE OR REPLACE FUNCTION app.template_collection_binding_shape_valid(binding jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE schema jsonb;entry jsonb;fields jsonb;field jsonb;candidate jsonb;title_key text;
 ids text[]:='{}';entry_ids text[]:='{}';keys text[]:='{}';
 uuid_pattern text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
BEGIN
 IF jsonb_typeof(binding) IS DISTINCT FROM 'object' OR binding-ARRAY['kind','collectionId','readerKey','publishedSchemaVersionId','publishedSchemaRevision','publishedEntryRevision','schemas','entries']<>'{}'::jsonb
  OR NOT(binding ?& ARRAY['kind','collectionId','readerKey','publishedSchemaVersionId','publishedSchemaRevision','publishedEntryRevision','schemas','entries'])
  OR binding->>'kind' IS DISTINCT FROM 'collection' OR COALESCE(binding->>'collectionId','')!~uuid_pattern
  OR COALESCE(binding->>'publishedSchemaVersionId','')!~uuid_pattern OR COALESCE(binding->>'readerKey','')!~'^[a-z][a-z0-9_]{0,63}$'
  OR jsonb_typeof(binding->'publishedSchemaRevision') IS DISTINCT FROM 'string' OR COALESCE(binding->>'publishedSchemaRevision','')!~'^[0-9]+$'
  OR jsonb_typeof(binding->'publishedEntryRevision') IS DISTINCT FROM 'string' OR COALESCE(binding->>'publishedEntryRevision','')!~'^[0-9]+$'
  OR jsonb_typeof(binding->'schemas') IS DISTINCT FROM 'array' OR jsonb_typeof(binding->'entries') IS DISTINCT FROM 'array'
  OR jsonb_array_length(binding->'schemas')>200 OR jsonb_array_length(binding->'entries')>200 THEN RETURN false;END IF;
 FOR schema IN SELECT value FROM jsonb_array_elements(binding->'schemas') LOOP
  IF jsonb_typeof(schema)<>'object' OR schema-ARRAY['id','revision','fields']<>'{}'::jsonb OR NOT(schema ?& ARRAY['id','revision','fields'])
   OR COALESCE(schema->>'id','')!~uuid_pattern OR schema->>'id'=ANY(ids) OR jsonb_typeof(schema->'revision') IS DISTINCT FROM 'string'
   OR COALESCE(schema->>'revision','')!~'^[0-9]+$' OR jsonb_typeof(schema->'fields') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  ids:=array_append(ids,schema->>'id');
  SELECT value->>'key' INTO title_key FROM jsonb_array_elements(schema->'fields') WHERE value->>'type' IN ('text','richtext','date','select') LIMIT 1;
  IF title_key IS NULL OR app.collection_model_defect(schema->'fields',jsonb_build_object('schemaVersion',1,'titleField',title_key,'subtitleField',NULL,'imageField',NULL,'groupField',NULL)) IS NOT NULL THEN RETURN false;END IF;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(binding->'entries') LOOP
  IF jsonb_typeof(entry)<>'object' OR entry-ARRAY['id','stableKey','schemaVersionId','values']<>'{}'::jsonb OR NOT(entry ?& ARRAY['id','stableKey','schemaVersionId','values'])
   OR COALESCE(entry->>'id','')!~uuid_pattern OR entry->>'id'=ANY(entry_ids) OR COALESCE(entry->>'schemaVersionId','')!~uuid_pattern
   OR NOT(entry->>'schemaVersionId'=ANY(ids)) OR COALESCE(entry->>'stableKey','')!~'^[a-z0-9]+(-[a-z0-9]+)*$'
   OR jsonb_typeof(entry->'stableKey') IS DISTINCT FROM 'string' OR length(entry->>'stableKey')>80 OR entry->>'stableKey'=ANY(keys) OR jsonb_typeof(entry->'values') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  entry_ids:=array_append(entry_ids,entry->>'id');keys:=array_append(keys,entry->>'stableKey');
  SELECT value->'fields' INTO fields FROM jsonb_array_elements(binding->'schemas') WHERE value->>'id'=entry->>'schemaVersionId';
  candidate:=entry->'values';
  -- JavaScript counts UTF-16 units and refuses non-finite numbers. Keep the
  -- resource predicate in agreement even for a directly forged envelope.
  FOR field IN SELECT value FROM jsonb_array_elements(fields) LOOP
   IF field->>'type' IN ('text','richtext') AND jsonb_typeof(candidate->(field->>'key'))='string'
    AND char_length(candidate->>(field->>'key'))+char_length(regexp_replace(candidate->>(field->>'key'),U&'[\0001-\FFFF]','','g'))>20000 THEN RETURN false;END IF;
   IF field->>'type'='number' AND jsonb_typeof(candidate->(field->>'key'))='number'
    AND abs((candidate->>(field->>'key'))::numeric)>1.7976931348623157e308 THEN RETURN false;END IF;
  END LOOP;
  FOR field IN SELECT value FROM jsonb_array_elements(fields) WHERE value->>'type'='image' LOOP
   IF candidate#>>ARRAY[field->>'key','src'] ~ '^/media/[0-9a-fA-F-]{36}/(original|thumbnail|card|wide)$' THEN
    candidate:=jsonb_set(candidate,ARRAY[field->>'key','src'],'"/cms-template-shape/image"'::jsonb);
   END IF;
  END LOOP;
  IF app.collection_entry_values_defect(NULL,fields,candidate) IS NOT NULL THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- A declared field alone never grants media delivery. Inspect only each actual
-- item AST against its compatible, resolved entry values, just as it renders.
CREATE OR REPLACE FUNCTION app.page_component_uses_url_pattern(p_component jsonb,p_values jsonb,p_pattern text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE descriptors jsonb;item jsonb;binding jsonb;entry jsonb;fields jsonb;entry_values jsonb;ordinary_values jsonb:=p_values;field jsonb;
BEGIN
 descriptors:=app.legacy_collection_repeat_descriptors(p_component);
 IF descriptors IS NULL THEN RETURN false;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(descriptors) LOOP ordinary_values:=jsonb_set(ordinary_values,ARRAY[item->>'field'],'{}'::jsonb);END LOOP;
 IF app.page_component_uses_url_pattern_before_template_lists(p_component,ordinary_values,p_pattern) THEN RETURN true;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(descriptors) LOOP
  binding:=p_values->(item->>'field');
  IF NOT app.template_collection_binding_shape_valid(binding) THEN RETURN false;END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(binding->'entries') LOOP
   SELECT value->'fields' INTO fields FROM jsonb_array_elements(binding->'schemas') WHERE value->>'id'=entry->>'schemaVersionId';
   IF fields IS NULL OR app.collection_repeat_item_defect(item->'item',fields) IS NOT NULL THEN RETURN false;END IF;
   entry_values:=entry->'values';
   FOR field IN SELECT value FROM jsonb_array_elements(item->'item') WHERE value->>'type'='link' LOOP
    entry_values:=jsonb_set(entry_values,ARRAY[field->>'field'],CASE WHEN COALESCE(entry_values->>(field->>'field'),'')='' THEN 'null'::jsonb ELSE jsonb_build_object('url',entry_values->>(field->>'field'),'label',(SELECT value->>'label' FROM jsonb_array_elements(fields) WHERE value->>'key'=field->>'field')) END);
   END LOOP;
   IF app.frame_component_uses_url_pattern(jsonb_build_object('definition_kind','legacy','compiled_ast',item->'body','slots',item->'slots'),entry_values,p_pattern) THEN RETURN true;END IF;
  END LOOP;
 END LOOP;
 RETURN false;
END $$;
ALTER FUNCTION app.legacy_collection_repeat_descriptors(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_core(uuid,boolean,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.build_render_manifest_core(uuid,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.page_component_uses_url_pattern(jsonb,jsonb,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.legacy_collection_repeat_descriptors(jsonb),app.build_render_manifest_core_before_template_lists(uuid,boolean,boolean),app.build_render_manifest_core(uuid,boolean,boolean),app.build_render_manifest_core(uuid,boolean),app.page_component_uses_url_pattern_before_template_lists(jsonb,jsonb,text),app.page_component_uses_url_pattern(jsonb,jsonb,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

ALTER FUNCTION app.template_collection_binding_shape_valid(jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.template_collection_binding_shape_valid(jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
