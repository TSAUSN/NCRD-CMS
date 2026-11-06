-- 0017 — three more audit findings in the gate's plumbing rather than its logic.
--
--   * CMS-DB-02. app.section_definitions_needing_revalidation() is SECURITY
--     DEFINER and was left EXECUTE to PUBLIC, so any role holding USAGE on
--     schema app could read section-definition ids, slugs, versions, policy
--     versions and defect text straight out of two tables it was deliberately
--     given no SELECT on and which carry RLS. cms_worker_app demonstrably
--     could. cms_site_app could not, but only because it happens to hold no
--     USAGE on the schema — which is an accident of another grant, not a
--     decision about this function.
--
--   * CMS-DB-05. 0015 wrote `CREATE OR REPLACE VIEW
--     app_section_slugs_out_of_grammar` with no schema qualification, so the
--     one artefact for finding pre-grammar slugs landed in `public` under the
--     migration-runner's own role, unreachable by the name the migration's
--     comment implies and outside the ownership invariant 0002 establishes.
--
--   * CMS-DB-07. render_ast_defect refused an html node carrying the
--     reconstruction sentinel but not one carrying an ordinary `{{token}}`.
--     The compiler never emits either: every token it recognises becomes a slot
--     node. A stored AST with one saves, previews and publishes, and then the
--     renderer's reconstruction finds more slot sites than the node list has
--     and renders the section as nothing — a definition that is accepted
--     everywhere and appears nowhere.

REVOKE ALL ON FUNCTION app.section_definitions_needing_revalidation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.section_definitions_needing_revalidation() TO cms_authenticated_user;

-- The view, in the schema its own comment assumed. Dropping the misplaced copy
-- loses nothing: it is a view over section_defs, and the rows stay where they
-- are.
DROP VIEW IF EXISTS public.app_section_slugs_out_of_grammar;

CREATE OR REPLACE VIEW app.section_slugs_out_of_grammar AS
  SELECT id, slug FROM public.section_defs WHERE NOT app.is_section_slug(slug);

REVOKE ALL ON app.section_slugs_out_of_grammar FROM PUBLIC;
GRANT SELECT ON app.section_slugs_out_of_grammar TO cms_authenticated_user;

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
      -- Any token the compiler's own scanner would recognise, not just the
      -- reconstruction sentinel. The pattern is TOKEN from compile.ts spelled
      -- in POSIX: a compiled AST cannot carry one, because every token the
      -- compiler matched became a slot node or was dropped with a problem.
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
