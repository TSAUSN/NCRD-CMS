-- Keep the existing photo focus contract through collection save/preview/publish.
-- All source, description, media ownership and article capacity checks stay in force.
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
         OR (image_value - ARRAY['src','alt','decorative','focal']) <> '{}'::jsonb
         OR NOT (image_value ?& ARRAY['src','alt','decorative'])
         OR jsonb_typeof(image_value->'src') IS DISTINCT FROM 'string'
         OR NOT app.collection_url_is_safe(image_value->>'src')
         OR jsonb_typeof(image_value->'alt') IS DISTINCT FROM 'string'
         OR jsonb_typeof(image_value->'decorative') IS DISTINCT FROM 'boolean'
         OR (btrim(image_value->>'alt') = '' AND NOT (image_value->>'decorative')::boolean) THEN
        RETURN field_label || ' needs a safe source and either alternative text or an explicit decorative choice';
      END IF;
      IF image_value ? 'focal' AND image_value->'focal'<>'null'::jsonb THEN
        IF jsonb_typeof(image_value->'focal') IS DISTINCT FROM 'object' THEN
          RETURN field_label || ' needs a focus point inside the photo';
        END IF;
        IF (image_value->'focal')-ARRAY['x','y']<>'{}'::jsonb
          OR NOT ((image_value->'focal') ?& ARRAY['x','y'])
          OR jsonb_typeof(image_value->'focal'->'x') IS DISTINCT FROM 'number'
          OR jsonb_typeof(image_value->'focal'->'y') IS DISTINCT FROM 'number' THEN
          RETURN field_label || ' needs a focus point inside the photo';
        END IF;
        IF (image_value->'focal'->>'x')::numeric NOT BETWEEN 0 AND 1
          OR (image_value->'focal'->>'y')::numeric NOT BETWEEN 0 AND 1 THEN
          RETURN field_label || ' needs a focus point inside the photo';
        END IF;
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

ALTER FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.collection_entry_values_defect(uuid,jsonb,jsonb) TO cms_authenticated_user;
