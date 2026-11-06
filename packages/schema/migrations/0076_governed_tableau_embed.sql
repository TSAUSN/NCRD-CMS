-- Closed source-owned provider node. Older readers reject this unknown node;
-- existing schema-v3 document meanings and field bindings are unchanged.
ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb) RENAME TO structured_node_defect_before_0076;
CREATE FUNCTION app.structured_node_defect(p_node jsonb,p_depth int,p_fields jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_node->>'type'='provider-embed' THEN
    IF p_depth>16 THEN RETURN 'nests deeper than 16 levels'; END IF;
    IF jsonb_typeof(p_node) IS DISTINCT FROM 'object'
       OR NOT(p_node ?& ARRAY['type','provider','workbook','view','title'])
       OR (p_node-ARRAY['type','provider','workbook','view','title'])<>'{}'::jsonb
       OR p_node->>'provider'<>'tableau'
       OR p_node->>'workbook'<>'HNIDisplay2_0_756'
       OR p_node->>'view' NOT IN ('Top10States','ServicesProvided2_0')
       OR jsonb_typeof(p_node->'title') IS DISTINCT FROM 'string'
       OR char_length(p_node->>'title') NOT BETWEEN 1 AND 200
       OR btrim(p_node->>'title')='' THEN
      RETURN 'provider embed must name an approved Tableau workbook/view and a title, without arbitrary URLs or markup';
    END IF;
    -- ->> comparisons alone let JSON nulls fall through SQL's three-valued IF.
    IF jsonb_typeof(p_node->'provider') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_node->'workbook') IS DISTINCT FROM 'string'
       OR jsonb_typeof(p_node->'view') IS DISTINCT FROM 'string' THEN
      RETURN 'provider identifiers must be approved strings';
    END IF;
    RETURN NULL;
  END IF;
  RETURN app.structured_node_defect_before_0076(p_node,p_depth,p_fields);
END $$;
ALTER FUNCTION app.structured_node_defect(jsonb,int,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.structured_node_defect(jsonb,int,jsonb),app.structured_node_defect_before_0076(jsonb,int,jsonb) FROM PUBLIC;
