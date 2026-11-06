-- 0025 — structured schema version 2: governed attributes on link and image
-- field nodes.
--
-- ADR 0008 has the argument. The short version: schema v1's link and image
-- field nodes carry no attributes at all — the field node *is* the anchor or
-- the image — and the V1 inventory found `class` on 215 link elements across 77
-- definitions and `width`/`height` on 85 of 86 image elements. That single
-- absence is the importer's dominant blocker.
--
-- The attributes are DEFINITION-OWNED and static. A definition author chooses
-- them when the definition is written; page content can never reach them. That
-- separation is the whole security model: `href`, `src` and `alt` remain the
-- author's values under the field and URL policies, and everything added here
-- is chosen from a closed set by somebody who is already trusted to write
-- markup.
--
-- Every grammar below is the one packages/schema/src/content/structured.ts
-- enforces, and the two must stay equal. TypeScript is where the compiler
-- checks; this is where a row that never met the compiler is checked, which is
-- the direction an attacker with a database role comes from.

CREATE OR REPLACE FUNCTION app.current_structured_schema_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 2 $$;

/**
 * A class token: the same grammar STRUCTURED_TOKEN spells in TypeScript.
 *
 * Deliberately narrower than CSS allows. The inventory found one definition
 * whose classes are framework utilities — `sm:px-6`, `bg-white/95`,
 * `tracking-[0.14em]` — and those stay quarantined: a grammar that admits `:`,
 * `/` and `[` admits most of a selector, and this value is emitted into a class
 * attribute that CSS then matches against.
 */
CREATE OR REPLACE FUNCTION app.is_structured_token(p_token text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_token IS NOT NULL AND p_token ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
$$;

/**
 * Whether a static attribute a field node declares is one it may declare, and
 * whether its value is one that attribute can hold.
 *
 * `class` refuses a repeated token and `rel` permits one, which is not an
 * oversight: a class list is emitted verbatim and in order, so a document
 * saying one class twice is one somebody edited badly; a `rel` is assembled by
 * the renderer from the definition's list plus what `target="_blank"` requires,
 * so duplicates there have to collapse somewhere and they collapse in the
 * normaliser both layers call.
 */
CREATE OR REPLACE FUNCTION app.structured_attribute_defect(
  p_field_type text, p_name text, p_value jsonb
) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE token jsonb; n int; seen text[] := ARRAY[]::text[];
BEGIN
  IF p_field_type NOT IN ('link', 'image') THEN
    RETURN format('has a %s field carrying %s, and a %s field carries no static attributes',
                  p_field_type, p_name, p_field_type);
  END IF;
  IF (p_field_type = 'link' AND p_name NOT IN ('class', 'rel', 'target'))
     OR (p_field_type = 'image'
         AND p_name NOT IN ('class', 'width', 'height', 'decoding', 'loading', 'fetchpriority')) THEN
    RETURN format('has a %s field carrying %s, which is not a static attribute a %s field may carry',
                  p_field_type, p_name, p_field_type);
  END IF;

  IF p_name IN ('class', 'rel') THEN
    IF COALESCE(jsonb_typeof(p_value), 'missing') <> 'array' THEN
      RETURN format('%s is a list of tokens, not %s', p_name, COALESCE(jsonb_typeof(p_value), 'nothing'));
    END IF;
    n := jsonb_array_length(p_value);
    -- Empty is refused rather than read as absent: `class=""` and no class at
    -- all are different bytes, and a document should say which it means.
    IF n = 0 OR n > 32 THEN
      RETURN format('%s has %s tokens, and a list holds between 1 and 32', p_name, n);
    END IF;
    FOR token IN SELECT * FROM jsonb_array_elements(p_value) LOOP
      IF COALESCE(jsonb_typeof(token), 'missing') <> 'string' THEN
        RETURN format('%s has a token that is not text', p_name);
      END IF;
      IF p_name = 'class' THEN
        IF NOT app.is_structured_token(token #>> '{}') THEN
          RETURN format('has a %s field whose class is not a usable value', p_field_type);
        END IF;
        IF (token #>> '{}') = ANY (seen) THEN
          RETURN format('has a %s field whose class is not a usable value', p_field_type);
        END IF;
        seen := seen || (token #>> '{}');
      ELSE
        IF (token #>> '{}') NOT IN ('alternate', 'author', 'bookmark', 'external', 'help',
                                    'license', 'next', 'nofollow', 'noopener', 'noreferrer',
                                    'prev', 'search', 'tag') THEN
          RETURN format('has a %s field whose rel is not a usable value', p_field_type);
        END IF;
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;

  IF p_name IN ('width', 'height') THEN
    IF COALESCE(jsonb_typeof(p_value), 'missing') <> 'number' THEN
      RETURN format('%s is a whole number of pixels, not %s', p_name,
                    COALESCE(jsonb_typeof(p_value), 'nothing'));
    END IF;
    -- Integer, and between 1 and 8192. Zero is conforming HTML and is refused
    -- anyway: the attribute exists to reserve the box before the bytes arrive,
    -- and a zero dimension reserves nothing, so a definition declaring one has
    -- asked for the attribute and refused its only effect.
    IF (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) THEN
      RETURN format('has a %s field whose %s is not a usable value', p_field_type, p_name);
    END IF;
    IF (p_value #>> '{}')::numeric < 1 OR (p_value #>> '{}')::numeric > 8192 THEN
      RETURN format('%s is %s, and an intrinsic dimension is between 1 and 8192',
                    p_name, p_value #>> '{}');
    END IF;
    RETURN NULL;
  END IF;

  IF COALESCE(jsonb_typeof(p_value), 'missing') <> 'string' THEN
    RETURN format('%s is one of a fixed set of words, not %s', p_name,
                  COALESCE(jsonb_typeof(p_value), 'nothing'));
  END IF;
  IF p_name = 'target' AND (p_value #>> '{}') NOT IN ('_self', '_blank') THEN
    RETURN format('has a %s field whose ' || p_name || ' is not a usable value', p_field_type);
  END IF;
  IF p_name = 'decoding' AND (p_value #>> '{}') NOT IN ('sync', 'async', 'auto') THEN
    RETURN format('has a %s field whose ' || p_name || ' is not a usable value', p_field_type);
  END IF;
  IF p_name = 'loading' AND (p_value #>> '{}') NOT IN ('lazy', 'eager') THEN
    RETURN format('has a %s field whose ' || p_name || ' is not a usable value', p_field_type);
  END IF;
  IF p_name = 'fetchpriority' AND (p_value #>> '{}') NOT IN ('high', 'low', 'auto') THEN
    RETURN format('has a %s field whose ' || p_name || ' is not a usable value', p_field_type);
  END IF;
  RETURN NULL;
END
$$;

/**
 * The node walk, with the field branch taught about attributes.
 *
 * Copied from 0019 apart from that branch. Paraphrasing this function once
 * before silently changed how the field list reaches it and stopped every
 * structured definition saving, so it is copied rather than rewritten.
 */
CREATE OR REPLACE FUNCTION app.structured_node_defect(p_node jsonb, p_depth int, p_fields jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node_type text; tag text; attribute_name text; attribute_value jsonb;
        child jsonb; defect text; declared text; stray text;
BEGIN
  IF p_depth > 16 THEN
    RETURN 'nests deeper than 16 levels';
  END IF;
  IF COALESCE(jsonb_typeof(p_node), 'missing') <> 'object' THEN
    RETURN 'has a node that is not an object';
  END IF;
  node_type := p_node ->> 'type';
  IF node_type IS NULL THEN
    RETURN 'has a node that does not say what type it is';
  END IF;

  IF node_type = 'element' THEN
    SELECT k INTO stray FROM jsonb_object_keys(p_node) AS k
     WHERE k NOT IN ('type', 'tag', 'attributes', 'children') LIMIT 1;
    IF stray IS NOT NULL THEN
      RETURN format('has an element node carrying %s, which this schema version does not define', stray);
    END IF;

    tag := p_node ->> 'tag';
    IF NOT app.is_structured_tag(tag) THEN
      RETURN format('has an element node with tag %s, which is not one an element node may carry',
                    COALESCE(tag, 'null'));
    END IF;

    IF COALESCE(jsonb_typeof(p_node -> 'attributes'), 'missing') NOT IN ('missing', 'object') THEN
      RETURN 'has an element node whose attributes are not a set of names and values';
    END IF;
    IF jsonb_typeof(p_node -> 'attributes') = 'object' THEN
      FOR attribute_name, attribute_value IN
        SELECT key, value FROM jsonb_each(p_node -> 'attributes')
      LOOP
        IF NOT app.is_structured_attribute(attribute_name) THEN
          RETURN format('has an element node carrying the attribute %s, which is not one it may carry',
                        attribute_name);
        END IF;
        IF COALESCE(jsonb_typeof(attribute_value), 'missing') <> 'string' THEN
          RETURN format('has an element node whose %s is not text', attribute_name);
        END IF;
        IF NOT app.is_structured_attribute_value(attribute_name, attribute_value #>> '{}') THEN
          RETURN format('has an element node whose %s is not a usable value', attribute_name);
        END IF;
      END LOOP;
    END IF;

    IF COALESCE(jsonb_typeof(p_node -> 'children'), 'missing') NOT IN ('missing', 'array') THEN
      RETURN 'has an element node whose children are not a list';
    END IF;
    IF jsonb_typeof(p_node -> 'children') = 'array' THEN
      IF app.is_structured_void_tag(tag) AND jsonb_array_length(p_node -> 'children') > 0 THEN
        RETURN format('has a <%s> with children, and <%s> has no end tag to put them inside', tag, tag);
      END IF;
      FOR child IN SELECT * FROM jsonb_array_elements(p_node -> 'children') LOOP
        defect := app.structured_node_defect(child, p_depth + 1, p_fields);
        IF defect IS NOT NULL THEN RETURN defect; END IF;
      END LOOP;
    END IF;

    RETURN NULL;
  END IF;

  IF node_type IN ('text', 'richtext', 'link', 'image') THEN
    -- Only link and image gained a key. A text or rich-text field carrying an
    -- `attributes` key is refused here, not ignored: the element around a text
    -- field is an element node the author already wrote, and a key silently
    -- dropped is the half of a document somebody believes is doing something.
    IF node_type IN ('link', 'image') THEN
      SELECT k INTO stray FROM jsonb_object_keys(p_node) AS k
       WHERE k NOT IN ('type', 'field', 'staticAttributes') LIMIT 1;
    ELSE
      SELECT k INTO stray FROM jsonb_object_keys(p_node) AS k
       WHERE k NOT IN ('type', 'field') LIMIT 1;
    END IF;
    IF stray IS NOT NULL THEN
      RETURN format('has a %s node carrying %s, which this schema version does not define',
                    node_type, stray);
    END IF;

    IF NOT app.is_slot_id(p_node ->> 'field') THEN
      RETURN format('has a %s node whose field name is not a usable one: %s',
                    node_type, COALESCE(p_node ->> 'field', 'null'));
    END IF;
    declared := p_fields ->> (p_node ->> 'field');
    IF declared IS NULL THEN
      RETURN format('uses field %s, which it never declares', p_node ->> 'field');
    END IF;
    IF declared <> node_type THEN
      RETURN format('uses field %s as %s but declares it as %s',
                    p_node ->> 'field', node_type, declared);
    END IF;

    IF node_type IN ('link', 'image') THEN
      IF COALESCE(jsonb_typeof(p_node -> 'staticAttributes'), 'missing') NOT IN ('missing', 'object') THEN
        RETURN format('has a %s node whose attributes are not a set of names and values', node_type);
      END IF;
      IF jsonb_typeof(p_node -> 'staticAttributes') = 'object' THEN
        FOR attribute_name, attribute_value IN
          SELECT key, value FROM jsonb_each(p_node -> 'staticAttributes')
        LOOP
          defect := app.structured_attribute_defect(node_type, attribute_name, attribute_value);
          IF defect IS NOT NULL THEN RETURN defect; END IF;
        END LOOP;
        -- Width and height arrive together or not at all: the pair is what
        -- gives a browser an aspect ratio to reserve space with, and a lone
        -- one reserves a strip of the wrong shape.
        IF node_type = 'image'
           AND (p_node -> 'staticAttributes' ? 'width') <> (p_node -> 'staticAttributes' ? 'height') THEN
          RETURN 'has an image field carrying only one of width and height, so the box it reserves is the wrong one';
        END IF;
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  RETURN format('has a node of type %s, which is not a node type', node_type);
END
$$;


/**
 * The shape check, taught about the token lists version 2 introduced.
 *
 * A class list is bounded here rather than only in the node walk for the reason
 * every other bound is: a document carrying a million-token class list is an
 * attribute by every measure that existed before, and summing it to prove it
 * too long is the work the attacker wanted done. Copied from 0024 apart from
 * the token loop.
 */
CREATE OR REPLACE FUNCTION app.structured_shape_defect(p_doc jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  node_count int; max_depth int; max_children int;
  max_attributes int; long_attribute boolean; wide_token_list boolean;
  field_count int; long_label boolean;
BEGIN
  IF COALESCE(jsonb_typeof(p_doc -> 'nodes'), 'missing') <> 'array' THEN
    RETURN NULL;
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
         bool_or((COALESCE(jsonb_typeof(node -> 'attributes'), 'missing') = 'object'
                  AND EXISTS (SELECT 1 FROM jsonb_each_text(node -> 'attributes') AS a(k, v)
                               WHERE length(a.k) + length(COALESCE(a.v, '')) > 512))
                 -- A token list is measured as it will be rendered: the name,
                 -- plus the tokens, plus the single spaces between them. A
                 -- list of 32 tokens is within the count bound and can still
                 -- be two kilobytes of class attribute.
                 OR (COALESCE(jsonb_typeof(node -> 'staticAttributes'), 'missing') = 'object'
                     AND EXISTS (SELECT 1 FROM jsonb_each(node -> 'staticAttributes') AS a(k, v)
                                  WHERE length(a.k) + CASE
                                    WHEN jsonb_typeof(a.v) = 'array' THEN COALESCE((
                                      SELECT sum(length(t #>> '{}'))::int
                                             + greatest(jsonb_array_length(a.v) - 1, 0)
                                        FROM jsonb_array_elements(a.v) AS t
                                       WHERE jsonb_typeof(t) = 'string'), 0)
                                    ELSE length(COALESCE(a.v #>> '{}', ''))
                                  END > 512))),
         bool_or(COALESCE(jsonb_typeof(node -> 'staticAttributes'), 'missing') = 'object'
                 AND EXISTS (SELECT 1 FROM jsonb_each(node -> 'staticAttributes') AS a(k, v)
                              -- CASE, not AND: SQL does not promise to
                              -- short-circuit, and jsonb_array_length raises on
                              -- a scalar rather than returning anything.
                              WHERE CASE WHEN jsonb_typeof(v) = 'array'
                                         THEN jsonb_array_length(v) > 32 ELSE false END))
    INTO node_count, max_depth, max_children, max_attributes, long_attribute, wide_token_list
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
  IF wide_token_list THEN
    RETURN 'has an attribute of more than 32 tokens';
  END IF;

  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.is_structured_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_attribute_defect(text, text, jsonb) FROM PUBLIC;

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
