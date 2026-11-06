-- 0015 — selector scopes are tokens, and a slug is a grammar.
--
-- CSS policy 6. Two related holes, both from treating selector text as though
-- its characters said what it meant.
--
--   * `.cms-section--d\65 vil` is the class `cms-section--devil`. The validator
--     checked the character after the scope, decided a backslash could not
--     continue an identifier, and passed it — so a definition with slug `d`
--     could style one with slug `devil`. Comments, every-character escaping and
--     escaped punctuation all did the same thing. Worse, authored CSS could
--     *produce* it: `&\65 vil` was scoped by string replacement, which put the
--     scope next to characters the author chose.
--
--   * A slug had no grammar at all. `sectionScopeSelector('a,body')` produced
--     `.cms-section--a,body` — a selector list, one branch of which restyles
--     the document. `.`, `#`, `[`, `>`, whitespace and a backslash were all
--     equally available.
--
-- The renderer now parses selectors with postcss-selector-parser and compares
-- *identifiers*, and inserts the scope as a parsed node rather than by string
-- replacement. This file constrains the slug at its other entrance and tightens
-- what SQL can honestly check.
--
-- WHAT SQL CAN CHECK HERE
--
-- Not much more than before, and it is worth being exact about why. PostgreSQL
-- has no CSS tokenizer, so it cannot resolve `\65` into `e`. What it can do is
-- refuse the two characters that make a resolution possible at the point where
-- the scope ends — a backslash and a comment — because the policy's own
-- serializer never emits either there. That closes this specific family in SQL
-- while `validateCompiledCss` remains the boundary that actually holds.

CREATE OR REPLACE FUNCTION app.current_css_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 6 $$;

/**
 * The section-definition slug grammar, the same one @cms/schema enforces.
 *
 * Lowercase alphanumerics in dash-separated groups, to 64 characters. A slug is
 * concatenated into a CSS class name, so anything that is CSS syntax is not a
 * slug.
 */
CREATE OR REPLACE FUNCTION app.is_section_slug(p_slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_slug IS NOT NULL AND length(p_slug) <= 64
     AND p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
$$;

CREATE OR REPLACE FUNCTION app.compiled_css_defect(p_css text, p_policy_version int, p_scope text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE prelude text; branch text;
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
  IF p_css ~* 'url\s*\(\s*["'']?\s*([a-z][a-z0-9+.-]*:)?//' THEN
    RETURN 'fetches from another site';
  END IF;

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
      -- The scope, then a boundary that is genuinely a boundary. A backslash
      -- and a comment both *continue* the identifier once resolved, which is
      -- how `.cms-section--d\65 vil` and `.cms-section--d/**/evil` read as
      -- classes this definition does not own.
      IF branch !~ ('^' || replace(p_scope, '.', '\.') || '([^A-Za-z0-9_\\/-]|$)') THEN
        RETURN format('has a selector outside its section: %s', branch);
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
END
$$;

-- The slug is checked where a definition is created, so a row cannot arrive
-- from a direction the TypeScript grammar does not cover.

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

  IF NOT app.is_section_slug(p_slug) THEN
    RAISE EXCEPTION 'this section cannot be saved: %s is not a usable slug — lowercase letters, '
                    'digits and single dashes, up to 64 characters', COALESCE(p_slug, 'null')
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

-- Existing definitions predate the slug grammar. Any that do not satisfy it are
-- reported by the revalidation query rather than rewritten: a slug is part of a
-- published class name, so changing one silently changes a live page.

CREATE OR REPLACE VIEW app_section_slugs_out_of_grammar AS
  SELECT id, slug FROM public.section_defs WHERE NOT app.is_section_slug(slug);

REVOKE ALL ON FUNCTION app.is_section_slug(text) FROM PUBLIC;
REVOKE ALL ON app_section_slugs_out_of_grammar FROM PUBLIC;

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
