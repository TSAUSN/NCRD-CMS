-- 0024 — bound the shape check before it walks.
--
-- `app.structured_shape_defect` (0021) counts a document by walking all of it
-- and testing the limits afterwards. That is correct and it is also the whole
-- attack: the widest hostile document is one flat array of five million empty
-- objects, and the walk that proves it is too large is the work an attacker
-- wanted done. Measured on this schema, before this change:
--
--   1000x512 over 2 levels     513,000 nodes    15 MB     182 ms
--   4x512x512 over 3 levels  1,050,628 nodes    34 MB     469 ms
--   one flat array           5,000,000 nodes    15 MB   1,330 ms
--   one flat array          12,000,000 nodes    36 MB   5,632 ms
--
-- Two changes, both about not counting past the point where the answer is
-- already known. Reading `jsonb_array_length` is O(1) and answers the flat case
-- outright; the `LIMIT` inside the aggregate stops the recursive walk once more
-- nodes have been seen than a document may have. The same measurements after:
-- 29 ms, 110 ms, 31 ms. The residual is the jsonb parse, which happens before
-- this function is called and cannot be avoided here.
--
-- The exact node count leaves the message with the second change, because
-- stopping early means no longer knowing it. That is the right trade and it has
-- a side benefit: the sentence is now byte-identical to the one TypeScript's
-- preflight produces, so the two layers cannot be told apart by their
-- diagnostics.
--
-- Correctness of the LIMIT: when the count is within bounds the limit never
-- truncated, so max depth, max children, max attributes and the long-attribute
-- flag are all still computed over the whole document and every later check
-- stays exact. When it did truncate, the count test fires first and the other
-- aggregates are never read.

CREATE OR REPLACE FUNCTION app.structured_shape_defect(p_doc jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  node_count int; max_depth int; max_children int;
  max_attributes int; long_attribute boolean;
  field_count int; long_label boolean;
BEGIN
  IF COALESCE(jsonb_typeof(p_doc -> 'nodes'), 'missing') <> 'array' THEN
    RETURN NULL;  -- Not this function's question; the caller reports it.
  END IF;

  IF COALESCE(jsonb_typeof(p_doc -> 'fields'), 'missing') = 'array' THEN
    SELECT count(*), bool_or(length(COALESCE(f ->> 'label', '')) > 256)
      INTO field_count, long_label
      FROM jsonb_array_elements(p_doc -> 'fields') AS f;
    IF field_count > 256 THEN
      RETURN format('declares %s fields, more than the 256 a section may have', field_count);
    END IF;
    IF long_label THEN
      RETURN 'has a field label longer than 256 characters';
    END IF;
  END IF;

  -- O(1), and it answers the widest hostile document there is.
  IF jsonb_array_length(p_doc -> 'nodes') > 2000 THEN
    RETURN 'has more than 2000 nodes';
  END IF;

  WITH RECURSIVE walk(node, depth) AS (
    SELECT n, 1 FROM jsonb_array_elements(p_doc -> 'nodes') AS n
    UNION ALL
    SELECT c, w.depth + 1
      FROM walk w, jsonb_array_elements(w.node -> 'children') AS c
     WHERE COALESCE(jsonb_typeof(w.node -> 'children'), 'missing') = 'array'
       AND w.depth < 64
  )
  SELECT count(*),
         max(depth),
         max(CASE WHEN COALESCE(jsonb_typeof(node -> 'children'), 'missing') = 'array'
                  THEN jsonb_array_length(node -> 'children') ELSE 0 END),
         max(CASE WHEN COALESCE(jsonb_typeof(node -> 'attributes'), 'missing') = 'object'
                  THEN (SELECT count(*)::int FROM jsonb_object_keys(node -> 'attributes')) ELSE 0 END),
         bool_or(COALESCE(jsonb_typeof(node -> 'attributes'), 'missing') = 'object'
                 AND EXISTS (SELECT 1 FROM jsonb_each_text(node -> 'attributes') AS a(k, v)
                              WHERE length(a.k) + length(COALESCE(a.v, '')) > 512))
    INTO node_count, max_depth, max_children, max_attributes, long_attribute
    -- One more than the limit: enough to know the limit was crossed, and no
    -- more than that.
    FROM (SELECT node, depth FROM walk LIMIT 2001) AS bounded;

  IF node_count > 2000 THEN
    RETURN 'has more than 2000 nodes';
  END IF;
  IF max_depth > 16 THEN
    RETURN 'nests deeper than 16 levels';
  END IF;
  IF max_children > 512 THEN
    RETURN format('has an element with %s children, more than the 512 one element may have', max_children);
  END IF;
  IF max_attributes > 64 THEN
    RETURN format('has an element carrying %s attributes, more than the 64 one element may carry', max_attributes);
  END IF;
  IF long_attribute THEN
    RETURN 'has an attribute longer than 512 characters';
  END IF;

  RETURN NULL;
END
$$;

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
