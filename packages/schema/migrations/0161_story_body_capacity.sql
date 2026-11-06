-- Owner-requested article capacity. Ordinary text and other rich-text fields retain their limits.
CREATE OR REPLACE FUNCTION app.collection_entry_values_defect(
  p_site_id uuid, p_fields jsonb, p_values jsonb
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE
  field jsonb;
  field_key text;
  field_type text;
  field_label text;
  value jsonb;
  image_value jsonb;
  image_src text;
  media_match text[];
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN
    RETURN 'an entry must be an object of field values';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_values) supplied(key)
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_fields) element(value)
                        WHERE element.value->>'key' = supplied.key)
  ) THEN RETURN 'an entry contains an unknown field'; END IF;

  FOR field IN SELECT item FROM jsonb_array_elements(p_fields) item LOOP
    field_key := field->>'key'; field_type := field->>'type'; field_label := field->>'label';
    value := p_values->field_key;
    IF value IS NULL OR jsonb_typeof(value) = 'null'
       OR (jsonb_typeof(value) = 'string' AND value #>> '{}' = '') THEN
      IF (field->>'required')::boolean THEN RETURN field_label || ' is required'; END IF;
      CONTINUE;
    END IF;
    IF field_type IN ('text','richtext') THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR char_length(value #>> '{}') + char_length(regexp_replace(value #>> '{}', U&'[\0001-\FFFF]', '', 'g')) > (CASE WHEN field_type = 'richtext' AND field_key = 'body' THEN 100000 ELSE 20000 END) THEN
        RETURN field_label || ' must be text no longer than ' || CASE WHEN field_type = 'richtext' AND field_key = 'body' THEN '100000' ELSE '20000' END || ' characters';
      END IF;
    ELSIF field_type = 'number' THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN field_label || ' must be a number'; END IF;
    ELSIF field_type = 'boolean' THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'boolean' THEN RETURN field_label || ' must be yes or no'; END IF;
    ELSIF field_type = 'date' THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'string'
         OR NOT (value #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$')
         OR to_char(to_date(value #>> '{}','YYYY-MM-DD'),'YYYY-MM-DD') <> value #>> '{}' THEN
        RETURN field_label || ' must be a calendar date';
      END IF;
    ELSIF field_type = 'url' THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'string'
         OR NOT app.collection_url_is_safe(value #>> '{}') THEN
        RETURN field_label || ' must be an internal path or an https URL';
      END IF;
    ELSIF field_type = 'select' THEN
      IF jsonb_typeof(value) IS DISTINCT FROM 'string'
         OR NOT (field->'options' @> jsonb_build_array(value)) THEN
        RETURN field_label || ' must use one of its configured choices';
      END IF;
    ELSIF field_type = 'image' THEN
      image_value := value;
      IF jsonb_typeof(image_value) IS DISTINCT FROM 'object'
         OR (image_value - ARRAY['src','alt','decorative']) <> '{}'::jsonb
         OR NOT (image_value ?& ARRAY['src','alt','decorative'])
         OR jsonb_typeof(image_value->'src') IS DISTINCT FROM 'string'
         OR NOT app.collection_url_is_safe(image_value->>'src')
         OR jsonb_typeof(image_value->'alt') IS DISTINCT FROM 'string'
         OR jsonb_typeof(image_value->'decorative') IS DISTINCT FROM 'boolean'
         OR (btrim(image_value->>'alt') = '' AND NOT (image_value->>'decorative')::boolean) THEN
        RETURN field_label || ' needs a safe source and either alternative text or an explicit decorative choice';
      END IF;
      image_src := image_value->>'src';
      media_match := regexp_match(image_src,
        '^/media/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12})/(original|thumbnail|card|wide)$');
      IF media_match IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.media media
        JOIN public.media_variants variant ON variant.media_id = media.id AND variant.kind = media_match[2]
        WHERE media.id = media_match[1]::uuid AND (media.site_id = p_site_id OR media.site_id IS NULL)
          AND media.status = 'ready' AND media.deleted_at IS NULL
      ) THEN RETURN field_label || ' names media that is unavailable to this site'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN datetime_field_overflow THEN
  RETURN field_label || ' must be a calendar date';
END
$$;

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
    AND char_length(candidate->>(field->>'key'))+char_length(regexp_replace(candidate->>(field->>'key'),U&'[\0001-\FFFF]','','g'))>(CASE WHEN field->>'type'='richtext' AND field->>'key'='body' THEN 100000 ELSE 20000 END) THEN RETURN false;END IF;
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
