-- 0013 — authored CSS and compiled CSS are different things, stored separately.
--
-- They were one column, and the confusion ran the whole length of the system.
-- The seed passed `compiled.css` as `p_source_css`, so `section_def_versions.
-- source_css` held scoped output; `build_render_manifest_internal` published
-- that column directly, which happened to work precisely *because* it was
-- already compiled; and the revalidation CLI read the same column believing it
-- was authored source and recompiled it — scoping already-scoped CSS a second
-- time. Nothing had told anyone which of the two a given row contained.
--
-- The split:
--
--   source_css    what a person wrote. Never published.
--   compiled_css  what scopeCss produced from it. The only thing published.
--   css_policy_version  which policy compiled it, NULL when unknown.
--
-- Existing rows keep rendering exactly what they render today: their
-- `source_css` is copied into `compiled_css`, because compiled is what it
-- actually is. What cannot be recovered is the authored form — `source_css` is
-- lossy in that direction and no amount of parsing brings back the selector an
-- author typed before it was prefixed. So `css_policy_version` is left NULL for
-- them, which the gate below reads as "needs an author" rather than guessing.
-- No row loses data and no row is silently re-scoped.

ALTER TABLE section_def_versions ADD COLUMN compiled_css text NOT NULL DEFAULT '';
ALTER TABLE section_def_versions ADD COLUMN css_policy_version int;

COMMENT ON COLUMN section_def_versions.source_css IS
  'CSS as authored. Kept for editing and audit; never published.';
COMMENT ON COLUMN section_def_versions.compiled_css IS
  'Scoped, policy-checked CSS. The only CSS a public manifest carries.';
COMMENT ON COLUMN section_def_versions.css_policy_version IS
  'Which CSS policy produced compiled_css. NULL means the provenance is unknown '
  '(a row from before 0013), which needs an author rather than a guess.';

-- What every existing row publishes today, preserved byte for byte.
UPDATE section_def_versions SET compiled_css = source_css WHERE compiled_css = '';

CREATE OR REPLACE FUNCTION app.current_css_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 4 $$;

CREATE OR REPLACE FUNCTION app.current_sanitizer_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 3 $$;

/**
 * What is structurally wrong with a piece of compiled CSS, or NULL.
 *
 * The database cannot re-run the CSS policy — that needs a tokenizer — but it
 * can check the two properties the policy's output always has, and refuse
 * anything claiming to be compiled that does not have them. A caller handing
 * over raw authored CSS alongside a valid AST is the case this catches.
 */
CREATE OR REPLACE FUNCTION app.compiled_css_defect(p_css text, p_policy_version int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_policy_version IS NULL THEN
    RETURN 'has no CSS policy version, so nothing knows whether it was ever checked';
  END IF;
  IF p_policy_version IS DISTINCT FROM app.current_css_policy_version() THEN
    RETURN format('was compiled under CSS policy version %s, but this database requires version %s',
                  p_policy_version, app.current_css_policy_version());
  END IF;
  IF p_css IS NULL THEN
    RETURN 'is missing';
  END IF;
  IF p_css = '' THEN
    RETURN NULL; -- a definition with no CSS is a definition with no CSS
  END IF;
  -- Compiled CSS ships inside a <style> element, and the policy guarantees it
  -- contains no `<` at all. A `<` here means this did not come from the policy.
  IF position('<' IN p_css) > 0 THEN
    RETURN 'contains markup, so it did not come from the CSS policy';
  END IF;
  IF p_css ~* '@(import|charset|namespace|document)' THEN
    RETURN 'contains an at-rule the CSS policy removes';
  END IF;
  -- Every rule the policy emits is prefixed with the section scope. Unscoped
  -- CSS in a shared stylesheet restyles other people's sections.
  IF p_css !~ '\.cms-section' AND p_css !~ '^@' THEN
    RETURN 'is not scoped to a section, so it did not come from the CSS policy';
  END IF;
  RETURN NULL;
END
$$;

-- --------------------------------------------------------------- authoring --

DROP FUNCTION IF EXISTS app.upsert_section_def_version(text, text, text, text, text, jsonb, jsonb, text, int, text, boolean);

CREATE FUNCTION app.upsert_section_def_version(
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

  defect := app.compiled_css_defect(p_compiled_css, p_css_policy_version);
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
             -- The compiled column, never the authored one. Publishing
             -- `source_css` only ever worked because the seed was putting
             -- compiled CSS in it.
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
                                (s -> 'def' ->> 'css_policy_version')::int)) AS defect) AS d
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

-- --------------------------------------------------------------- detection --

DROP FUNCTION IF EXISTS app.section_definitions_needing_revalidation();

CREATE FUNCTION app.section_definitions_needing_revalidation()
RETURNS TABLE (section_def_id uuid, slug text, version int,
               sanitizer_policy_version int, css_policy_version int,
               defect text, authored_css_recoverable boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.slug, dv.version, dv.sanitizer_policy_version, dv.css_policy_version,
         COALESCE(app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
                  app.compiled_css_defect(dv.compiled_css, dv.css_policy_version)),
         -- A row from before 0013 has an unknown authored form: its source_css
         -- column may hold compiled output, and recompiling that would scope it
         -- twice. Saying so is the whole point of the column.
         dv.css_policy_version IS NOT NULL
    FROM public.section_def_versions dv
    JOIN public.section_defs d ON d.id = dv.section_def_id
   WHERE COALESCE(app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
                  app.compiled_css_defect(dv.compiled_css, dv.css_policy_version)) IS NOT NULL
   ORDER BY d.slug, dv.version
$$;

REVOKE ALL ON FUNCTION app.current_css_policy_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.compiled_css_defect(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.upsert_section_def_version(text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.current_css_policy_version(),
  app.section_definitions_needing_revalidation()
TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION
  app.upsert_section_def_version(text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean)
TO cms_authenticated_user;

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
