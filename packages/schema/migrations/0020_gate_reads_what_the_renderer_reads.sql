-- 0020 — three findings the conformance work turned up in the gates.
--
--   * app.render_ast_defect checked the sanitizer policy version it was *told*
--     — the column — and never the one the artifact carries. The renderer reads
--     the artifact's own `policyVersion` and refuses to trust a stored AST that
--     names an older one. So a row whose column says 4 and whose document says
--     1 passed the database completely, saved, previewed, published, and then
--     rendered as nothing. That is the CMS-DB-07 shape again: accepted
--     everywhere, visible nowhere. The gate now reads what the renderer reads.
--
--   * app.selector_branches (0016) resolved a backslash escape only inside a
--     string. `.cms-section--d .a\,b` is one branch — the comma is escaped and
--     part of the class name — and the walk split it in two, so the second
--     half was refused for not being rooted at the scope. scopeCss does emit
--     that form.
--
--   * app.section_definitions_needing_revalidation() COALESCEd the two gates,
--     so a definition stale in both reported only its AST defect and its CSS
--     provenance never appeared at all. An operator reading that output decided
--     what to do about a definition on half the evidence.

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
  WHILE i <= n LOOP
    ch := substr(p_prelude, i, 1);
    -- A backslash escapes the next character wherever it appears, not only
    -- inside a string. `.a\,b` is one class whose name contains a comma, and
    -- splitting there produced a branch that could not be rooted at anything.
    IF ch = '\' THEN
      current := current || substr(p_prelude, i, 2);
      i := i + 2;
      CONTINUE;
    END IF;
    IF quote IS NOT NULL THEN
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
        declared int;
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

  -- The version the artifact carries, not only the one the column claims. The
  -- renderer reads this field and refuses the row when it is stale, so a gate
  -- that ignores it accepts definitions that can never render.
  IF COALESCE(jsonb_typeof(p_ast -> 'policyVersion'), 'missing') <> 'number' THEN
    RETURN 'does not say which sanitizer policy version compiled it';
  END IF;
  declared := (p_ast ->> 'policyVersion')::int;
  IF declared IS DISTINCT FROM app.current_sanitizer_policy_version() THEN
    RETURN format('says it was compiled under sanitizer policy version %s while its row claims %s',
                  declared, p_policy_version);
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_ast -> 'nodes') LOOP
    IF COALESCE(jsonb_typeof(node), 'missing') <> 'object' THEN
      RETURN format('node %s is not an object', ord);
    END IF;

    IF node ->> 'kind' = 'html' THEN
      IF COALESCE(jsonb_typeof(node -> 'value'), 'missing') <> 'string' THEN
        RETURN format('node %s is markup with no value', ord);
      END IF;
      IF node ->> 'value' ~ '\{\{[[:space:]]*[A-Za-z0-9_-]+[[:space:]]*\}\}' THEN
        RETURN format('node %s contains a slot token no compiler leaves in markup', ord);
      END IF;
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

  IF has_slot AND COALESCE(markup, '') ~* '<[[:space:]]*script[[:space:]/>]' THEN
    RETURN 'mixes a script element with editable slots, which approval cannot make safe';
  END IF;

  RETURN NULL;
END
$$;

DROP FUNCTION IF EXISTS app.section_definitions_needing_revalidation();

-- Same columns, same order, same rows. Only the defect text changes.
CREATE FUNCTION app.section_definitions_needing_revalidation()
RETURNS TABLE (section_def_id uuid, slug text, version int,
               sanitizer_policy_version int, css_policy_version int,
               defect text, authored_css_recoverable boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.slug, dv.version, dv.sanitizer_policy_version, dv.css_policy_version,
         -- Both gates, not the first one that answers. A definition stale in
         -- the AST *and* in its CSS provenance reported only the AST, and an
         -- operator then decided what to do about it on half the evidence.
         concat_ws('; ',
           app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
           app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                   '.cms-section--' || d.slug)),
         dv.css_policy_version IS NOT NULL
    FROM public.section_def_versions dv
    JOIN public.section_defs d ON d.id = dv.section_def_id
   WHERE app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version) IS NOT NULL
      OR app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                 '.cms-section--' || d.slug) IS NOT NULL
   ORDER BY d.slug, dv.version
$$;

REVOKE ALL ON FUNCTION app.section_definitions_needing_revalidation() FROM PUBLIC;
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
