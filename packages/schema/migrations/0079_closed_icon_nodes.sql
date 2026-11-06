-- Icons bind a text field to a fixed, code-owned symbol library. No SVG, URL,
-- attributes or executable content are accepted from page values or the node.
ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb) RENAME TO structured_node_defect_before_0079;
CREATE FUNCTION app.structured_node_defect(p_node jsonb,p_depth int,p_fields jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_node->>'type'='icon' THEN
    IF p_depth>16 THEN RETURN 'nests deeper than 16 levels'; END IF;
    IF jsonb_typeof(p_node) IS DISTINCT FROM 'object'
       OR NOT(p_node ?& ARRAY['type','field'])
       OR (p_node-ARRAY['type','field'])<>'{}'::jsonb
       OR jsonb_typeof(p_node->'field') IS DISTINCT FROM 'string'
       OR NOT app.is_slot_id(p_node->>'field')
       OR (p_fields->>(p_node->>'field')) IS DISTINCT FROM 'text' THEN
      RETURN 'icon must bind a declared text field without markup or attributes';
    END IF;
    RETURN NULL;
  END IF;
  RETURN app.structured_node_defect_before_0079(p_node,p_depth,p_fields);
END $$;
ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.structured_node_defect(jsonb,int,jsonb),app.structured_node_defect_before_0079(jsonb,int,jsonb) FROM PUBLIC;
