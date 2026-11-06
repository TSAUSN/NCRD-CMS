-- Optional Stories catalog lives with the existing immutable collection model.
-- No row is backfilled and no grants, RLS or publication commands are changed.
CREATE OR REPLACE FUNCTION app.stories_settings_defect(p_settings jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE group_key text; tag jsonb; keyword jsonb;
BEGIN
 IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object' THEN RETURN 'Stories settings must be an object'; END IF;
 IF NOT (p_settings ?& ARRAY['schemaVersion','mainLabel','secondaryLabel','mainTags','secondaryTags','publishUnreviewed','source'])
 OR (p_settings-ARRAY['schemaVersion','mainLabel','secondaryLabel','mainTags','secondaryTags','publishUnreviewed','source'])<>'{}'::jsonb
 THEN RETURN 'Stories settings contain missing or unknown properties'; END IF;
 IF p_settings->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(p_settings->'publishUnreviewed') IS DISTINCT FROM 'boolean'
 OR jsonb_typeof(p_settings->'source') IS DISTINCT FROM 'string'
 OR p_settings->>'source' NOT IN ('none','sawso') THEN RETURN 'Stories settings contain an invalid version, review policy or source'; END IF;
 FOREACH group_key IN ARRAY ARRAY['mainLabel','secondaryLabel'] LOOP
  IF jsonb_typeof(p_settings->group_key) IS DISTINCT FROM 'string'
  OR char_length(btrim(p_settings->>group_key)) NOT BETWEEN 1 AND 80 THEN RETURN 'Stories tag group names must contain between 1 and 80 characters'; END IF;
 END LOOP;
 FOREACH group_key IN ARRAY ARRAY['mainTags','secondaryTags'] LOOP
  IF jsonb_typeof(p_settings->group_key) IS DISTINCT FROM 'array' THEN RETURN 'Stories tags must be an array'; END IF;
  IF jsonb_array_length(p_settings->group_key)>100 THEN RETURN 'Stories supports up to 100 tags in each group'; END IF;
  FOR tag IN SELECT value FROM jsonb_array_elements(p_settings->group_key) LOOP
   IF jsonb_typeof(tag) IS DISTINCT FROM 'object' THEN RETURN 'A Stories tag must be an object'; END IF;
   IF NOT (tag ?& ARRAY['id','label','keywords'])
   OR (group_key='mainTags' AND (tag-ARRAY['id','label','keywords'])<>'{}'::jsonb)
   OR (group_key='secondaryTags' AND (NOT(tag?'areas') OR (tag-ARRAY['id','label','keywords','areas'])<>'{}'::jsonb))
   THEN RETURN 'A Stories tag contains missing or unknown properties'; END IF;
   IF jsonb_typeof(tag->'id') IS DISTINCT FROM 'string' OR char_length(tag->>'id')>80
   OR (tag->>'id')!~'^[a-z0-9]+(-[a-z0-9]+)*$'
   OR jsonb_typeof(tag->'label') IS DISTINCT FROM 'string' OR char_length(btrim(tag->>'label')) NOT BETWEEN 1 AND 80
   THEN RETURN 'A Stories tag needs a stable ID and a label of 1 to 80 characters'; END IF;
   IF jsonb_typeof(tag->'keywords') IS DISTINCT FROM 'array' THEN RETURN 'Story keywords must be an array'; END IF;
   IF jsonb_array_length(tag->'keywords')>50 THEN RETURN 'A story tag supports up to 50 keywords'; END IF;
   FOR keyword IN SELECT value FROM jsonb_array_elements(tag->'keywords') LOOP
    IF jsonb_typeof(keyword) IS DISTINCT FROM 'string' OR char_length(btrim(keyword#>>'{}')) NOT BETWEEN 1 AND 120
    THEN RETURN 'Story keywords must contain between 1 and 120 characters'; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(tag->'keywords') k GROUP BY lower(btrim(k)) HAVING count(*)>1)
   THEN RETURN 'Story keywords must be unique'; END IF;
   IF group_key='secondaryTags' THEN
    IF jsonb_typeof(tag->'areas') IS DISTINCT FROM 'array' THEN RETURN 'Story map areas must be an array'; END IF;
    IF jsonb_array_length(tag->'areas')>6 OR EXISTS(SELECT 1 FROM jsonb_array_elements(tag->'areas') a WHERE jsonb_typeof(a) IS DISTINCT FROM 'string' OR a#>>'{}' NOT IN ('north-america','latin-america-caribbean','europe','africa','asia','oceania'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(tag->'areas') a GROUP BY a HAVING count(*)>1)
    THEN RETURN 'Story map areas must be unique approved regions'; END IF;
   END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_settings->group_key) t GROUP BY t->>'id' HAVING count(*)>1)
  THEN RETURN 'Story tag IDs must be unique within each group'; END IF;
 END LOOP;
 RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION app.stories_settings_defect(jsonb) FROM PUBLIC;
ALTER FUNCTION app.stories_settings_defect(jsonb) OWNER TO cms_migration_owner;

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
     OR (p_presentation - ARRAY['schemaVersion','titleField','subtitleField','imageField','groupField','stories']) <> '{}'::jsonb
     OR NOT (p_presentation ?& ARRAY['schemaVersion','titleField','subtitleField','imageField','groupField']) THEN
    RETURN 'presentation contains missing or unknown version-1 properties';
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
  IF p_presentation ? 'stories' THEN
    RETURN app.stories_settings_defect(p_presentation->'stories');
  END IF;
  RETURN NULL;
END
$$;

