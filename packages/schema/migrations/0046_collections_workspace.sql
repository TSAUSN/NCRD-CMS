-- 0046 — atomic collection schema and entry workspaces.
--
-- Collection schemas and their entries are deliberately separate revision
-- domains.  A schema administrator may prepare a compatible model while
-- contributors continue editing entries; publication moves one complete head
-- at a time and never exposes a partially reordered collection.

ALTER TABLE public.collections
  ADD COLUMN entry_revision bigint NOT NULL DEFAULT 0 CHECK (entry_revision >= 0),
  ADD COLUMN published_entry_revision bigint NOT NULL DEFAULT 0
    CHECK (published_entry_revision >= 0 AND published_entry_revision <= entry_revision);

-- sort_index and archived_at are the draft state retained from 0001.  These
-- two columns are the corresponding live state.
ALTER TABLE public.collection_entries
  ADD COLUMN published_sort_index integer,
  ADD COLUMN published_archived_at timestamptz;

ALTER TABLE public.collection_entry_versions
  ADD COLUMN collection_id uuid,
  ADD COLUMN schema_version_id uuid;

UPDATE public.collection_entry_versions version
   SET collection_id = entry.collection_id
  FROM public.collection_entries entry
 WHERE entry.id = version.entry_id;

UPDATE public.collection_entry_versions version
   SET schema_version_id = COALESCE(collection.draft_schema_version_id,
                                    collection.published_schema_version_id)
  FROM public.collections collection
 WHERE collection.id = version.collection_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.collection_entry_versions
     WHERE collection_id IS NULL OR schema_version_id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing collection entry versions cannot be pinned to a collection schema';
  END IF;
END
$$;

ALTER TABLE public.collection_entry_versions
  ALTER COLUMN collection_id SET NOT NULL,
  ALTER COLUMN schema_version_id SET NOT NULL,
  ADD CONSTRAINT collection_entry_versions_entry_collection_owned
    FOREIGN KEY (entry_id, collection_id)
      REFERENCES public.collection_entries(id, collection_id) ON DELETE CASCADE,
  ADD CONSTRAINT collection_entry_versions_schema_owned
    FOREIGN KEY (collection_id, schema_version_id)
      REFERENCES public.collection_schema_versions(collection_id, id);

ALTER TABLE public.collection_schema_versions
  ALTER COLUMN sort SET NOT NULL,
  ADD CONSTRAINT collection_schema_versions_presentation_size
    CHECK (app.json_within(sort, 32768));

CREATE INDEX collection_entries_live_order
  ON public.collection_entries(collection_id, published_sort_index)
  WHERE published_version_id IS NOT NULL AND published_archived_at IS NULL;

CREATE OR REPLACE FUNCTION app.collection_url_is_safe(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(
    p_value IS NOT NULL
    AND char_length(p_value) <= 2048
    AND p_value !~ '[[:space:]\\]'
    AND (
      (starts_with(p_value, '/') AND NOT starts_with(p_value, '//'))
      OR p_value ~* '^https://([^/?#@[:space:]\\]+|\[[0-9a-f:]+\])(?::[0-9]{1,5})?([/?#]|$)'
    )
    AND p_value !~* '^https://[^/]*@'
    AND COALESCE(
      ((regexp_match(p_value,
        '^https://(?:[^/?#@:]+|\[[0-9a-f:]+\]):([0-9]{1,5})(?:[/?#]|$)', 'i'))[1])::integer <= 65535,
      true
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION app.collection_model_defect(p_fields jsonb, p_presentation jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  field jsonb;
  field_type text;
  field_key text;
  option_value jsonb;
  role_key text;
  role_type text;
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_fields) < 1
     OR jsonb_array_length(p_fields) > 32 THEN
    RETURN 'fields must be an array containing between 1 and 32 fields';
  END IF;

  FOR field IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    IF jsonb_typeof(field) IS DISTINCT FROM 'object'
       OR NOT (field ?& ARRAY['key','label','required','type']) THEN
      RETURN 'every field must contain key, label, required, and type';
    END IF;
    field_type := field->>'type';
    IF field_type = 'select' THEN
      IF (field - ARRAY['key','label','required','help','type','options']) <> '{}'::jsonb
         OR NOT (field ? 'options') THEN
        RETURN 'a select field contains unknown or missing properties';
      END IF;
    ELSE
      IF (field - ARRAY['key','label','required','help','type']) <> '{}'::jsonb THEN
        RETURN 'a field contains unknown properties';
      END IF;
    END IF;
    IF jsonb_typeof(field->'key') IS DISTINCT FROM 'string'
       OR NOT (field->>'key' ~ '^[a-z][a-z0-9_]{0,63}$') THEN
      RETURN 'a field key is invalid';
    END IF;
    IF jsonb_typeof(field->'label') IS DISTINCT FROM 'string'
       OR btrim(field->>'label') = ''
       OR char_length(btrim(field->>'label')) > 80 THEN
      RETURN 'a field label must contain between 1 and 80 characters';
    END IF;
    IF jsonb_typeof(field->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN 'field required must be a boolean';
    END IF;
    IF field ? 'help' AND (
      jsonb_typeof(field->'help') IS DISTINCT FROM 'string'
      OR char_length(btrim(field->>'help')) > 240
    ) THEN RETURN 'field help must be text no longer than 240 characters'; END IF;
    IF jsonb_typeof(field->'type') IS DISTINCT FROM 'string'
       OR field_type NOT IN ('text','richtext','number','date','url','image','boolean','select') THEN
      RETURN 'a field type is unsupported';
    END IF;
    IF field_type = 'select' THEN
      IF jsonb_typeof(field->'options') IS DISTINCT FROM 'array'
         OR jsonb_array_length(field->'options') < 1
         OR jsonb_array_length(field->'options') > 50 THEN
        RETURN 'select options must contain between 1 and 50 choices';
      END IF;
      FOR option_value IN SELECT value FROM jsonb_array_elements(field->'options') LOOP
        IF jsonb_typeof(option_value) IS DISTINCT FROM 'string'
           OR btrim(option_value #>> '{}') = ''
           OR char_length(btrim(option_value #>> '{}')) > 120 THEN
          RETURN 'a select option must contain between 1 and 120 characters';
        END IF;
      END LOOP;
      IF EXISTS (
        SELECT 1 FROM (
          SELECT btrim(value #>> '{}') AS option, count(*)
            FROM jsonb_array_elements(field->'options') GROUP BY 1 HAVING count(*) > 1
        ) duplicate
      ) THEN RETURN 'select options must be unique'; END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT value->>'key' AS key, count(*)
        FROM jsonb_array_elements(p_fields) GROUP BY 1 HAVING count(*) > 1
    ) duplicate
  ) THEN RETURN 'field keys must be unique'; END IF;

  IF jsonb_typeof(p_presentation) IS DISTINCT FROM 'object'
     OR (p_presentation - ARRAY['schemaVersion','titleField','subtitleField','imageField','groupField']) <> '{}'::jsonb
     OR NOT (p_presentation ?& ARRAY['schemaVersion','titleField','subtitleField','imageField','groupField']) THEN
    RETURN 'presentation must contain exactly the version-1 presentation properties';
  END IF;
  IF p_presentation->'schemaVersion' <> '1'::jsonb THEN
    RETURN 'presentation schemaVersion must be 1';
  END IF;

  FOREACH role_key IN ARRAY ARRAY['titleField','subtitleField','imageField','groupField'] LOOP
    IF role_key = 'titleField' THEN
      IF jsonb_typeof(p_presentation->role_key) IS DISTINCT FROM 'string' THEN
        RETURN 'titleField must be a field key';
      END IF;
    ELSIF jsonb_typeof(p_presentation->role_key) NOT IN ('string','null') THEN
      RETURN role_key || ' must be a field key or null';
    END IF;
    IF jsonb_typeof(p_presentation->role_key) = 'string' THEN
      role_key := p_presentation->>role_key;
      SELECT value->>'type' INTO role_type
        FROM jsonb_array_elements(p_fields) WHERE value->>'key' = role_key;
      IF role_type IS NULL THEN RETURN 'presentation names a missing field ' || role_key; END IF;
      IF (p_presentation->>'titleField' = role_key OR p_presentation->>'subtitleField' = role_key)
         AND role_type NOT IN ('text','richtext','date','select') THEN
        RETURN 'title and subtitle fields must be text, rich text, date, or select fields';
      END IF;
      IF p_presentation->>'imageField' = role_key AND role_type <> 'image' THEN
        RETURN 'imageField must name an image field';
      END IF;
      IF p_presentation->>'groupField' = role_key AND role_type NOT IN ('text','date','select') THEN
        RETURN 'groupField must name a text, date, or select field';
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.normalize_collection_fields(p_fields jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_agg(
    jsonb_build_object(
      'key', field->>'key', 'label', btrim(field->>'label'),
      'required', field->'required', 'type', field->>'type'
    )
    || CASE WHEN field ? 'help' THEN jsonb_build_object('help', btrim(field->>'help')) ELSE '{}'::jsonb END
    || CASE WHEN field->>'type' = 'select' THEN jsonb_build_object(
         'options', (SELECT jsonb_agg(to_jsonb(btrim(option #>> '{}')))
                       FROM jsonb_array_elements(field->'options') option)
       ) ELSE '{}'::jsonb END
  )
  FROM jsonb_array_elements(p_fields) field
$$;

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
      IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR char_length(value #>> '{}') > 20000 THEN
        RETURN field_label || ' must be text no longer than 20000 characters';
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

CREATE OR REPLACE FUNCTION app.normalize_collection_entry_values(p_fields jsonb, p_values jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT jsonb_object_agg(field->>'key',
    CASE
      WHEN NOT (p_values ? (field->>'key')) OR p_values->(field->>'key') = 'null'::jsonb
           OR (jsonb_typeof(p_values->(field->>'key')) = 'string'
               AND p_values->>(field->>'key') = '')
      THEN CASE WHEN field->>'type' = 'boolean' THEN 'false'::jsonb ELSE '""'::jsonb END
      ELSE p_values->(field->>'key')
    END)
  FROM jsonb_array_elements(p_fields) field
$$;

CREATE OR REPLACE FUNCTION app.enforce_collection_schema_shape()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE defect text;
BEGIN
  defect := app.collection_model_defect(NEW.fields, NEW.sort);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection schema: %', defect USING ERRCODE = 'CMS04'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER collection_schema_versions_shape
  BEFORE INSERT OR UPDATE OF fields, sort ON public.collection_schema_versions
  FOR EACH ROW EXECUTE FUNCTION app.enforce_collection_schema_shape();

CREATE OR REPLACE FUNCTION app.enforce_collection_entry_version_shape()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE fields jsonb; defect text;
BEGIN
  SELECT schema.fields INTO fields FROM public.collection_schema_versions schema
   WHERE schema.id = NEW.schema_version_id AND schema.collection_id = NEW.collection_id;
  IF fields IS NULL THEN RAISE EXCEPTION 'entry version does not name an owned collection schema' USING ERRCODE = 'CMS04'; END IF;
  defect := app.collection_entry_values_defect(NEW.site_id, fields, NEW."values");
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection entry: %', defect USING ERRCODE = 'CMS04'; END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER collection_entry_versions_shape
  BEFORE INSERT OR UPDATE OF collection_id, schema_version_id, "values" ON public.collection_entry_versions
  FOR EACH ROW EXECUTE FUNCTION app.enforce_collection_entry_version_shape();

CREATE OR REPLACE FUNCTION app.index_collection_entry_media(
  p_version_id uuid, p_site_id uuid, p_entry_id uuid, p_fields jsonb, p_values jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE field jsonb; media_match text[];
BEGIN
  FOR field IN SELECT item FROM jsonb_array_elements(p_fields) item WHERE item->>'type' = 'image' LOOP
    media_match := regexp_match(p_values->(field->>'key')->>'src',
      '^/media/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12})/(original|thumbnail|card|wide)$');
    IF media_match IS NOT NULL THEN
      INSERT INTO public.media_usage(media_id,site_id,item_type,item_id,version_id)
      VALUES (media_match[1]::uuid,p_site_id,'collection_entry',p_entry_id,p_version_id)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.create_collection(
  p_site_id uuid, p_slug text, p_name text, p_reader_key text,
  p_fields jsonb, p_presentation jsonb
) RETURNS TABLE(collection_id uuid, schema_version_id uuid, revision bigint, entry_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; normalized_fields jsonb; defect text;
BEGIN
  actor := app.require_actor();
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to create collections on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sites WHERE id = p_site_id) THEN RAISE EXCEPTION 'site not found' USING ERRCODE = 'CMS03'; END IF;
  IF p_slug IS NULL OR NOT (p_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$') OR char_length(p_slug) > 80 THEN
    RAISE EXCEPTION 'invalid collection slug' USING ERRCODE = 'CMS04';
  END IF;
  IF p_reader_key IS NULL OR NOT (p_reader_key ~ '^[a-z][a-z0-9_]{0,63}$') THEN
    RAISE EXCEPTION 'invalid collection reader key' USING ERRCODE = 'CMS04';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR char_length(btrim(p_name)) > 120 THEN
    RAISE EXCEPTION 'collection name must contain between 1 and 120 characters' USING ERRCODE = 'CMS04';
  END IF;
  defect := app.collection_model_defect(p_fields,p_presentation);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection schema: %', defect USING ERRCODE = 'CMS04'; END IF;
  normalized_fields := app.normalize_collection_fields(p_fields);
  collection_id := gen_random_uuid(); schema_version_id := gen_random_uuid(); revision := 1; entry_revision := 0;
  INSERT INTO public.collections(id,site_id,slug,name,reader_key,source,revision,entry_revision,published_entry_revision)
  VALUES(collection_id,p_site_id,p_slug,btrim(p_name),p_reader_key,'admin',revision,0,0);
  INSERT INTO public.collection_schema_versions(id,site_id,collection_id,revision,fields,sort,author_id)
  VALUES(schema_version_id,p_site_id,collection_id,revision,normalized_fields,p_presentation,actor);
  UPDATE public.collections SET draft_schema_version_id=schema_version_id WHERE id=collection_id;
  PERFORM app.write_audit(p_site_id,'user',actor,'collection.create','collection',collection_id,
    NULL,schema_version_id,jsonb_build_object('revision',revision,'slug',p_slug,'reader_key',p_reader_key));
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION app.save_collection_schema(
  p_collection_id uuid, p_expected_revision bigint, p_fields jsonb, p_presentation jsonb
) RETURNS TABLE(schema_version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; defect text; normalized_fields jsonb; before_id uuid;
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(head.site_id) THEN RAISE EXCEPTION 'not permitted to change this collection schema' USING ERRCODE='CMS02'; END IF;
  IF head.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale collection revision' USING ERRCODE='CMS01', DETAIL=jsonb_build_object('revision',head.revision)::text; END IF;
  defect := app.collection_model_defect(p_fields,p_presentation);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection schema: %', defect USING ERRCODE='CMS04'; END IF;
  normalized_fields := app.normalize_collection_fields(p_fields); before_id := head.draft_schema_version_id;
  revision := head.revision+1; schema_version_id := gen_random_uuid();
  INSERT INTO public.collection_schema_versions(id,site_id,collection_id,revision,fields,sort,author_id)
  VALUES(schema_version_id,head.site_id,head.id,revision,normalized_fields,p_presentation,actor);
  UPDATE public.collections SET revision=save_collection_schema.revision,draft_schema_version_id=schema_version_id WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.schema.save','collection',head.id,
    before_id,schema_version_id,jsonb_build_object('revision',revision));
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION app.publish_collection_schema(
  p_collection_id uuid, p_expected_revision bigint
) RETURNS TABLE(schema_version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; candidate public.collection_schema_versions%ROWTYPE;
        live_entry record; defect text; before_id uuid;
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(head.site_id) THEN RAISE EXCEPTION 'not permitted to publish this collection schema' USING ERRCODE='CMS02'; END IF;
  IF head.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale collection revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('revision',head.revision)::text; END IF;
  SELECT * INTO candidate FROM public.collection_schema_versions WHERE id=head.draft_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection has no draft schema' USING ERRCODE='CMS04'; END IF;
  FOR live_entry IN
    SELECT version."values" FROM public.collection_entries entry
    JOIN public.collection_entry_versions version ON version.id=entry.published_version_id AND version.entry_id=entry.id
    WHERE entry.collection_id=head.id AND entry.published_archived_at IS NULL
  LOOP
    defect := app.collection_entry_values_defect(head.site_id,candidate.fields,live_entry."values");
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'schema is incompatible with live entries: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  before_id := head.published_schema_version_id; schema_version_id := candidate.id; revision := head.revision+1;
  UPDATE public.collections SET revision=publish_collection_schema.revision,published_schema_version_id=schema_version_id WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.schema.publish','collection',head.id,
    before_id,schema_version_id,jsonb_build_object('revision',revision));
  PERFORM app.emit_outbox(head.site_id,'collection.schema.published',
    jsonb_build_object('collection_id',head.id,'schema_version_id',schema_version_id,'revision',revision));
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION app.save_collection_entries(
  p_collection_id uuid, p_expected_entry_revision bigint, p_entries jsonb
) RETURNS TABLE(entry_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; schema_head public.collection_schema_versions%ROWTYPE;
        entry_json jsonb; position bigint; entry_id uuid; entry_head public.collection_entries%ROWTYPE;
        version_id uuid; normalized_values jsonb; defect text; now_at timestamptz := clock_timestamp();
BEGIN
  actor := app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF COALESCE(app.site_role(head.site_id) IN ('contributor','editor','site_admin'),false) IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted to save entries for this collection' USING ERRCODE='CMS02';
  END IF;
  IF head.entry_revision <> p_expected_entry_revision THEN RAISE EXCEPTION 'stale collection entry revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('entry_revision',head.entry_revision)::text; END IF;
  SELECT * INTO schema_head FROM public.collection_schema_versions WHERE id=head.draft_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection has no draft schema' USING ERRCODE='CMS04'; END IF;
  IF jsonb_typeof(p_entries) IS DISTINCT FROM 'array' OR jsonb_array_length(p_entries)>2000 THEN
    RAISE EXCEPTION 'entries must be an array of at most 2000 items' USING ERRCODE='CMS04';
  END IF;
  FOR entry_json,position IN SELECT value,ordinality FROM jsonb_array_elements(p_entries) WITH ORDINALITY LOOP
    IF jsonb_typeof(entry_json) IS DISTINCT FROM 'object'
       OR (entry_json-ARRAY['id','stableKey','values'])<>'{}'::jsonb
       OR NOT(entry_json ?& ARRAY['id','stableKey','values'])
       OR jsonb_typeof(entry_json->'id') NOT IN ('null','string')
       OR (jsonb_typeof(entry_json->'id')='string' AND NOT(entry_json->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
       OR jsonb_typeof(entry_json->'stableKey') IS DISTINCT FROM 'string'
       OR NOT(entry_json->>'stableKey' ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
       OR char_length(entry_json->>'stableKey')>80
       OR jsonb_typeof(entry_json->'values') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'a collection entry has invalid or unknown properties' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) GROUP BY value->>'stableKey' HAVING count(*)>1)
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) WHERE jsonb_typeof(value->'id')='string' GROUP BY value->>'id' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'entry ids and stable keys must be unique in the batch' USING ERRCODE='CMS04';
  END IF;

  FOR entry_json,position IN SELECT value,ordinality FROM jsonb_array_elements(p_entries) WITH ORDINALITY LOOP
    defect := app.collection_entry_values_defect(head.site_id,schema_head.fields,entry_json->'values');
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'invalid collection entry %: %',entry_json->>'stableKey',defect USING ERRCODE='CMS04'; END IF;
    normalized_values := app.normalize_collection_entry_values(schema_head.fields,entry_json->'values');
    IF jsonb_typeof(entry_json->'id')='null' THEN
      entry_id := gen_random_uuid();
      INSERT INTO public.collection_entries(id,site_id,collection_id,stable_key,sort_index,revision,archived_at)
      VALUES(entry_id,head.site_id,head.id,entry_json->>'stableKey',(position-1)::integer,0,NULL);
      entry_head.revision := 0;
    ELSE
      entry_id := (entry_json->>'id')::uuid;
      SELECT * INTO entry_head FROM public.collection_entries WHERE id=entry_id AND collection_id=head.id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'entry does not belong to this collection' USING ERRCODE='CMS04'; END IF;
    END IF;
    version_id := gen_random_uuid();
    INSERT INTO public.collection_entry_versions(id,site_id,collection_id,entry_id,schema_version_id,revision,"values",author_id)
    VALUES(version_id,head.site_id,head.id,entry_id,schema_head.id,entry_head.revision+1,normalized_values,actor);
    UPDATE public.collection_entries SET stable_key=entry_json->>'stableKey',sort_index=(position-1)::integer,
      revision=entry_head.revision+1,draft_version_id=version_id,archived_at=NULL WHERE id=entry_id;
    PERFORM app.index_collection_entry_media(version_id,head.site_id,entry_id,schema_head.fields,normalized_values);
  END LOOP;

  UPDATE public.collection_entries entry SET archived_at=now_at,revision=entry.revision+1
   WHERE entry.collection_id=head.id AND entry.archived_at IS NULL
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) supplied
                     WHERE (jsonb_typeof(supplied->'id')='string' AND supplied->>'id'=entry.id::text)
                        OR supplied->>'stableKey'=entry.stable_key);
  entry_revision := head.entry_revision+1;
  UPDATE public.collections SET entry_revision=save_collection_entries.entry_revision WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.entries.save','collection',head.id,NULL,NULL,
    jsonb_build_object('entry_revision',entry_revision,'entry_count',jsonb_array_length(p_entries)));
  RETURN NEXT;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'entry stable keys conflict with this collection' USING ERRCODE='CMS04';
END
$$;

CREATE OR REPLACE FUNCTION app.publish_collection_entries(
  p_collection_id uuid, p_expected_entry_revision bigint
) RETURNS TABLE(entry_revision bigint, published_entry_revision bigint, published_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; schema_head public.collection_schema_versions%ROWTYPE;
        draft_entry record; defect text;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'not permitted to publish entries for this collection' USING ERRCODE='CMS02'; END IF;
  IF head.entry_revision<>p_expected_entry_revision THEN RAISE EXCEPTION 'stale collection entry revision' USING ERRCODE='CMS01',DETAIL=jsonb_build_object('entry_revision',head.entry_revision)::text; END IF;
  SELECT * INTO schema_head FROM public.collection_schema_versions WHERE id=head.published_schema_version_id AND collection_id=head.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'publish the collection schema before its entries' USING ERRCODE='CMS04'; END IF;
  FOR draft_entry IN
    SELECT entry.id,version.schema_version_id,version."values" FROM public.collection_entries entry
    JOIN public.collection_entry_versions version ON version.id=entry.draft_version_id AND version.entry_id=entry.id
    WHERE entry.collection_id=head.id AND entry.archived_at IS NULL ORDER BY entry.sort_index
  LOOP
    IF draft_entry.schema_version_id<>schema_head.id THEN RAISE EXCEPTION 'entry drafts must be saved against the published collection schema' USING ERRCODE='CMS04'; END IF;
    defect:=app.collection_entry_values_defect(head.site_id,schema_head.fields,draft_entry."values");
    IF defect IS NOT NULL THEN RAISE EXCEPTION 'entry is not publishable: %',defect USING ERRCODE='CMS04'; END IF;
  END LOOP;
  UPDATE public.collection_entries SET published_version_id=draft_version_id,
    published_sort_index=sort_index,published_archived_at=archived_at,revision=revision+1
   WHERE collection_id=head.id;
  SELECT count(*)::integer INTO published_count FROM public.collection_entries
   WHERE collection_id=head.id AND published_version_id IS NOT NULL AND published_archived_at IS NULL;
  entry_revision:=head.entry_revision+1; published_entry_revision:=entry_revision;
  UPDATE public.collections SET entry_revision=publish_collection_entries.entry_revision,
    published_entry_revision=publish_collection_entries.published_entry_revision WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.entries.publish','collection',head.id,NULL,NULL,
    jsonb_build_object('entry_revision',entry_revision,'published_count',published_count));
  PERFORM app.emit_outbox(head.site_id,'collection.entries.published',
    jsonb_build_object('collection_id',head.id,'entry_revision',entry_revision,'entry_count',published_count));
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION app.collection_url_is_safe(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.collection_model_defect(jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.normalize_collection_fields(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.normalize_collection_entry_values(jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.enforce_collection_schema_shape() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.enforce_collection_entry_version_shape() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.index_collection_entry_media(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_collection(uuid,text,text,text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_collection_schema(uuid,bigint,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_collection_schema(uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_collection_entries(uuid,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_collection_entries(uuid,bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.create_collection(uuid,text,text,text,jsonb,jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.save_collection_schema(uuid,bigint,jsonb,jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_collection_schema(uuid,bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.save_collection_entries(uuid,bigint,jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_collection_entries(uuid,bigint) TO cms_authenticated_user;

ALTER FUNCTION app.collection_url_is_safe(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.collection_model_defect(jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.normalize_collection_fields(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.normalize_collection_entry_values(jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.enforce_collection_schema_shape() OWNER TO cms_migration_owner;
ALTER FUNCTION app.enforce_collection_entry_version_shape() OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_collection_entry_media(uuid,uuid,uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.create_collection(uuid,text,text,text,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_collection_schema(uuid,bigint,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_collection_schema(uuid,bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_collection_entries(uuid,bigint,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_collection_entries(uuid,bigint) OWNER TO cms_migration_owner;
