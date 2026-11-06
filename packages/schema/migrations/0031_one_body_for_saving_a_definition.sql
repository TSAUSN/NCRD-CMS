-- 0031 — one body for saving a section definition, so a thumbnail cannot be
-- forgotten by half of it.
--
-- Two migrations in the same worktree changed `app.upsert_section_def_version`
-- for unrelated reasons and neither could see the other:
--
--   * 0028 gave the sixteen-argument form a `PERFORM app.emit_outbox(…)` so
--     saving a definition asks for its thumbnail in the same transaction.
--   * 0029 added an eighteen-argument overload carrying `scope` and `site_id`,
--     copied from 0019's body, which predates the enqueue.
--
-- Both are correct in isolation and together they are a defect: the section
-- creator calls the overload, so every definition an author makes through the
-- product — the one path a person actually uses — was saved without ever asking
-- for its picture, while the seeds and the importer, which call the older form,
-- got one. A library where the sections you made are the blank cards is a worse
-- outcome than no thumbnails at all, and nothing in either function says which
-- of them is the one that enqueues.
--
-- The repair is structural rather than a third copy of the enqueue. The
-- eighteen-argument form becomes the only implementation, and the sixteen
-- becomes a call to it with the arguments that were always implied — `'global'`
-- and no site, which is exactly what 0019's body hard-coded. There is then one
-- body to change, and a future edit cannot land in one caller's path and not the
-- other's, because there is only one path.
--
-- The body below is 0029's, unchanged, plus 0028's enqueue block copied
-- verbatim. Nothing is paraphrased: the last time a function in this repository
-- was restated rather than copied it silently changed how the field list reached
-- the node walk and every structured definition stopped saving.

CREATE OR REPLACE FUNCTION app.upsert_section_def_version(
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

  -- In this transaction, not after it. A thumbnail requested by the caller once
  -- the save returns is a best-effort second write, and the version that misses
  -- it is a card-shaped hole nothing in the database can find later. Here the
  -- enqueue commits with the version or not at all, and the worker's retry
  -- policy is what makes the picture eventually appear (SPEC §6.5).
  --
  -- The site is named now, where 0028 could only pass NULL: a site-scoped
  -- definition's delivery belongs to that tenant, and a global one still belongs
  -- to none.
  --
  -- The payload carries the slug as well as the identifiers, so a dead-lettered
  -- row is legible to whoever finds it without a join back into authoring
  -- tables the reader may well not be able to select from.
  PERFORM app.emit_outbox(p_site_id, 'section_def.thumbnail_requested',
                          jsonb_build_object('section_def_id', def_id,
                                             'version', next_version,
                                             'slug', p_slug));

  RETURN QUERY SELECT def_id, next_version;
END
$$;

-- The older form, now a call rather than a copy. Its arguments are 0019's body's
-- own hard-coded answers: `scope = 'global'`, no site.
CREATE OR REPLACE FUNCTION app.upsert_section_def_version(
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
BEGIN
  RETURN QUERY SELECT * FROM app.upsert_section_def_version(
    p_slug, p_name, p_category, p_source_html, p_source_css, p_compiled_css,
    p_compiled_ast, p_slots, p_render_hash, p_sanitizer_policy_version,
    p_css_policy_version, p_changelog, p_carries_trusted_code,
    p_definition_kind, p_structured_doc, p_structured_schema_version,
    'global', NULL::uuid);
END
$$;

ALTER FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int, text, uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.upsert_section_def_version(
  text, text, text, text, text, text, jsonb, jsonb, text, int, int, text, boolean,
  text, jsonb, int) OWNER TO cms_migration_owner;
