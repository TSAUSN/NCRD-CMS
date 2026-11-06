-- Collection URL fields render as governed structured links. Labels come from
-- the pinned field schema; saved values remain plain URLs for editing and CSV.
CREATE OR REPLACE FUNCTION app.collection_repeat_item_defect(p_item jsonb,p_fields jsonb)
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
            OR (node->>'type'='image' AND f->>'type'='image')
            OR (node->>'type'='link' AND f->>'type'='url'))))
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

REVOKE ALL ON FUNCTION app.collection_repeat_item_defect(jsonb,jsonb) FROM PUBLIC;
ALTER FUNCTION app.collection_repeat_item_defect(jsonb,jsonb) OWNER TO cms_migration_owner;
