-- 0014 — slot ids are a grammar, scripts exclude slots, and compiled CSS is
-- checked branch by branch.
--
-- Three more bypasses, and the same lesson each time: a stored value was being
-- read as though something upstream had already vetted it.
--
--   * A slot id is not a label. It was interpolated into the marker used to
--     reconstruct a template for re-scanning, so an id of `a}}</p><div title="`
--     closed its own marker and moved every later slot into a different
--     tokenizer context. Ids are now a narrow grammar, checked here as well as
--     in the compiler, and the reconstruction no longer uses them at all.
--
--   * `<script>` and editable slots do not mix. HTML's script-data escaped and
--     double-escaped states mean an apparent `</script>` sometimes closes the
--     element and sometimes does not, so a slot after one was classified as
--     ordinary text and executed. Rather than implement those states, the rule
--     is now structural: a template with a script element may not have slots.
--
--   * Compiled CSS could claim a policy version it did not satisfy. The old
--     check let anything starting with `@` through, treated a substring
--     `.cms-section` as proof of scoping, and never looked past a comma.
--
-- WHAT THIS FILE CAN AND CANNOT ESTABLISH
--
-- PostgreSQL has no CSS tokenizer and no HTML tokenizer, so these checks are
-- structural: they refuse things that are definitely wrong and they cannot
-- confirm that something is definitely right. The authoritative validation is
-- `validateCompiledCss` in @cms/renderer, which the renderer runs before
-- emitting a stylesheet and which fails closed on anything it does not like.
-- The database's job here is to stop a bad row being *stored*, so the failure
-- shows up when someone saves rather than when a reader loads a page.

CREATE OR REPLACE FUNCTION app.current_sanitizer_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 4 $$;

CREATE OR REPLACE FUNCTION app.current_css_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 5 $$;

/** The slot-id grammar, the same one @cms/schema enforces. */
CREATE OR REPLACE FUNCTION app.is_slot_id(p_id text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_id IS NOT NULL AND p_id ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$'
$$;

CREATE OR REPLACE FUNCTION app.render_ast_defect(p_ast jsonb, p_policy_version int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node jsonb; ord int := 0; ctx text; kind text; id text; has_slot boolean := false; markup text := '';
BEGIN
  IF p_policy_version IS DISTINCT FROM app.current_sanitizer_policy_version() THEN
    RETURN format('was compiled under sanitizer policy version %s, but this database requires version %s',
                  COALESCE(p_policy_version::text, 'null'),
                  app.current_sanitizer_policy_version());
  END IF;
  IF p_ast IS NULL OR jsonb_typeof(p_ast) <> 'object' THEN
    RETURN 'is not a compiled section';
  END IF;
  IF COALESCE(jsonb_typeof(p_ast -> 'nodes'), 'missing') <> 'array' THEN
    RETURN 'has no node list';
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_ast -> 'nodes') LOOP
    IF jsonb_typeof(node) <> 'object' THEN
      RETURN format('node %s is not an object', ord);
    END IF;

    IF node ->> 'kind' = 'html' THEN
      IF jsonb_typeof(node -> 'value') <> 'string' THEN
        RETURN format('node %s is markup with no value', ord);
      END IF;
      -- The marker the renderer reconstructs with is itself a valid slot token,
      -- so a genuinely compiled AST can never carry one in an html node.
      IF node ->> 'value' ~ '\{\{\s*__cms_slot_[0-9]+__\s*\}\}' THEN
        RETURN format('node %s contains a marker no compiler emits', ord);
      END IF;
      markup := markup || (node ->> 'value');

    ELSIF node ->> 'kind' = 'slot' THEN
      id := node ->> 'slotId';
      IF NOT app.is_slot_id(id) THEN
        RETURN format('node %s has a slot id that is not a usable one: %s', ord, COALESCE(id, 'null'));
      END IF;
      has_slot := true;
      kind := COALESCE(node ->> 'slotKind', '');
      IF kind NOT IN ('text', 'richtext', 'image', 'link', 'button', 'repeat') THEN
        RETURN format('slot %s has kind %s, which is not a slot kind', id, kind);
      END IF;
      ctx := node ->> 'context';
      IF ctx IS NULL THEN
        RETURN format('slot %s does not say what kind of place it sits in', id);
      END IF;
      IF ctx NOT IN ('element-text', 'quoted-attribute', 'url-attribute', 'style-attribute') THEN
        RETURN format('slot %s sits in %s, which cannot be rendered safely', id, ctx);
      END IF;
      IF kind IN ('richtext', 'link', 'button', 'image') AND ctx <> 'element-text' THEN
        RETURN format('slot %s is a %s slot in %s, where markup cannot go', id, kind, ctx);
      END IF;

    ELSE
      RETURN format('node %s has an unknown kind %s', ord, COALESCE(node ->> 'kind', 'null'));
    END IF;
    ord := ord + 1;
  END LOOP;

  -- A script element and an editable slot in the same template. Approval is a
  -- decision about markup an author pasted; it was never a decision to let a
  -- typed field become executable code.
  IF has_slot AND markup ~* '<\s*script[\s/>]' THEN
    RETURN 'mixes a script element with editable slots, which approval cannot make safe';
  END IF;

  RETURN NULL;
END
$$;

/**
 * Structural checks on compiled CSS.
 *
 * Strengthened as far as SQL honestly goes, and no further. Every selector
 * branch — including the ones inside a conditional at-rule and the ones after a
 * comma — must be rooted at the section scope followed by a real boundary, so
 * `.cms-section-evil` is a different class and `@media all{body{…}}` no longer
 * walks past the check by starting with `@`. What this cannot do is tokenize:
 * `validateCompiledCss` in the renderer is the check that actually holds, and
 * the renderer runs it before emitting anything.
 */
DROP FUNCTION IF EXISTS app.compiled_css_defect(text, int);

CREATE FUNCTION app.compiled_css_defect(p_css text, p_policy_version int, p_scope text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE prelude text; branch text; body text;
BEGIN
  IF p_policy_version IS NULL THEN
    RETURN 'has no CSS policy version, so nothing knows whether it was ever checked';
  END IF;
  IF p_policy_version IS DISTINCT FROM app.current_css_policy_version() THEN
    RETURN format('was compiled under CSS policy version %s, but this database requires version %s',
                  p_policy_version, app.current_css_policy_version());
  END IF;
  IF p_css IS NULL THEN RETURN 'is missing'; END IF;
  IF p_css = '' THEN RETURN NULL; END IF;

  IF position('<' IN p_css) > 0 THEN
    RETURN 'contains markup, so it did not come from the CSS policy';
  END IF;
  IF p_css ~* '@\s*(import|charset|namespace|document)' THEN
    RETURN 'contains an at-rule the CSS policy removes';
  END IF;
  IF p_css ~* '(expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:|-moz-binding)' THEN
    RETURN 'contains an active value the CSS policy removes';
  END IF;
  -- Any url() naming a host rather than a path. Approximate — an escaped
  -- identifier spells `url` in ways this cannot see — which is why the renderer
  -- re-checks with a tokenizer before emitting.
  IF p_css ~* 'url\s*\(\s*["'']?\s*([a-z][a-z0-9+.-]*:)?//' THEN
    RETURN 'fetches from another site';
  END IF;

  -- Every selector branch, at every nesting level. The text before each `{` is
  -- a prelude: either an at-rule condition, or a selector list to check.
  -- Any run of non-brace characters followed by `{`. Anchoring on the previous
  -- brace looked tidier and was wrong: the match consumed that brace, so the
  -- next prelude had nothing to anchor against and a nested `body{…}` inside an
  -- at-rule was never examined.
  FOR prelude IN
    SELECT (regexp_matches(p_css, '([^{}]*)\{', 'g'))[1]
  LOOP
    IF prelude IS NULL OR btrim(prelude) = '' THEN CONTINUE; END IF;
    IF btrim(prelude) LIKE '@%' THEN
      IF btrim(prelude) !~* '^@(media|supports|container|layer)\M' THEN
        RETURN format('contains @%s, which the CSS policy does not emit',
                      split_part(btrim(ltrim(btrim(prelude), '@')), ' ', 1));
      END IF;
      CONTINUE;
    END IF;
    FOREACH branch IN ARRAY string_to_array(prelude, ',') LOOP
      branch := btrim(branch);
      IF branch = '' THEN CONTINUE; END IF;
      -- The definition's own scope, then a boundary: anything that cannot
      -- continue an identifier. Merely containing the string was how
      -- `.cms-section-evil` and a trailing `,body` both passed.
      -- Only `.` is regex-special in a scope selector, which is always
      -- `.cms-section--<slug>` with a slug of lowercase letters, digits and
      -- dashes. Escaping just that beats a general escaper nobody can read.
      IF branch !~ ('^' || replace(p_scope, '.', '\.') || '([^A-Za-z0-9_-]|$)') THEN
        RETURN format('has a selector outside its section: %s', branch);
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.is_slot_id(text) FROM PUBLIC;

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


-- The two callers, updated for the scope argument.

CREATE OR REPLACE FUNCTION app.upsert_section_def_version(
  p_slug text, p_name text, p_category text,
  p_source_html text, p_source_css text, p_compiled_css text,
  p_compiled_ast jsonb, p_slots jsonb,
  p_render_hash text, p_sanitizer_policy_version int, p_css_policy_version int,
  p_changelog text, p_carries_trusted_code boolean DEFAULT false
) RETURNS TABLE (section_def_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def_id uuid; next_version int; defect text;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may author section definitions' USING ERRCODE = 'CMS02';
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
     changelog, created_by)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''),
          COALESCE(p_compiled_css, ''), p_compiled_ast, COALESCE(p_slots, '[]'::jsonb),
          p_sanitizer_policy_version, p_css_policy_version, p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor);

  PERFORM app.write_audit(NULL, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version,
                                             'sanitizer_policy_version', p_sanitizer_policy_version,
                                             'css_policy_version', p_css_policy_version));
  RETURN QUERY SELECT def_id, next_version;
END
$$;

DROP FUNCTION IF EXISTS app.section_definitions_needing_revalidation();

CREATE FUNCTION app.section_definitions_needing_revalidation()
RETURNS TABLE (section_def_id uuid, slug text, version int,
               sanitizer_policy_version int, css_policy_version int,
               defect text, authored_css_recoverable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.slug, dv.version, dv.sanitizer_policy_version, dv.css_policy_version,
         COALESCE(app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
                  app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                          '.cms-section--' || d.slug)),
         dv.css_policy_version IS NOT NULL
    FROM public.section_def_versions dv
    JOIN public.section_defs d ON d.id = dv.section_def_id
   WHERE COALESCE(app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
                  app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                          '.cms-section--' || d.slug)) IS NOT NULL
   ORDER BY d.slug, dv.version
$$;

REVOKE ALL ON FUNCTION app.compiled_css_defect(text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.section_definitions_needing_revalidation() TO cms_authenticated_user;

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


-- The manifest builder resolves definitions, so it is where a stale or unscoped
-- artifact has to be caught before it can preview or publish.

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
             'css_policy_version', dv.css_policy_version),
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

ALTER FUNCTION app.build_render_manifest_internal(uuid) OWNER TO cms_migration_owner;
