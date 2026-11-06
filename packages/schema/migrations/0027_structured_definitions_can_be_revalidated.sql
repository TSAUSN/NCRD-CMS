-- 0027 — a stored structured definition gains the revalidation route 0019 said
-- it did not need.
--
-- 0019 closes its header with a deliberate exclusion: structured rows are
-- "Deliberately *not*" wired into `app.section_definitions_needing_revalidation()`,
-- because that list is consumed by `pnpm db:revalidate`, which recompiles a row
-- from its `source_html`, and "a structured definition has no source_html to
-- recompile. Listing one there would hand the repair tool a row whose repair is
-- to overwrite it with an empty legacy definition."
--
-- The reasoning was right about the repair and wrong twice over about the
-- report.
--
--   * The exclusion was never actually written down. 0020's listing function
--     selects on `app.render_ast_defect` and `app.compiled_css_defect`, and
--     neither of those reads `definition_kind` — so a structured row is
--     excluded only for as long as both of those gates happen to be quiet
--     about it. Move the CSS policy version and it is not: the row is listed
--     among the legacy ones, `revalidateDefinitions` reads its empty
--     `source_html`, and `compileSection('')` returns
--     `{"nodes":[],"policyVersion":4,"cssPolicyVersion":6}` with no blocking
--     problems — which is precisely the artifact 0019's own CHECK constraint
--     requires a structured row to carry, so nothing refuses the write. The
--     row keeps its document, gains the interpolation compiler's render hash
--     over an empty template, and gets an audit row saying it was revalidated.
--     The exact overwrite 0019 named, carried out under a defect message about
--     CSS.
--
--   * With that closed, a structured row still has no route forward at all.
--     `structured_schema_version` exists so a schema bump can report which
--     definitions need revalidation instead of silently changing live output
--     (SPEC §6.5), but a row below the current version is refused by
--     `app.structured_section_defect` in the authoring command and in the
--     manifest builder, appears in no list, and has no command that could move
--     it. It is accepted nowhere and visible nowhere — the CMS-DB-07 shape
--     0020 names — and the only reason the estate has not hit it is that
--     `app.current_structured_schema_version()` has moved exactly once, before
--     any row existed at version 1.
--
-- So the listing function learns which model each row is written in and asks
-- the structured gate as well, and the rewrite becomes a command of its own,
-- modelled on 0018's: pinned search_path, no application role able to call it,
-- both the structured gate and the two artifact gates re-run on what it is
-- about to store, the audit row written in the same transaction, and a no-op
-- refused rather than recorded.

-- --------------------------------------------------------------- detection --

DROP FUNCTION IF EXISTS app.section_definitions_needing_revalidation();

/**
 * Every stored version this database would refuse, and why.
 *
 * Three columns wider than 0020's. `definition_kind` travels with the row for
 * the reason 0019 gives for putting it in the manifest: the caller has to know
 * which model this is before it can know which recompile it is allowed to run,
 * and working that out from which artifact looks populated is the inference the
 * column was added to remove. `structured_schema_version` travels with it
 * because it is the stamp a structured repair moves, and a report that showed
 * only the two policy versions would describe a row by the two numbers its
 * repair does not touch.
 *
 * All three gates, not the first one that answers, exactly as 0020 has it — and
 * the same three, in the same order, that `app.build_render_manifest_internal`
 * COALESCEs. A row listed here is a row a page pinned to it cannot preview or
 * publish, and the two lists staying equal is what makes `pnpm db:revalidate`
 * the answer to the manifest builder's refusal rather than a second opinion.
 */
CREATE FUNCTION app.section_definitions_needing_revalidation()
RETURNS TABLE (section_def_id uuid, slug text, version int, definition_kind text,
               sanitizer_policy_version int, css_policy_version int,
               structured_schema_version int,
               defect text, authored_css_recoverable boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, d.slug, dv.version, dv.definition_kind,
         dv.sanitizer_policy_version, dv.css_policy_version, dv.structured_schema_version,
         concat_ws('; ',
           app.structured_section_defect(dv.definition_kind, dv.structured_doc,
                                         dv.structured_schema_version),
           app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version),
           app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                   '.cms-section--' || d.slug)),
         dv.css_policy_version IS NOT NULL
    FROM public.section_def_versions dv
    JOIN public.section_defs d ON d.id = dv.section_def_id
   WHERE app.structured_section_defect(dv.definition_kind, dv.structured_doc,
                                       dv.structured_schema_version) IS NOT NULL
      OR app.render_ast_defect(dv.compiled_ast, dv.sanitizer_policy_version) IS NOT NULL
      OR app.compiled_css_defect(dv.compiled_css, dv.css_policy_version,
                                 '.cms-section--' || d.slug) IS NOT NULL
   ORDER BY d.slug, dv.version
$$;

-- ------------------------------------------------------------ revalidation --

/**
 * Rewrite one stored structured version's derived artifacts under the current
 * policies.
 *
 * 0018's function, one model along, and deliberately a second function rather
 * than three more optional arguments on the first: the two models write
 * different columns, and one function that wrote whichever set its arguments
 * suggested would decide which model a row is by looking at what the caller
 * passed — the inference `definition_kind` exists to remove.
 *
 * The document is an argument because a version stamp lives inside it as well
 * as beside it, and the two are checked against each other. That is the only
 * reason: this function stores the document it is handed and never reads it as
 * anything, so bringing a row forward is the caller's re-derivation and the
 * gates below are what decide whether the result may be stored. It cannot
 * stamp a row above `app.current_structured_schema_version()`, which is what
 * keeps "the row is at the version this database implements" a fact rather
 * than a claim by whoever ran the repair.
 *
 * Returns the id of the audit row it wrote, or NULL when the stored artifacts
 * already match and there was nothing to do. Refusing to record a no-op is what
 * makes a second revalidation run provably silent rather than merely quiet.
 */
CREATE OR REPLACE FUNCTION app.revalidate_structured_def_version(
  p_section_def_id uuid, p_version int,
  p_structured_doc jsonb, p_structured_schema_version int,
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

  -- The ceiling, stated before anything is read, and stated separately from the
  -- gate below even though the gate would also refuse it. This is the sentence
  -- that names the invariant: a repair may carry a row up to the version this
  -- database implements and may never carry it past one, because a stamp is a
  -- claim that some reader here has vouched for the document and there is no
  -- reader here for a version this build does not know.
  IF p_structured_schema_version IS NULL
     OR p_structured_schema_version > app.current_structured_schema_version() THEN
    RAISE EXCEPTION 'this section cannot be revalidated: it would be stamped at structured schema '
                    'version %, and this database implements version %',
                    COALESCE(p_structured_schema_version::text, 'null'),
                    app.current_structured_schema_version()
      USING ERRCODE = 'CMS04';
  END IF;

  -- Locked for the rest of the transaction. The caller read `structured_doc`
  -- and `source_css` to produce these artifacts, and a concurrent save between
  -- that read and this write would leave derived columns describing a source
  -- that no longer exists.
  SELECT v.definition_kind, v.structured_doc, v.structured_schema_version,
         v.compiled_ast, v.compiled_css, v.render_hash,
         v.sanitizer_policy_version, v.css_policy_version
    INTO stored
    FROM public.section_def_versions v
   WHERE v.section_def_id = p_section_def_id AND v.version = p_version
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such section definition version: % v%', p_section_def_id, p_version
      USING ERRCODE = 'CMS03';
  END IF;

  -- A legacy row is not a structured one with the document missing. Writing a
  -- document into it would be the 0019 overwrite in the other direction, and
  -- `app.revalidate_section_def_version` is where a legacy row is repaired.
  IF stored.definition_kind IS DISTINCT FROM 'structured' THEN
    RAISE EXCEPTION 'this section cannot be revalidated as a structured one: % v% is written in '
                    'the % model', slug, p_version, COALESCE(stored.definition_kind, 'null')
      USING ERRCODE = 'CMS04';
  END IF;

  defect := app.structured_section_defect('structured', p_structured_doc,
                                          p_structured_schema_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be revalidated: its recompiled document %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  -- The empty compiled section, checked like any other. A structured row has to
  -- carry one — 0019's CHECK constraint says so — but it is still a stored
  -- artifact carrying its own `policyVersion`, and this command moves the
  -- column that vouches for it, so it goes through the same gate the
  -- interpolation model's does. The node list is checked here as well as by the
  -- constraint so a caller handing over a populated template gets a sentence
  -- and a CMS04 rather than a constraint violation.
  IF NOT COALESCE(p_compiled_ast -> 'nodes' = '[]'::jsonb, false) THEN
    RAISE EXCEPTION 'this section cannot be revalidated: a structured version stores no compiled '
                    'template, and this is not an empty one'
      USING ERRCODE = 'CMS04';
  END IF;
  defect := app.render_ast_defect(p_compiled_ast, p_sanitizer_policy_version);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be revalidated: its compiled template %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  defect := app.compiled_css_defect(p_compiled_css, p_css_policy_version,
                                    '.cms-section--' || slug);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'this section cannot be revalidated: its recompiled CSS %', defect
      USING ERRCODE = 'CMS04';
  END IF;

  IF stored.structured_doc IS NOT DISTINCT FROM p_structured_doc
     AND stored.structured_schema_version IS NOT DISTINCT FROM p_structured_schema_version
     AND stored.compiled_ast IS NOT DISTINCT FROM p_compiled_ast
     AND stored.compiled_css IS NOT DISTINCT FROM p_compiled_css
     AND stored.render_hash IS NOT DISTINCT FROM p_render_hash
     AND stored.sanitizer_policy_version IS NOT DISTINCT FROM p_sanitizer_policy_version
     AND stored.css_policy_version IS NOT DISTINCT FROM p_css_policy_version THEN
    RETURN NULL;
  END IF;

  UPDATE public.section_def_versions v
     SET structured_doc = p_structured_doc,
         structured_schema_version = p_structured_schema_version,
         compiled_ast = p_compiled_ast,
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
  -- Both the before and the after are recorded, and the structured schema
  -- version is in both. The question this row exists to answer is "why does
  -- this version render differently from the artifact the release notes quote",
  -- and for a structured definition the version stamp is the half of the answer
  -- the two policy versions cannot give.
  RETURN app.write_audit(
    NULL, 'migration', NULL, 'section_def.revalidate_structured', 'section_def',
    p_section_def_id, NULL, NULL,
    jsonb_build_object(
      'slug', slug,
      'version', p_version,
      'before', jsonb_build_object(
        'render_hash', stored.render_hash,
        'structured_schema_version', stored.structured_schema_version,
        'sanitizer_policy_version', stored.sanitizer_policy_version,
        'css_policy_version', stored.css_policy_version),
      'after', jsonb_build_object(
        'render_hash', p_render_hash,
        'structured_schema_version', p_structured_schema_version,
        'sanitizer_policy_version', p_sanitizer_policy_version,
        'css_policy_version', p_css_policy_version)));
END
$$;

-- No application role may call the rewrite, for 0018's reason: rewriting the
-- derived artifacts of an immutable version is an operator act carried out with
-- the migration credential, and an editor changes a section by saving a new
-- version. The owner reaches it by owning it. The listing function keeps the
-- grant 0017 gave it — reading which definitions are stale is not a rewrite,
-- and an operator reads it through `pnpm db:revalidate`.
REVOKE ALL ON FUNCTION app.revalidate_structured_def_version(
  uuid, int, jsonb, int, jsonb, text, text, int, int) FROM PUBLIC;
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
