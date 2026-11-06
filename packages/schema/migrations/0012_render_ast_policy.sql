-- 0012 — the database will not store or publish a render AST it cannot vouch for.
--
-- Sanitizer policy version 2 changed the compiled AST: every slot now records
-- the *sink* it lands in — element text, a quoted attribute, a URL attribute, a
-- style attribute — and each sink has its own escaper. Version 1 recorded
-- nothing, so the renderer guessed "element text" for all of them, which is the
-- wrong escaper for an attribute and no escaper at all for a tag name. A value
-- bound for `href` shipped as a live `javascript:` URL; one bound for a bare
-- attribute position introduced an `onclick`.
--
-- The compiler in @cms/renderer refuses to produce such a definition now. That
-- is necessary and not sufficient: `upsert_section_def_version` takes a
-- pre-compiled AST as an argument, so "the compiler would not have made this"
-- is a claim about the caller, not a property of the row. The same reasoning
-- that put readiness in the database (0010, 0011) applies here — the database
-- checks the structure it is handed, independently of who handed it over.
--
-- What it can check: that the AST is shaped like a compiled section, that its
-- policy version is current, that every slot names a sink, and that a slot
-- emitting markup is not sitting in an attribute. What it cannot check is
-- whether that sink is the one an HTML tokenizer would agree with — that needs
-- a tokenizer, and the one that matters lives in the renderer package. So the
-- guarantee is: no row reaches storage or publication carrying a *self-declared*
-- unsafe context, and no stale row is published at all.

CREATE OR REPLACE FUNCTION app.current_sanitizer_policy_version() RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$ SELECT 2 $$;

/**
 * The first structural problem in a compiled render AST, or NULL.
 *
 * A sentence rather than a boolean, because this ends up in an author's error
 * message and "invalid AST" with no position costs somebody an afternoon.
 */
CREATE OR REPLACE FUNCTION app.render_ast_defect(p_ast jsonb, p_policy_version int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node jsonb; ord int := 0; ctx text; kind text;
BEGIN
  IF p_policy_version IS DISTINCT FROM app.current_sanitizer_policy_version() THEN
    RETURN format('was compiled under sanitizer policy version %s, but this database requires version %s',
                  COALESCE(p_policy_version::text, 'null'),
                  app.current_sanitizer_policy_version());
  END IF;
  IF p_ast IS NULL OR jsonb_typeof(p_ast) <> 'object' THEN
    RETURN 'is not a compiled section';
  END IF;
  -- COALESCE is load-bearing: jsonb_typeof(NULL) is NULL, and `NULL <> 'array'`
  -- is NULL rather than true, so an AST with no node list walked straight past
  -- the guard that existed to catch it.
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

    ELSIF node ->> 'kind' = 'slot' THEN
      IF COALESCE(node ->> 'slotId', '') = '' THEN
        RETURN format('node %s is a slot with no id', ord);
      END IF;
      kind := COALESCE(node ->> 'slotKind', '');
      ctx  := node ->> 'context';
      IF ctx IS NULL THEN
        RETURN format('slot %s does not say what kind of place it sits in', node ->> 'slotId');
      END IF;
      -- The four sinks the renderer has an escaper for. Anything else — an
      -- event handler, an unquoted value, a tag name — is refused here rather
      -- than left for the renderer to decline at request time.
      IF ctx NOT IN ('element-text', 'quoted-attribute', 'url-attribute', 'style-attribute') THEN
        RETURN format('slot %s sits in %s, which cannot be rendered safely',
                      node ->> 'slotId', ctx);
      END IF;
      IF kind IN ('richtext', 'link', 'button', 'image') AND ctx <> 'element-text' THEN
        RETURN format('slot %s is a %s slot in %s, where markup cannot go',
                      node ->> 'slotId', kind, ctx);
      END IF;

    ELSE
      RETURN format('node %s has an unknown kind %s', ord, COALESCE(node ->> 'kind', 'null'));
    END IF;
    ord := ord + 1;
  END LOOP;

  RETURN NULL;
END
$$;

-- ------------------------------------------------------------- authoring --

CREATE OR REPLACE FUNCTION app.upsert_section_def_version(
  p_slug text, p_name text, p_category text,
  p_source_html text, p_source_css text, p_compiled_ast jsonb, p_slots jsonb,
  p_render_hash text, p_sanitizer_policy_version int, p_changelog text,
  p_carries_trusted_code boolean DEFAULT false
) RETURNS TABLE (section_def_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def_id uuid; next_version int; defect text;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may author section definitions' USING ERRCODE = 'CMS02';
  END IF;

  -- Before anything is written. A definition with a blocking problem is not a
  -- draft to be fixed later: it is a template that would inject, and storing it
  -- means some later code path has to remember not to render it.
  defect := app.render_ast_defect(p_compiled_ast, p_sanitizer_policy_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be saved: its compiled template %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  SELECT id INTO def_id FROM public.section_defs WHERE scope = 'global' AND slug = p_slug;
  IF def_id IS NULL THEN
    INSERT INTO public.section_defs (scope, slug, name, category, created_by)
    VALUES ('global', p_slug, p_name, COALESCE(p_category, ''), actor) RETURNING id INTO def_id;
  ELSE
    UPDATE public.section_defs SET name = p_name, category = COALESCE(p_category, '') WHERE id = def_id;
  END IF;

  -- Editing a definition always creates version N+1; pages pinned to N keep
  -- rendering N until someone deliberately upgrades them (SPEC §6.5).
  SELECT COALESCE(max(v.version), 0) + 1 INTO next_version
    FROM public.section_def_versions v WHERE v.section_def_id = def_id;

  INSERT INTO public.section_def_versions
    (section_def_id, version, source_html, source_css, compiled_ast, slots,
     sanitizer_policy_version, render_hash, carries_trusted_code, changelog, created_by)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''), p_compiled_ast,
          COALESCE(p_slots, '[]'::jsonb), p_sanitizer_policy_version, p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor);

  PERFORM app.write_audit(NULL, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version,
                                             'sanitizer_policy_version', p_sanitizer_policy_version));
  RETURN QUERY SELECT def_id, next_version;
END
$$;

-- ------------------------------------------------- preview and publication --
--
-- build_render_manifest_internal is the one place both the editor's preview and
-- the publication command resolve section definitions, which makes it the one
-- place to refuse a stale or unsafe one. A page pinned to a definition compiled
-- under the old policy does not render and does not publish; it reports which
-- definition, so the fix is `pnpm db:revalidate` rather than a hunt.

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
             'compiled_ast', dv.compiled_ast, 'css', dv.source_css, 'slots', dv.slots,
             'render_hash', dv.render_hash,
             'sanitizer_policy_version', dv.sanitizer_policy_version),
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

  -- Every definition this page pins must be one the current renderer can vouch
  -- for. Checked here rather than at render time so a stale definition is a
  -- refusal an author can act on, not a section that silently disappears.
  SELECT string_agg(DISTINCT (s -> 'def' ->> 'slug') || ' (' ||
                    app.render_ast_defect(s -> 'def' -> 'compiled_ast',
                                          (s -> 'def' ->> 'sanitizer_policy_version')::int) || ')', '; ')
    INTO stale
    FROM jsonb_array_elements(COALESCE(sections, '[]'::jsonb)) AS s
   WHERE app.render_ast_defect(s -> 'def' -> 'compiled_ast',
                               (s -> 'def' ->> 'sanitizer_policy_version')::int) IS NOT NULL;
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

-- ------------------------------------------------------------- detection --
--
-- What `pnpm db:revalidate` reads, and what an operator can run by hand.

CREATE OR REPLACE FUNCTION app.section_definitions_needing_revalidation()
RETURNS TABLE (section_def_id uuid, slug text, version int,
               sanitizer_policy_version int, defect text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.slug, dv.version, dv.sanitizer_policy_version,
         app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version)
    FROM public.section_def_versions dv
    JOIN public.section_defs d ON d.id = dv.section_def_id
   WHERE app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version) IS NOT NULL
   ORDER BY d.slug, dv.version
$$;

REVOKE ALL ON FUNCTION app.current_sanitizer_policy_version() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.render_ast_defect(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.section_definitions_needing_revalidation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  app.current_sanitizer_policy_version(),
  app.section_definitions_needing_revalidation()
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
