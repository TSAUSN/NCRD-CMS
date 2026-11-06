-- 0029 — a section definition can belong to one site, and saying so is a command.
--
-- SPEC §6.5 asks the creator for "Save as… global vs this-site scope", and the
-- table has supported it since 0001: `section_defs.scope` is a two-valued enum,
-- `site_id` is constrained to be present exactly when the scope is `site`, there
-- are separate unique indexes per scope, and the read policy already lets a site
-- member see their own site's definitions. Everything was in place except the
-- one thing that decides what actually gets stored — the command — which
-- hard-coded `scope = 'global'` and refused anybody who was not a super admin.
--
-- So the scope choice was unreachable, and the authorization it implies had
-- never been written down anywhere. Writing it down is most of this migration:
--
--   * A **global** definition appears in every site's library and can be added
--     to any page on the installation. That is an installation-wide decision and
--     stays a super admin's, exactly as before.
--   * A **site** definition appears in one site's library only. That is a
--     decision about one tenant, and a site admin is the person who owns it.
--     `app.can_administer_site` is the predicate that already answers this
--     question for every other per-site command, so it answers this one too
--     rather than a second spelling of the same idea being invented here.
--
-- THE SLUG COLLISION, WHICH IS A CSS PROBLEM AND NOT A NAMING ONE
--
-- A definition's compiled stylesheet is confined to `.cms-section--<slug>`, and
-- that selector is derived from the slug alone — `sectionScopeSelector` in the
-- renderer, and `app.compiled_css_defect(…, '.cms-section--' || p_slug)` here.
-- Two definitions sharing a slug therefore share a scope selector.
--
-- Across two *sites* that is harmless: a rendered page carries the stylesheets
-- of the sections on that page, pages belong to one site, and no document ever
-- holds both. Between a site definition and a global one it is not harmless at
-- all, because both are offered in the same library and a single page can use
-- both — at which point each one's rules apply to the other's markup, and the
-- section that renders wrong is whichever happens to come second in the
-- stylesheet. Nothing in the page would say why.
--
-- The bounded fix is to keep the selector single-valued where it can collide:
-- a site definition may not take a slug a global definition already holds, and a
-- global definition may not take a slug any site definition holds. Both refuse
-- with a sentence naming the other scope, because "that name is taken" without
-- saying where is a message that sends somebody looking through their own site's
-- library for a definition that is not in it.
--
-- The old thirteen- and sixteen-argument signatures are left alone. This is a
-- new overload with two more parameters, so every existing caller — the seeds,
-- the importer, the tests written against it — keeps compiling and keeps
-- meaning `global`, which is what they have always meant.

CREATE FUNCTION app.upsert_section_def_version(
  p_slug text, p_name text, p_category text,
  p_source_html text, p_source_css text, p_compiled_css text,
  p_compiled_ast jsonb, p_slots jsonb,
  p_render_hash text, p_sanitizer_policy_version int, p_css_policy_version int,
  p_changelog text, p_carries_trusted_code boolean,
  p_definition_kind text, p_structured_doc jsonb, p_structured_schema_version int,
  p_scope text, p_site_id uuid
) RETURNS TABLE (section_def_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def_id uuid; next_version int; defect text; clash text;
BEGIN
  actor := app.require_actor();

  IF p_scope NOT IN ('global', 'site') THEN
    RAISE EXCEPTION 'this section cannot be saved: % is not a scope', COALESCE(p_scope, 'null')
      USING ERRCODE = 'CMS04';
  END IF;
  IF (p_scope = 'site') <> (p_site_id IS NOT NULL) THEN
    RAISE EXCEPTION 'this section cannot be saved: a site section names one site and a global section names none'
      USING ERRCODE = 'CMS04';
  END IF;

  -- Authorization before validation, so a caller who may not do this at all
  -- learns that rather than learning which of their attributes was malformed.
  IF p_scope = 'global' THEN
    IF NOT app.is_super_admin() THEN
      RAISE EXCEPTION 'only a super admin may author a section every site can use' USING ERRCODE = 'CMS02';
    END IF;
  ELSE
    IF NOT (app.is_super_admin() OR app.can_administer_site(p_site_id)) THEN
      RAISE EXCEPTION 'only a site admin may author a section for this site' USING ERRCODE = 'CMS02';
    END IF;
  END IF;

  IF NOT app.is_section_slug(p_slug) THEN
    RAISE EXCEPTION 'this section cannot be saved: %s is not a usable slug — lowercase letters, '
                    'digits and single dashes, up to 64 characters', COALESCE(p_slug, 'null')
      USING ERRCODE = 'CMS04';
  END IF;

  -- The collision rule above. Asked before anything is written, and asked in
  -- both directions from one query so the two cases cannot drift apart.
  SELECT CASE WHEN d.scope = 'global' THEN 'every site' ELSE 'another site' END INTO clash
    FROM public.section_defs d
   WHERE d.slug = p_slug
     AND d.status = 'active'
     AND ((p_scope = 'site' AND d.scope = 'global')
       OR (p_scope = 'global' AND d.scope = 'site'))
   LIMIT 1;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be saved: a section called % is already available to %, '
                    'and two sections with the same short name would share one stylesheet',
                    p_slug, clash
      USING ERRCODE = 'CMS04';
  END IF;

  -- The same three gates as the sixteen-argument form, in the same order and
  -- calling the same functions. Copied rather than restated: a paraphrase of a
  -- gate is a second gate, and the two are free to disagree.
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

  IF p_scope = 'global' THEN
    SELECT id INTO def_id FROM public.section_defs WHERE scope = 'global' AND slug = p_slug;
  ELSE
    SELECT id INTO def_id FROM public.section_defs
     WHERE scope = 'site' AND site_id = p_site_id AND slug = p_slug;
  END IF;

  IF def_id IS NULL THEN
    INSERT INTO public.section_defs (scope, site_id, slug, name, category, created_by)
    VALUES (p_scope::section_scope, p_site_id, p_slug, p_name, COALESCE(p_category, ''), actor)
    RETURNING id INTO def_id;
  ELSE
    UPDATE public.section_defs SET name = p_name, category = COALESCE(p_category, '') WHERE id = def_id;
  END IF;

  SELECT COALESCE(max(v.version), 0) + 1 INTO next_version
    FROM public.section_def_versions v WHERE v.section_def_id = def_id;

  -- Column list, COALESCEs and audit call copied verbatim from 0019's form,
  -- with only the two scope facts added to the audit detail. A paraphrase here
  -- would be a second way of writing the same row, and the last time a function
  -- in this repository was paraphrased instead of copied it silently changed
  -- how the field list reached the node walk and every structured definition
  -- stopped saving.
  INSERT INTO public.section_def_versions
    (section_def_id, version, source_html, source_css, compiled_css, compiled_ast, slots,
     sanitizer_policy_version, css_policy_version, render_hash, carries_trusted_code,
     changelog, created_by, definition_kind, structured_doc, structured_schema_version)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''),
          COALESCE(p_compiled_css, ''), p_compiled_ast, COALESCE(p_slots, '[]'::jsonb),
          p_sanitizer_policy_version, p_css_policy_version, p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor,
          p_definition_kind, p_structured_doc, p_structured_schema_version);

  PERFORM app.write_audit(p_site_id, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version,
                                             'scope', p_scope, 'site_id', p_site_id,
                                             'definition_kind', p_definition_kind,
                                             'sanitizer_policy_version', p_sanitizer_policy_version,
                                             'css_policy_version', p_css_policy_version,
                                             'structured_schema_version', p_structured_schema_version));
  RETURN QUERY SELECT def_id, next_version;
END
$$;

REVOKE ALL ON FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int, text, uuid) TO cms_authenticated_user;

ALTER FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int, text, uuid) OWNER TO cms_migration_owner;
