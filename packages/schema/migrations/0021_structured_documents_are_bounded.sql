-- 0021 — the size of a structured document is part of what makes it valid.
--
-- A direct reproduction crashed the renderer: about 5,000 nested element nodes
-- ending in one text field returned `RangeError: Maximum call stack size
-- exceeded` from `structuredSectionProblems`. The declared maximum depth of 16
-- protected nothing, because `StructuredDocument` is a recursive Zod schema and
-- the parse that overflowed ran *before* the check that would have refused the
-- document. TypeScript now runs an iterative preflight ahead of parsing.
--
-- This file is the database half, and it is here for a specific failure rather
-- than for symmetry. `app.structured_node_defect` already bounds depth — it
-- tests `p_depth > 16` before it recurses, so it refused the 5,000-deep
-- document correctly — but nothing bounded how many nodes a document has, how
-- many children one element has, or how large its attributes are. A 3,000-node
-- document therefore saved, previewed and published, and then the renderer
-- refused it and the section rendered as nothing: a definition accepted
-- everywhere and visible nowhere, which is the shape this schema has now met
-- three times.
--
-- The limits are STRUCTURED_LIMITS in packages/schema/src/content/structured.ts
-- and must stay equal to it. They are far above anything the V1 catalogue
-- contains — its deepest definition nests 9 levels and its largest carries 41
-- nodes — because they are not a design budget. They are the point past which a
-- document stops being a section.

/**
 * How large a structured document is, answered without recursion.
 *
 * A recursive CTE rather than a recursive function: this is asked about
 * documents that may be hostile, and PL/pgSQL's own stack is no more infinite
 * than V8's. The walk is bounded at 64 levels because anything past 16 is
 * already refused — the cap is only there so a pathological document cannot
 * make the *measurement* the expensive part.
 */
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
    FROM walk;

  IF node_count > 2000 THEN
    RETURN format('has %s nodes, more than the 2000 a section may have', node_count);
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

/**
 * The section gate, with the size question asked before the shape walk.
 *
 * Copied verbatim from 0019 apart from the two inserted lines below, because
 * paraphrasing it the first time silently changed how the field list is passed
 * to the node walk and every structured definition stopped saving.
 */
CREATE OR REPLACE FUNCTION app.structured_section_defect(
  p_kind text, p_doc jsonb, p_schema_version int
) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE fields jsonb; field jsonb; node jsonb; defect text; stray text; declared_count int;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('legacy', 'structured') THEN
    RETURN format('does not say which model it is written in: %s', COALESCE(p_kind, 'null'));
  END IF;

  -- A JSON null and a SQL NULL both mean "no document here". They arrive from
  -- different directions — a NULL column, and `jsonb_build_object` turning that
  -- column into `null` inside a manifest — and a check that knows only one of
  -- them refuses every legacy section the moment it is asked about a manifest.
  IF p_kind = 'legacy' THEN
    IF p_doc IS NOT NULL AND COALESCE(jsonb_typeof(p_doc), 'null') <> 'null' THEN
      RETURN 'is marked legacy but carries a structured document';
    END IF;
    IF p_schema_version IS NOT NULL THEN
      RETURN 'is marked legacy but names a structured schema version';
    END IF;
    RETURN NULL;
  END IF;

  IF p_schema_version IS DISTINCT FROM app.current_structured_schema_version() THEN
    RETURN format('was written against structured schema version %s, but this database requires version %s',
                  COALESCE(p_schema_version::text, 'null'),
                  app.current_structured_schema_version());
  END IF;
  IF p_doc IS NULL OR COALESCE(jsonb_typeof(p_doc), 'missing') <> 'object' THEN
    RETURN 'is not a structured document';
  END IF;

  SELECT k INTO stray FROM jsonb_object_keys(p_doc) AS k
   WHERE k NOT IN ('schemaVersion', 'fields', 'nodes') LIMIT 1;
  IF stray IS NOT NULL THEN
    RETURN format('carries %s, which this schema version does not define', stray);
  END IF;

  IF COALESCE(jsonb_typeof(p_doc -> 'schemaVersion'), 'missing') <> 'number' THEN
    RETURN 'does not say which structured schema version it was written against';
  END IF;
  -- The column and the document, against each other. The column is what this
  -- database vouched for; the number inside is what the compiler wrote. A row
  -- where they differ is one somebody rewrote half of.
  IF (p_doc ->> 'schemaVersion')::int IS DISTINCT FROM p_schema_version THEN
    RETURN format('says it is at structured schema version %s while its row says %s',
                  p_doc ->> 'schemaVersion', p_schema_version);
  END IF;

  IF COALESCE(jsonb_typeof(p_doc -> 'fields'), 'missing') <> 'array' THEN
    RETURN 'has no field list';
  END IF;
  IF COALESCE(jsonb_typeof(p_doc -> 'nodes'), 'missing') <> 'array' THEN
    RETURN 'has no node list';
  END IF;

  -- Size before shape. Everything below this line walks the tree, and
  -- `structured_node_defect` recurses to do it: a bound checked after the thing
  -- it bounds is not a bound. Depth was always tested before the recursion, so
  -- a 5,000-deep document was already refused correctly; what nothing measured
  -- was how many nodes there are, how many children one element has, or how
  -- large its attributes are. A 3,000-node document saved, previewed and
  -- published, and then the renderer refused it and the section rendered as
  -- nothing.
  defect := app.structured_shape_defect(p_doc);
  IF defect IS NOT NULL THEN RETURN defect; END IF;

  FOR field IN SELECT * FROM jsonb_array_elements(p_doc -> 'fields') LOOP
    IF COALESCE(jsonb_typeof(field), 'missing') <> 'object' THEN
      RETURN 'declares a field that is not an object';
    END IF;
    SELECT k INTO stray FROM jsonb_object_keys(field) AS k
     WHERE k NOT IN ('name', 'type', 'label') LIMIT 1;
    IF stray IS NOT NULL THEN
      RETURN format('declares a field carrying %s, which this schema version does not define', stray);
    END IF;
    IF NOT app.is_slot_id(field ->> 'name') THEN
      RETURN format('declares a field whose name is not a usable one: %s',
                    COALESCE(field ->> 'name', 'null'));
    END IF;
    IF COALESCE(field ->> 'type', '') NOT IN ('text', 'richtext', 'link', 'image') THEN
      RETURN format('declares field %s as %s, which is not a field type',
                    field ->> 'name', COALESCE(field ->> 'type', 'null'));
    END IF;
    IF COALESCE(field ->> 'label', '') = '' THEN
      RETURN format('declares field %s with no label, so an editor has nothing to call it',
                    field ->> 'name');
    END IF;
  END LOOP;

  SELECT jsonb_object_agg(f ->> 'name', f ->> 'type'), count(DISTINCT f ->> 'name')
    INTO fields, declared_count
    FROM jsonb_array_elements(p_doc -> 'fields') AS f;
  fields := COALESCE(fields, '{}'::jsonb);
  -- Two declarations of one name collapse into a single key above, so the
  -- duplicate would simply disappear and whichever type won would be the one
  -- everything believed.
  IF declared_count IS DISTINCT FROM jsonb_array_length(p_doc -> 'fields') THEN
    RETURN 'declares one field twice, so nothing can say what type it is';
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_doc -> 'nodes') LOOP
    defect := app.structured_node_defect(node, 1, fields);
    IF defect IS NOT NULL THEN RETURN defect; END IF;
  END LOOP;

  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.structured_shape_defect(jsonb) FROM PUBLIC;

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
