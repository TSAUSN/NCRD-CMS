-- 0018 — revalidation becomes a command, and the CSS gate learns what a string is.
--
-- Two findings, both about the same thing from opposite ends: derived security
-- artifacts are written and read by code that has to agree with the compiler,
-- and where it does not agree, it either refuses good work or accepts changes
-- nobody can later account for.
--
--   * `app.compiled_css_defect` found rule preludes with
--     `regexp_matches(p_css, '([^{}]*)\{', 'g')`, which does not know that a
--     brace can be inside a string. `scopeCss` emits both
--     `.cms-section--d .a[data-tpl="{"]{…}` and `.cms-section--d .a::before
--     {content:"{"}` from CSS an author wrote correctly, and one brace inside
--     one string threw the scan out of phase for the whole rest of the
--     stylesheet: every later prelude was a fragment of a declaration, and the
--     gate refused the definition with `has a selector outside its section:
--     content:"`. This is CMS-DB-04 again — the gate refusing its own
--     compiler's output and blaming the author — one layer down, in the step
--     that decides what a prelude even is. String-awareness also makes SQL
--     agree with the browser in the other direction: `content:"} body{…} "` is
--     one declaration value to a CSS parser, and the old scan read a `body`
--     rule inside it that does not exist.
--
--   * `pnpm db:revalidate --apply` rewrote `compiled_ast`, `compiled_css`,
--     `render_hash` and both policy-version columns of an already-published,
--     immutable version with a bare UPDATE from the migration connection. Those
--     five columns are the entire security decision about a section: what
--     markup renders, what stylesheet ships, and which policies vouched for
--     them. Changing them wrote nothing to `audit_log`, so a later reader
--     asking "why does this row's render hash differ from the one the release
--     notes quote?" had no answer available anywhere in the database. 0003 says
--     of `app.write_audit` that it is "the only writer of audit_log … so
--     history can only be written next to the change that caused it" — and the
--     way to keep that true is for the change to be a command, not an UPDATE
--     that happens to be issued by a role privileged enough to get away with
--     it. So the rewrite moves into a SECURITY DEFINER function that re-runs
--     both gates on what it is about to store, writes the audit row in the same
--     transaction, and refuses a no-op rather than recording one.

/**
 * The prelude of every rule in a stylesheet: the text between the end of the
 * previous block and the `{` that opens this one.
 *
 * Returns NULL — not an empty array — when the stylesheet ends inside a string,
 * because at that point the scan has no idea where anything ends and neither
 * does a browser. The caller turns that into a defect. Reporting it as "no
 * rules found" would have made an unterminated string the quietest way past
 * this gate, which is the opposite of what string-awareness is for.
 *
 * Like `app.selector_branches`, this walks characters and tracks just enough
 * state to be right about structure, and deliberately not enough to pretend it
 * is a CSS parser. `validateCompiledCss` is still the check that holds.
 */
CREATE OR REPLACE FUNCTION app.css_rule_preludes(p_css text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  preludes text[] := ARRAY[]::text[];
  current text := '';
  quote text := NULL;
  ch text;
  i int := 1;
  n int;
BEGIN
  IF p_css IS NULL THEN RETURN preludes; END IF;
  n := length(p_css);
  -- A WHILE loop, not FOR, for the same reason 0016 gives: the escape case
  -- consumes two characters, and a PL/pgSQL integer FOR loop resets its counter
  -- every iteration, so advancing it by hand there looks right and does nothing.
  WHILE i <= n LOOP
    ch := substr(p_css, i, 1);
    -- An escape is one token to a CSS tokenizer whatever follows it, so `\{`
    -- is a character in an identifier and never opens a block. Checked before
    -- the quote state, because a `\"` inside a string does not end it either.
    IF ch = '\' THEN
      current := current || substr(p_css, i, 2);
      i := i + 2;
      CONTINUE;
    END IF;
    IF quote IS NOT NULL THEN
      IF ch = quote THEN quote := NULL; END IF;
      current := current || ch;
      i := i + 1;
      CONTINUE;
    END IF;
    IF ch = '"' OR ch = '''' THEN
      quote := ch;
    ELSIF ch = '{' THEN
      preludes := preludes || current;
      current := '';
      i := i + 1;
      CONTINUE;
    ELSIF ch = '}' THEN
      -- Whatever accumulated since the opening brace was declarations, not a
      -- prelude. Dropping it here is what the old regexp achieved by refusing
      -- to match across a brace.
      current := '';
      i := i + 1;
      CONTINUE;
    END IF;
    current := current || ch;
    i := i + 1;
  END LOOP;
  IF quote IS NOT NULL THEN RETURN NULL; END IF;
  RETURN preludes;
END
$$;

CREATE OR REPLACE FUNCTION app.compiled_css_defect(p_css text, p_policy_version int, p_scope text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE preludes text[]; prelude text; branch text;
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

  preludes := app.css_rule_preludes(p_css);
  IF preludes IS NULL THEN
    RETURN 'has a string that is never closed, so where its rules end is anybody''s guess';
  END IF;

  FOREACH prelude IN ARRAY preludes LOOP
    IF prelude IS NULL OR btrim(prelude) = '' THEN CONTINUE; END IF;
    IF btrim(prelude) LIKE '@%' THEN
      IF btrim(prelude) !~* '^@(media|supports|container|layer)\M' THEN
        RETURN format('contains @%s, which the CSS policy does not emit',
                      split_part(btrim(ltrim(btrim(prelude), '@')), ' ', 1));
      END IF;
      CONTINUE;
    END IF;
    -- Branches, not commas. `:is(.b, .c)` is one branch with an argument list
    -- inside it, and splitting there refused compiled CSS that was correct.
    FOREACH branch IN ARRAY app.selector_branches(prelude) LOOP
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

-- --------------------------------------------------------- revalidation --

/**
 * Rewrite one stored version's derived artifacts under the current policies.
 *
 * In place rather than as version N+1, because a recompile is not an editorial
 * change: the source is identical and the rendered output is identical, so a
 * new version would put a meaningless entry in every definition's history and
 * unpin nothing. But "the output is identical" is a claim about a compiler the
 * database cannot run, so this re-runs both gates on the artifacts it has been
 * handed before storing them — the same two calls `upsert_section_def_version`
 * makes, for the same reason: a pre-compiled artifact arriving as an argument
 * is a claim about the caller, not a property of the row.
 *
 * Returns the id of the audit row it wrote, or NULL when the stored artifacts
 * already match and there was nothing to do. Refusing to record a no-op is what
 * makes a second revalidation run provably silent rather than merely quiet.
 */
CREATE OR REPLACE FUNCTION app.revalidate_section_def_version(
  p_section_def_id uuid, p_version int,
  p_compiled_ast jsonb, p_compiled_css text, p_render_hash text,
  p_sanitizer_policy_version int, p_css_policy_version int
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE slug text; stored RECORD; defect text;
BEGIN
  SELECT d.slug INTO slug FROM public.section_defs d WHERE d.id = p_section_def_id;
  IF slug IS NULL THEN
    RAISE EXCEPTION 'no such section definition: %', p_section_def_id USING ERRCODE = 'CMS03';
  END IF;
  -- A slug that predates `app.is_section_slug` has no scope to confine a
  -- stylesheet to, so there is no artifact this function could store that would
  -- be correct. Renaming it changes a published class name, which is an
  -- editorial decision and not one a repair script gets to make.
  IF NOT app.is_section_slug(slug) THEN
    RAISE EXCEPTION 'this section cannot be revalidated: % is not a usable slug, so its CSS has '
                    'no scope to be confined to — rename it from the editor', slug
      USING ERRCODE = 'CMS04';
  END IF;

  -- Locked for the rest of the transaction. The caller read `source_html` and
  -- `source_css` to produce these artifacts, and a concurrent save between that
  -- read and this write would leave derived columns describing a source that no
  -- longer exists.
  SELECT v.compiled_ast, v.compiled_css, v.render_hash,
         v.sanitizer_policy_version, v.css_policy_version
    INTO stored
    FROM public.section_def_versions v
   WHERE v.section_def_id = p_section_def_id AND v.version = p_version
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such section definition version: % v%', p_section_def_id, p_version
      USING ERRCODE = 'CMS03';
  END IF;

  defect := app.render_ast_defect(p_compiled_ast, p_sanitizer_policy_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be revalidated: its recompiled template %', defect
      USING ERRCODE = 'CMS04';
  END IF;
  defect := app.compiled_css_defect(p_compiled_css, p_css_policy_version,
                                    '.cms-section--' || slug);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be revalidated: its recompiled CSS %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  IF stored.compiled_ast IS NOT DISTINCT FROM p_compiled_ast
     AND stored.compiled_css IS NOT DISTINCT FROM p_compiled_css
     AND stored.render_hash IS NOT DISTINCT FROM p_render_hash
     AND stored.sanitizer_policy_version IS NOT DISTINCT FROM p_sanitizer_policy_version
     AND stored.css_policy_version IS NOT DISTINCT FROM p_css_policy_version THEN
    RETURN NULL;
  END IF;

  UPDATE public.section_def_versions v
     SET compiled_ast = p_compiled_ast,
         compiled_css = p_compiled_css,
         render_hash = p_render_hash,
         sanitizer_policy_version = p_sanitizer_policy_version,
         css_policy_version = p_css_policy_version
   WHERE v.section_def_id = p_section_def_id AND v.version = p_version;

  -- 'migration', not 'user': revalidation is the second half of a policy bump,
  -- run with the migration credential by whoever deployed it, and there is no
  -- product user to attribute it to. The audit_log shape constraint agrees —
  -- only a 'user' row may name an actor — so inventing one is not available
  -- even if it were honest.
  --
  -- Both the before and the after are recorded. The question this row exists to
  -- answer is "why does this version render differently from the artifact the
  -- release notes quote", and only the pair answers it.
  RETURN app.write_audit(
    NULL, 'migration', NULL, 'section_def.revalidate', 'section_def', p_section_def_id, NULL, NULL,
    jsonb_build_object(
      'slug', slug,
      'version', p_version,
      'before', jsonb_build_object(
        'render_hash', stored.render_hash,
        'sanitizer_policy_version', stored.sanitizer_policy_version,
        'css_policy_version', stored.css_policy_version),
      'after', jsonb_build_object(
        'render_hash', p_render_hash,
        'sanitizer_policy_version', p_sanitizer_policy_version,
        'css_policy_version', p_css_policy_version)));
END
$$;

-- No application role may call this. Rewriting the derived artifacts of an
-- immutable version is an operator act carried out with the migration
-- credential; an editor changes a section by saving a new version, which is
-- what `upsert_section_def_version` is for. The owner reaches it by owning it.
REVOKE ALL ON FUNCTION app.revalidate_section_def_version(uuid, int, jsonb, text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.css_rule_preludes(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.compiled_css_defect(text, int, text) FROM PUBLIC;

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
