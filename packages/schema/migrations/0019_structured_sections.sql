-- 0019 — structured section definitions, stored beside the frozen legacy ones.
--
-- ADR 0007's model: a definition is a versioned document of typed nodes, and
-- every value an editor can change is a field on a node rather than a position
-- in a string. The interpolation model is not extended and not migrated; it is
-- frozen, and the two live in the same table with a column that says which is
-- which.
--
-- The column exists because the alternative is inference, and inference here is
-- a security decision made by whichever code path looks first. A row carrying a
-- structured document *and* a compiled AST is one that renders as a structured
-- section to the renderer and as an interpolated one to anything that checks
-- `compiled_ast` — and the two disagree silently, because a section that
-- rendered the wrong half still renders. So `definition_kind` is NOT NULL with
-- no default beyond `'legacy'`, the constraint below makes the two artifacts
-- mutually exclusive, and a structured row's `compiled_ast` is required to be
-- empty so it cannot carry interpolation nodes at all.
--
-- The gate itself, `app.structured_section_defect`, is `app.render_ast_defect`'s
-- sibling in shape and in spirit: it returns a sentence rather than a boolean
-- because the sentence reaches an author, and every comparison against
-- `jsonb_typeof` is COALESCEd because a missing JSON member makes one NULL
-- rather than false — the three-valued-logic failure 0016 documents, where a
-- guard that "did not fire" and a guard that "passed" are the same thing to
-- anything downstream.
--
-- It is wired into exactly the two places the AST gate is wired into: the
-- authoring command, so nothing unvouched-for is stored, and the manifest
-- builder, so nothing unvouched-for previews or publishes. Deliberately *not*
-- into `app.section_definitions_needing_revalidation()`: that list is consumed
-- by `pnpm db:revalidate`, which recompiles a row from its `source_html` with
-- the interpolation compiler, and a structured definition has no source_html to
-- recompile. Listing one there would hand the repair tool a row whose repair is
-- to overwrite it with an empty legacy definition.

ALTER TABLE section_def_versions
  ADD COLUMN definition_kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN structured_doc jsonb,
  ADD COLUMN structured_schema_version int;

COMMENT ON COLUMN section_def_versions.definition_kind IS
  'Which model this version is written in: legacy interpolation, or the '
  'structured node document of ADR 0007. Never inferred from which artifact is '
  'present — a row that carried both would render differently to two readers.';
COMMENT ON COLUMN section_def_versions.structured_doc IS
  'The typed node document, for a structured version. NULL for a legacy one.';
COMMENT ON COLUMN section_def_versions.structured_schema_version IS
  'Which structured schema version wrote structured_doc. Checked the way the '
  'sanitizer and CSS policy versions are, and against the version the document '
  'names about itself, so half a rewrite is visible.';

ALTER TABLE section_def_versions
  ADD CONSTRAINT section_def_versions_structured_shape CHECK (
    definition_kind IN ('legacy', 'structured')
    -- Both artifacts, or neither, and never a mixture. `(x IS NOT NULL) = (…)`
    -- rather than an OR chain, because equality between two booleans says the
    -- rule once and cannot be satisfied by an omission.
    AND (structured_doc IS NOT NULL) = (definition_kind = 'structured')
    AND (structured_schema_version IS NOT NULL) = (definition_kind = 'structured')
    -- A structured row's compiled AST is required to be empty. compiled_ast is
    -- NOT NULL from 0001 and cannot become nullable without teaching every
    -- existing gate about a second shape, so a structured row stores the empty
    -- compiled section — and this makes that a rule rather than a convention.
    -- COALESCE because `jsonb -> 'nodes'` is NULL when the member is missing,
    -- and `NULL = '[]'` is NULL, which a CHECK constraint accepts.
    AND (definition_kind <> 'structured'
         OR COALESCE(compiled_ast -> 'nodes' = '[]'::jsonb, false))
    AND (structured_doc IS NULL OR app.json_within(structured_doc, 1048576))
  );

/**
 * The structured schema version this database accepts.
 *
 * The same shape as `app.current_sanitizer_policy_version` and
 * `app.current_css_policy_version`, and read the same way: a stored document at
 * any other version is refused rather than read optimistically, because what
 * changes between versions is what the nodes mean.
 */
CREATE OR REPLACE FUNCTION app.current_structured_schema_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 1 $$;

/**
 * The tags an element node may carry.
 *
 * The identical list to `STRUCTURED_TAGS` in @cms/schema, written out here
 * rather than derived, because the database cannot import TypeScript and a gate
 * that trusts its caller's allowlist is not a gate. `a` and `img` are absent
 * from both: links and images are field nodes, so there is no authored position
 * in the whole model where a URL can be written down.
 */
CREATE OR REPLACE FUNCTION app.is_structured_tag(p_tag text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_tag IS NOT NULL AND p_tag = ANY (ARRAY[
    'section', 'div', 'article', 'aside', 'header', 'footer',
    'figure', 'figcaption', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'strong', 'em', 'small',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'br', 'hr'])
$$;

/** Tags with no end tag, which therefore cannot have children. */
CREATE OR REPLACE FUNCTION app.is_structured_void_tag(p_tag text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_tag IS NOT NULL AND p_tag = ANY (ARRAY['br', 'hr'])
$$;

/** The attribute names an element node may carry. Static, and short enough to read. */
CREATE OR REPLACE FUNCTION app.is_structured_attribute(p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_name IS NOT NULL AND p_name = ANY (ARRAY[
    'class', 'id', 'role', 'lang', 'dir',
    'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden'])
$$;

/**
 * Is this a value the named attribute can actually hold?
 *
 * The renderer escapes every attribute value on the way out, so this is not what
 * makes one safe. It is what makes the database and the compiler refuse the same
 * documents: a definition that stores a `class` of `a"onclick=x` is one whose
 * author and whose renderer believe different things about what will appear on
 * the page, and the disagreement only surfaces when somebody reads the HTML.
 *
 * The space-separated grammars are written as one repeated-token pattern rather
 * than by splitting, so `a  b` and a trailing space are refused here exactly as
 * they are by the TypeScript that splits on a single space.
 */
CREATE OR REPLACE FUNCTION app.is_structured_attribute_value(p_name text, p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_value IS NOT NULL
     AND length(p_value) <= 512
     -- `<` is checked bluntly, the way the CSS gate checks it: one character,
     -- one search, and nothing about it depends on getting escaping right.
     AND position('<' IN p_value) = 0
     AND p_value !~ '[[:cntrl:]]'
     AND CASE p_name
           WHEN 'class' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'aria-labelledby' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'aria-describedby' THEN
             p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}( [A-Za-z][A-Za-z0-9_-]{0,63})*$'
           WHEN 'id' THEN p_value ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
           WHEN 'aria-hidden' THEN p_value IN ('true', 'false')
           WHEN 'dir' THEN p_value IN ('ltr', 'rtl', 'auto')
           WHEN 'lang' THEN p_value ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'
           WHEN 'role' THEN p_value ~ '^[a-z]+(-[a-z]+)*$'
           WHEN 'aria-label' THEN length(p_value) > 0
           ELSE false
         END
$$;

/**
 * The first structural problem in one structured node and everything under it,
 * or NULL.
 *
 * Recursive, and depth-bounded for the same reason the renderer's serializer is:
 * a document is a stored value, so how deeply it nests is not an author's choice
 * but whatever was last written into the row.
 *
 * `p_fields` is the declaration list flattened to name → type. Checking a field
 * node against it is not about rendering — the node carries its own type and the
 * renderer needs nothing else — it is about the editor and the renderer
 * describing the same value. A field declared `text` and used by a `richtext`
 * node offers an author a plain box for something that will be sanitized as
 * markup, and neither half is wrong enough to be the one that gets fixed.
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
    -- Unknown keys are refused, matching the strict object schemas in
    -- @cms/schema. A key this version does not define is the part of the
    -- document that was written for a different reader, and continuing without
    -- it publishes a section missing whatever that key was for.
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

    IF p_node ? 'attributes' THEN
      IF COALESCE(jsonb_typeof(p_node -> 'attributes'), 'missing') <> 'object' THEN
        RETURN format('has a <%s> whose attributes are not an object', tag);
      END IF;
      FOR attribute_name, attribute_value IN SELECT * FROM jsonb_each(p_node -> 'attributes') LOOP
        IF NOT app.is_structured_attribute(attribute_name) THEN
          RETURN format('has a <%s> carrying %s, which is not an attribute an element node may carry',
                        tag, attribute_name);
        END IF;
        IF COALESCE(jsonb_typeof(attribute_value), 'missing') <> 'string' THEN
          RETURN format('has a <%s> whose %s is not a string', tag, attribute_name);
        END IF;
        IF NOT app.is_structured_attribute_value(attribute_name, attribute_value #>> '{}') THEN
          RETURN format('has a <%s> whose %s is not a usable value', tag, attribute_name);
        END IF;
      END LOOP;
    END IF;

    IF p_node ? 'children' THEN
      IF COALESCE(jsonb_typeof(p_node -> 'children'), 'missing') <> 'array' THEN
        RETURN format('has a <%s> whose children are not a list', tag);
      END IF;
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
    SELECT k INTO stray FROM jsonb_object_keys(p_node) AS k
     WHERE k NOT IN ('type', 'field') LIMIT 1;
    IF stray IS NOT NULL THEN
      RETURN format('has a %s node carrying %s, which this schema version does not define',
                    node_type, stray);
    END IF;

    -- The same grammar a slot id has, because both are identifiers that cross
    -- the same boundaries, and two grammars for one idea is one grammar nobody
    -- remembers.
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
    RETURN NULL;
  END IF;

  -- `icon` and `repeat` land here, and that is the intended answer for now: ADR
  -- 0007 needs a compiled sprite before an icon name means anything, and a
  -- vocabulary the database accepts but the renderer omits is a definition that
  -- saves, publishes, and appears with a hole in it.
  RETURN format('has a node of type %s, which is not a node type', node_type);
END
$$;

/**
 * The first structural problem in a stored section definition's *model*, or NULL.
 *
 * Answers the whole question — which model, and is it well formed — in one call,
 * so the authoring command and the manifest builder ask it the same way and
 * cannot drift into asking different halves.
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

-- ------------------------------------------------------------- authoring --
--
-- Dropped and recreated rather than replaced, because three new parameters make
-- a different signature: `CREATE OR REPLACE` would leave the old one in place
-- and every existing thirteen-argument call would become ambiguous between the
-- two. The grants are restated for the same reason — a freshly created function
-- starts with EXECUTE to PUBLIC, which is wider than what 0013 left behind.

DROP FUNCTION IF EXISTS app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean);

CREATE FUNCTION app.upsert_section_def_version(
  p_slug text, p_name text, p_category text,
  p_source_html text, p_source_css text, p_compiled_css text,
  p_compiled_ast jsonb, p_slots jsonb,
  p_render_hash text, p_sanitizer_policy_version int, p_css_policy_version int,
  p_changelog text, p_carries_trusted_code boolean DEFAULT false,
  p_definition_kind text DEFAULT 'legacy',
  p_structured_doc jsonb DEFAULT NULL,
  p_structured_schema_version int DEFAULT NULL
) RETURNS TABLE (section_def_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def_id uuid; next_version int; defect text;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may author section definitions' USING ERRCODE = 'CMS02';
  END IF;

  IF NOT app.is_section_slug(p_slug) THEN
    RAISE EXCEPTION 'this section cannot be saved: %s is not a usable slug — lowercase letters, '
                    'digits and single dashes, up to 64 characters', COALESCE(p_slug, 'null')
      USING ERRCODE = 'CMS04';
  END IF;

  -- All three gates, before anything is written, in the order a reader would
  -- ask them: which model, then the artifact that model uses, then the
  -- stylesheet both models share.
  defect := app.structured_section_defect(p_definition_kind, p_structured_doc,
                                          p_structured_schema_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be saved: its structured definition %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  defect := app.render_ast_defect(p_compiled_ast, p_sanitizer_policy_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be saved: its compiled template %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  defect := app.compiled_css_defect(p_compiled_css, p_css_policy_version,
                                    '.cms-section--' || p_slug);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be saved: its compiled CSS %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  SELECT id INTO def_id FROM public.section_defs WHERE scope = 'global' AND slug = p_slug;
  IF def_id IS NULL THEN
    INSERT INTO public.section_defs (scope, slug, name, category, created_by)
    VALUES ('global', p_slug, p_name, COALESCE(p_category, ''), actor) RETURNING id INTO def_id;
  ELSE
    UPDATE public.section_defs SET name = p_name, category = COALESCE(p_category, '') WHERE id = def_id;
  END IF;

  SELECT COALESCE(max(v.version), 0) + 1 INTO next_version
    FROM public.section_def_versions v WHERE v.section_def_id = def_id;

  INSERT INTO public.section_def_versions
    (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
     sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code,
     changelog, created_by, definition_kind, structured_doc, structured_schema_version)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''),
          COALESCE(p_compiled_css, ''), p_compiled_ast, COALESCE(p_slots, '[]'::jsonb),
          p_sanitizer_policy_version, p_css_policy_version, p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor,
          p_definition_kind, p_structured_doc, p_structured_schema_version);

  PERFORM app.write_audit(NULL, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version,
                                             'definition_kind', p_definition_kind,
                                             'sanitizer_policy_version', p_sanitizer_policy_version,
                                             'css_policy_version', p_css_policy_version,
                                             'structured_schema_version', p_structured_schema_version));
  RETURN QUERY SELECT def_id, next_version;
END
$$;

-- ------------------------------------------------- preview and publication --

CREATE OR REPLACE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; sections jsonb; expected int; resolved int; stale text;
BEGIN
  SELECT pv.id, pv.content, pv.meta, pv.page_id, pv.site_id, p.title, p.slug
    INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id = pv.page_id
   WHERE pv.id = p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;

  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);

  SELECT jsonb_agg(jsonb_build_object(
           'def', jsonb_build_object(
             'section_def_id', d.id, 'version', dv.version, 'slug', d.slug,
             'compiled_ast', dv.compiled_ast,
             'css', dv.compiled_css, 'slots', dv.slots,
             'render_hash', dv.render_hash,
             'sanitizer_policy_version', dv.sanitizer_policy_version,
             'css_policy_version', dv.css_policy_version,
             -- The discriminator travels with the definition. A manifest that
             -- carried the document but not the kind would make the renderer
             -- work out which model it was looking at, which is the inference
             -- this column exists to remove.
             'definition_kind', dv.definition_kind,
             'structured_doc', dv.structured_doc,
             'structured_schema_version', dv.structured_schema_version),
           'instance', jsonb_build_object(
             'label', item.value ->> 'label',
             'hidden', COALESCE((item.value ->> 'hidden')::boolean, false),
             'hidden_at', COALESCE(item.value -> 'hidden_at', '[]'::jsonb),
             'values', COALESCE(item.value -> 'values', '{}'::jsonb))
         ) ORDER BY item.ordinality)
    INTO sections
    FROM jsonb_array_elements(v.content) WITH ORDINALITY AS item(value, ordinality)
    JOIN public.section_defs d ON d.id = (item.value ->> 'section_def_id')::uuid
    JOIN public.section_def_versions dv
      ON dv.section_def_id = d.id AND dv.version = (item.value ->> 'section_def_version')::int;

  resolved := COALESCE(jsonb_array_length(sections), 0);
  IF resolved <> expected THEN
    RAISE EXCEPTION 'page version % refers to % sections but only % resolve',
      p_page_version_id, expected, resolved USING ERRCODE = 'CMS04';
  END IF;

  SELECT string_agg(DISTINCT (s -> 'def' ->> 'slug') || ' (' || defect || ')', '; ')
    INTO stale
    FROM jsonb_array_elements(COALESCE(sections, '[]'::jsonb)) AS s
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        app.structured_section_defect(s -> 'def' ->> 'definition_kind',
                                      s -> 'def' -> 'structured_doc',
                                      (s -> 'def' ->> 'structured_schema_version')::int),
        app.render_ast_defect(s -> 'def' -> 'compiled_ast',
                              (s -> 'def' ->> 'sanitizer_policy_version')::int),
        app.compiled_css_defect(s -> 'def' ->> 'css',
                                (s -> 'def' ->> 'css_policy_version')::int,
                                '.cms-section--' || (s -> 'def' ->> 'slug'))) AS defect) AS d
   WHERE d.defect IS NOT NULL;
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'this page uses a section that needs revalidating: %', stale
      USING ERRCODE = 'CMS04';
  END IF;

  RETURN jsonb_build_object(
    'page', jsonb_build_object('id', v.page_id, 'version_id', v.id, 'title', v.title,
                               'path', app.page_path(v.slug)),
    'meta', COALESCE(v.meta, '{}'::jsonb),
    'sections', COALESCE(sections, '[]'::jsonb));
END
$$;

REVOKE ALL ON FUNCTION app.current_structured_schema_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_structured_tag(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_structured_void_tag(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_structured_attribute(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_structured_attribute_value(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_node_defect(jsonb, int, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.structured_section_defect(text, jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.current_structured_schema_version() TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int) TO cms_authenticated_user;

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
  FOR obj IN
    SELECT c.oid::regclass AS rel FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('app', 'public_api') AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW %s OWNER TO cms_migration_owner', obj.rel);
  END LOOP;
END
$$;
