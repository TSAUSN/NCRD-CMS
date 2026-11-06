-- A link's button appearance may also choose its size, label weight and width
-- (SPEC §6.4, V1 reference 08). The four original choices stay required, so
-- every stored appearance keeps its meaning; the three new ones are optional
-- and closed. Nothing stores CSS.
CREATE OR REPLACE FUNCTION app.button_appearance_defect(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RETURN 'button appearance must be named choices'; END IF;
  IF NOT p_value ?& ARRAY['style','color','radius','hover']
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k
      WHERE k NOT IN ('style','color','radius','hover','size','weight','width'))
    OR jsonb_typeof(p_value->'style') IS DISTINCT FROM 'string' OR p_value->>'style' NOT IN ('solid','outline')
    OR jsonb_typeof(p_value->'color') IS DISTINCT FROM 'string' OR p_value->>'color' NOT IN ('primary','accent')
    OR jsonb_typeof(p_value->'radius') IS DISTINCT FROM 'string' OR p_value->>'radius' NOT IN ('square','soft','rounded','pill')
    OR jsonb_typeof(p_value->'hover') IS DISTINCT FROM 'string' OR p_value->>'hover' NOT IN ('none','lift','invert','underline')
    OR (p_value ? 'size' AND (jsonb_typeof(p_value->'size') IS DISTINCT FROM 'string' OR p_value->>'size' NOT IN ('small','medium','large')))
    OR (p_value ? 'weight' AND (jsonb_typeof(p_value->'weight') IS DISTINCT FROM 'string' OR p_value->>'weight' NOT IN ('regular','bold')))
    OR (p_value ? 'width' AND (jsonb_typeof(p_value->'width') IS DISTINCT FROM 'string' OR p_value->>'width' NOT IN ('auto','full'))) THEN
    RETURN 'unsupported button appearance choice';
  END IF;
  RETURN NULL;
END $$;
