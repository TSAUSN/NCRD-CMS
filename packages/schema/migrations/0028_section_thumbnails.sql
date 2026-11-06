-- 0028 — a section definition asks for its thumbnail when it is born, and
-- recording one is a command.
--
-- SPEC §6.5 D3: the library page shows "cards with static pre-rendered
-- thumbnails … generated on save by the renderer (screenshot job); live themed
-- preview on card focus/detail only", so that "library first paint ≤1s with
-- thumbnails and no live iframes at rest". `section_def_versions.thumbnail_path`
-- has existed since 0001 and nothing has ever written it. Two things were
-- missing, and they are the two halves of the same mistake.
--
--   * Nothing asked for the work. A thumbnail requested by the admin app after
--     a save is a second write that can be lost — the browser closes, the
--     request times out, the process that would have made the call is the one
--     that crashed — and the outcome is a version with no card and nothing in
--     the database saying so. §6.5's own projection paragraph already names the
--     mechanism: the outbox "drives cache invalidation, sitemap refresh,
--     thumbnail work, and notifications with retries". So the enqueue moves
--     into `app.upsert_section_def_version`, in the same transaction that
--     inserts the version. Either both exist or neither does.
--
--   * Nothing governed the write. `thumbnail_path` names the image the whole
--     library will show for a definition, and the obvious implementation is an
--     UPDATE from whichever role happened to be holding a connection. That is
--     the shape 0018 spent a header on: a derived column rewritten by a bare
--     UPDATE leaves no answer to "why does this card show that picture", and
--     0003 says of `app.write_audit` that it is "the only writer of audit_log …
--     so history can only be written next to the change that caused it". This
--     follows 0018's pattern exactly — SECURITY DEFINER, pinned search_path, no
--     application role but the worker able to call it, the audit row written in
--     the same transaction, and a no-op refused rather than recorded.
--
-- The worker also cannot *read* what it needs. 0002 grants `cms_worker` SELECT
-- on the eleven tables it plans from, and `section_defs` and
-- `section_def_versions` are deliberately not among them — the worker had no
-- business reading authoring content until it had a job that did. Rather than
-- widen a table grant for one job, the job gets one function that returns
-- exactly the columns a thumbnail is drawn from and nothing else.

-- ------------------------------------------------------------------ read --

/**
 * Everything one thumbnail job needs about one stored version, and nothing more.
 *
 * A function rather than a table grant, so the worker's reach into authoring
 * content stays the shape of the job it has: the compiled artifacts and the
 * policy stamps the renderer checks them against, the discriminator that says
 * which model to read, `render_hash` — which is the identity the caller's
 * idempotency guard is built on — and the current `thumbnail_path`, so a second
 * delivery can see its own earlier work without a second round trip.
 *
 * `theme` is the site's published tokens, and it is NULL for every definition
 * this schema currently produces: `app.upsert_section_def_version` inserts with
 * `scope = 'global'`, and a global definition has no site whose theme it could
 * be drawn under. The join is here rather than left for later because the column
 * that makes a site-scoped definition possible is already in `section_defs`, and
 * a caller that had to discover its absence would draw every future site section
 * in the wrong colours until somebody noticed.
 *
 * Every reference is qualified with its table alias. A `RETURNS TABLE` column is
 * an OUT parameter, so a bare `version` inside the body would resolve to the
 * parameter rather than the column and quietly compare a row to itself.
 */
CREATE OR REPLACE FUNCTION app.section_def_version_for_thumbnail(
  p_section_def_id uuid, p_version int
) RETURNS TABLE (
  section_def_id uuid, version int, slug text, name text,
  compiled_ast jsonb, compiled_css text, slots jsonb, render_hash text,
  sanitizer_policy_version int, css_policy_version int,
  definition_kind text, structured_doc jsonb, structured_schema_version int,
  thumbnail_path text, theme jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.id, v.version, d.slug, d.name,
         v.compiled_ast, v.compiled_css, v.slots, v.render_hash,
         v.sanitizer_policy_version, v.css_policy_version,
         v.definition_kind, v.structured_doc, v.structured_schema_version,
         v.thumbnail_path,
         (SELECT tv.tokens
            FROM public.themes t
            JOIN public.theme_versions tv ON tv.id = t.published_version_id
           WHERE t.site_id = d.site_id)
    FROM public.section_defs d
    JOIN public.section_def_versions v ON v.section_def_id = d.id
   WHERE d.id = p_section_def_id AND v.version = p_version
$$;

-- ----------------------------------------------------------------- write --

/**
 * Point one stored version at the image somebody took of it.
 *
 * Returns the id of the audit row it wrote, or NULL when the stored path already
 * matches and there was nothing to do. Refusing to record a no-op is what makes
 * a redelivered thumbnail job provably silent rather than merely quiet — the
 * same property 0018 wanted from a second revalidation run, for the same reason:
 * at-least-once delivery means this function *will* be called twice with the
 * same arguments, and an audit trail where half the rows record nothing having
 * happened is one nobody reads.
 *
 * The key is checked rather than trusted. It arrives as a string from a process
 * that composed it, and it will be concatenated into a URL and, for the
 * filesystem store, into a path — so `..` is refused outright and the grammar is
 * narrowed to what a content-addressed key actually contains. A store that
 * resolves `a/../../etc/x` is a store this column can point outside itself.
 *
 * `'system'`, not `'user'`: a thumbnail is taken by a worker on behalf of
 * nobody, and `audit_log_actor_pairing` refuses a non-user row that names an
 * actor, so inventing one is not available even if it were honest. The worker's
 * self-asserted id goes in the detail, where it reads as the operator hint it is
 * rather than as an authorization fact (threat model §9a).
 */
CREATE OR REPLACE FUNCTION app.record_section_def_thumbnail(
  p_section_def_id uuid, p_version int, p_object_key text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE worker text; slug text; stored text;
BEGIN
  worker := app.require_worker();

  IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
    RAISE EXCEPTION 'a thumbnail needs an object key naming the image that was stored'
      USING ERRCODE = 'CMS04';
  END IF;
  IF position('..' IN p_object_key) > 0 THEN
    RAISE EXCEPTION 'this thumbnail key cannot be recorded: % traverses out of its own prefix',
      p_object_key USING ERRCODE = 'CMS04';
  END IF;
  IF p_object_key !~ '^[a-z0-9][a-z0-9._/-]{0,255}$' THEN
    RAISE EXCEPTION 'this thumbnail key cannot be recorded: % is not a content-addressed object '
                    'key — lowercase letters, digits, dot, dash, underscore and slash', p_object_key
      USING ERRCODE = 'CMS04';
  END IF;

  SELECT d.slug INTO slug FROM public.section_defs d WHERE d.id = p_section_def_id;
  IF slug IS NULL THEN
    RAISE EXCEPTION 'no such section definition: %', p_section_def_id USING ERRCODE = 'CMS03';
  END IF;

  -- Locked for the rest of the transaction. Two workers can hold two deliveries
  -- of the same event, and without this the loser's UPDATE lands after the
  -- winner's and the audit trail records the two writes in the opposite order
  -- from the one that decided the final value.
  SELECT v.thumbnail_path INTO stored
    FROM public.section_def_versions v
   WHERE v.section_def_id = p_section_def_id AND v.version = p_version
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such section definition version: % v%', p_section_def_id, p_version
      USING ERRCODE = 'CMS03';
  END IF;

  IF stored IS NOT DISTINCT FROM p_object_key THEN
    RETURN NULL;
  END IF;

  UPDATE public.section_def_versions v
     SET thumbnail_path = p_object_key
   WHERE v.section_def_id = p_section_def_id AND v.version = p_version;

  -- Both the before and the after. The question this row exists to answer is
  -- "why does this card show that picture", and a row carrying only the new key
  -- answers it for the first write and for no later one.
  RETURN app.write_audit(
    NULL, 'system', NULL, 'section_def.thumbnail', 'section_def', p_section_def_id, NULL, NULL,
    jsonb_build_object('slug', slug, 'version', p_version, 'worker', worker,
                       'before', stored, 'after', p_object_key));
END
$$;

-- -------------------------------------------------- enqueue on authoring --
--
-- `CREATE OR REPLACE` with 0019's exact signature, so the grants 0019 left
-- behind stay attached and the sixteen-argument call sites are untouched. The
-- body is 0019's, unchanged, plus the enqueue at the end.

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

  -- All three gates, before anything is written, in the order a reader would
  -- ask them: which model, then the artifact that model uses, then the
  -- stylesheet both models share.
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
     changelog, created_by, definition_kind, structured_doc, structured_schema_version)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''),
          COALESCE(p_compiled_css, ''), p_compiled_ast, COALESCE(p_slots, '[]'::jsonb),
          p_sanitizer_policy_version, p_css_policy_version, p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor,
          p_definition_kind, p_structured_doc, p_structured_schema_version);

  PERFORM app.write_audit(NULL, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version,
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
  -- `NULL` site: the version this names is global, and `outbox.site_id` is the
  -- tenant a delivery is scoped to. Naming a site here would be inventing one.
  --
  -- The payload carries the slug as well as the identifiers, so a dead-lettered
  -- row is legible to whoever finds it without a join back into authoring
  -- tables the reader may well not be able to select from.
  PERFORM app.emit_outbox(NULL, 'section_def.thumbnail_requested',
                          jsonb_build_object('section_def_id', def_id,
                                             'version', next_version,
                                             'slug', p_slug));

  RETURN QUERY SELECT def_id, next_version;
END
$$;

-- ------------------------------------------------------------- the estate --
--
-- Every version that already exists asks for its thumbnail too. Without this the
-- feature only reaches definitions saved after the deploy, and the library — the
-- one page this work exists for — would show cards for the newest sections and
-- blanks for the 78 imported ones, which is a worse first paint than no
-- thumbnails at all because it looks like a bug rather than a milestone.
--
-- Through `app.emit_outbox` rather than by INSERT, so the outbox keeps having
-- one writer. Restricted to rows with no thumbnail, so re-running the estate is
-- not what this file is for; a version whose picture needs retaking is a job for
-- a command that says so.

DO $$
BEGIN
  PERFORM app.emit_outbox(NULL, 'section_def.thumbnail_requested',
                          jsonb_build_object('section_def_id', v.section_def_id,
                                             'version', v.version,
                                             'slug', d.slug))
     FROM public.section_def_versions v
     JOIN public.section_defs d ON d.id = v.section_def_id
    WHERE v.thumbnail_path IS NULL;
END
$$;

-- ----------------------------------------------------------------- grants --
--
-- The worker and nobody else. An editor does not record a thumbnail — it saves a
-- definition and the queue does the rest — and the admin app reads
-- `thumbnail_path` through the SELECT grant 0002 already gives it on
-- `section_def_versions`, so neither needs anything here.

REVOKE ALL ON FUNCTION app.section_def_version_for_thumbnail(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_section_def_thumbnail(uuid, int, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.section_def_version_for_thumbnail(uuid, int) TO cms_worker;
GRANT EXECUTE ON FUNCTION app.record_section_def_thumbnail(uuid, int, text) TO cms_worker;

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
