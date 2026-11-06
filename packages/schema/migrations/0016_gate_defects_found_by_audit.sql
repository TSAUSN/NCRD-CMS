-- 0016 — two defects in the storage gate itself, found by an audit swarm.
--
-- Neither is a new attack surface. Both are the gate failing at its own job:
-- one refuses artifacts the compiler legitimately produces, the other quietly
-- stops checking. No policy version changes, because nothing about what a valid
-- artifact *is* has changed — only whether these functions can tell.
--
--   * `render_ast_defect` NULL-poisoned itself. An html node with no `value`
--     key made `jsonb_typeof(node -> 'value')` NULL, so `<> 'string'` was NULL
--     rather than true and the guard did not fire; then `markup || NULL` made
--     the accumulator NULL for the rest of the walk, and the script-plus-slots
--     check at the end — `markup ~* '<\s*script[\s/>]'` — evaluated to NULL and
--     was skipped. A forged AST could carry a script element and editable slots
--     past the one rule that says it may not, by prefixing the node list with
--     `{"kind":"html"}`. This is the fourth three-valued-logic bug in this
--     schema; every comparison against `jsonb_typeof` here is now COALESCEd.
--
--   * `compiled_css_defect` split selector lists on every comma, including the
--     ones inside `:is()`, `:not()`, `:where()` and attribute selectors. So
--     `.cms-section--d .a:is(.b, .c)` — which `scopeCss` emits and
--     `validateCompiledCss` accepts — was split into `.cms-section--d .a:is(.b`
--     and `.c)`, and the second branch is not rooted at the scope. The gate
--     refused CSS its own compiler had just produced, with a message blaming
--     the author for a selector they wrote correctly.

/**
 * The branches of a selector list, split on the commas that separate branches.
 *
 * A comma inside `(…)`, `[…]` or a string separates arguments, not branches.
 * PostgreSQL has no selector parser, so this walks the characters and tracks
 * depth — enough to split correctly, and deliberately not enough to pretend it
 * understands selectors. `validateCompiledCss` is still the check that holds.
 */
CREATE OR REPLACE FUNCTION app.selector_branches(p_prelude text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  branches text[] := ARRAY[]::text[];
  current text := '';
  depth int := 0;
  quote text := NULL;
  ch text;
  i int := 1;
  n int;
BEGIN
  IF p_prelude IS NULL THEN RETURN branches; END IF;
  n := length(p_prelude);
  -- A WHILE loop, not FOR: the backslash case consumes two characters, and a
  -- PL/pgSQL integer FOR loop resets its counter every iteration, so advancing
  -- it by hand there would have looked right and done nothing.
  WHILE i <= n LOOP
    ch := substr(p_prelude, i, 1);
    IF quote IS NOT NULL THEN
      -- Inside a string. Only the matching quote ends it, and a backslash
      -- escapes whatever follows, including that quote.
      IF ch = '\' THEN
        current := current || substr(p_prelude, i, 2);
        i := i + 2;
        CONTINUE;
      END IF;
      IF ch = quote THEN quote := NULL; END IF;
    ELSIF ch = '"' OR ch = '''' THEN
      quote := ch;
    ELSIF ch = '(' OR ch = '[' THEN
      depth := depth + 1;
    ELSIF ch = ')' OR ch = ']' THEN
      depth := greatest(depth - 1, 0);
    ELSIF ch = ',' AND depth = 0 THEN
      branches := branches || current;
      current := '';
      i := i + 1;
      CONTINUE;
    END IF;
    current := current || ch;
    i := i + 1;
  END LOOP;
  RETURN branches || current;
END
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
  IF p_ast IS NULL OR COALESCE(jsonb_typeof(p_ast), 'missing') <> 'object' THEN
    RETURN 'is not a compiled section';
  END IF;
  IF COALESCE(jsonb_typeof(p_ast -> 'nodes'), 'missing') <> 'array' THEN
    RETURN 'has no node list';
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_ast -> 'nodes') LOOP
    IF COALESCE(jsonb_typeof(node), 'missing') <> 'object' THEN
      RETURN format('node %s is not an object', ord);
    END IF;

    IF node ->> 'kind' = 'html' THEN
      -- COALESCE, because a missing key gives jsonb_typeof NULL, and NULL is
      -- not "not a string" — it is "no answer", which this IF used to treat as
      -- permission to continue.
      IF COALESCE(jsonb_typeof(node -> 'value'), 'missing') <> 'string' THEN
        RETURN format('node %s is markup with no value', ord);
      END IF;
      -- The marker the renderer reconstructs with is itself a valid slot token,
      -- so a genuinely compiled AST can never carry one in an html node.
      IF node ->> 'value' ~ '\{\{\s*__cms_slot_[0-9]+__\s*\}\}' THEN
        RETURN format('node %s contains a marker no compiler emits', ord);
      END IF;
      -- Belt and braces: the guard above already refuses a non-string, but a
      -- NULL reaching this accumulator disables every check that reads it, and
      -- that failure is silent.
      markup := markup || COALESCE(node ->> 'value', '');

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
  -- typed field become executable code. The compiler asks this same question of
  -- these same concatenated values, so the two cannot disagree.
  IF has_slot AND COALESCE(markup, '') ~* '<\s*script[\s/>]' THEN
    RETURN 'mixes a script element with editable slots, which approval cannot make safe';
  END IF;

  RETURN NULL;
END
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

REVOKE ALL ON FUNCTION app.selector_branches(text) FROM PUBLIC;

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
