-- 0011 — no publication by omission, and a readiness report that must be shaped
-- like one.
--
-- 0010 made the scheduler carry a readiness report and made blocking findings
-- fail closed. Two gaps were left, and both are the same kind of gap: a caller
-- could satisfy the gate without ever saying anything.
--
-- (1) app.publish_page still declared DEFAULT 1, DEFAULT NULL, DEFAULT '[]', so
--     `SELECT app.publish_page(page, revision)` published a page while
--     asserting, in the audit, that the checks found nothing. Nobody wrote that
--     assertion; the signature wrote it for them. A default is the wrong shape
--     for a claim about whether a page was checked, because the honest answer
--     when nobody says is "unknown", and there is no default that means that.
--     The defaults are gone. Every caller states the policy version it ran, the
--     override reason or NULL, and the findings.
--
-- (2) The gate accepted any JSON array. `[{}]`, `[1]`, `[{"severity":"warn"}]`
--     all passed as "no blocking findings" — a report can now be malformed in a
--     way that reads as clean, which is worse than absent. Every element is
--     validated: an object, a non-empty rule, a severity that is exactly
--     'blocking' or 'advisory', and a non-empty human-readable message.
--
-- WHAT THIS DOES AND DOES NOT PROVE
--
-- The database can prove: a report was explicitly supplied; its policy version
-- and structure are valid; declared blocking findings require an override
-- reason; and the invariants that never depend on a report — authorization, the
-- pinned version's ownership, trusted-code approval, the revision CAS, audit,
-- the public projection, and atomicity — hold regardless of what any report
-- says.
--
-- The database cannot prove that the findings it was handed are the ones the
-- TypeScript evaluator would produce for that version. That is not a gap to be
-- closed here: the rules need a rendered page, and rendering is not something
-- SQL does. The boundary is placed instead: the trusted admin server and the
-- worker compute the report with the shared module in @cms/platform, and the
-- browser never holds a database credential and never supplies a report. So the
-- guarantee is "every supported publication surface runs the shared evaluator,
-- and the database refuses anything that surface could not have produced from a
-- passing page" — not "the database recomputed it".

-- ============================================================ report shape ==

/*
 * The first structural problem in a readiness report, or NULL if there is none.
 *
 * Returned as a sentence rather than a boolean because this ends up in an
 * operator's error message, and "malformed readiness report" without a position
 * is a message that costs someone an hour.
 */
CREATE OR REPLACE FUNCTION app.readiness_defect(p_readiness jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT format('finding %s %s', e.ord - 1, e.problem)
    FROM (
      SELECT t.ord,
             CASE
               WHEN jsonb_typeof(t.value) <> 'object'
                 THEN 'is ' || jsonb_typeof(t.value) || ', not an object'
               WHEN COALESCE(btrim(t.value ->> 'rule'), '') = ''
                 THEN 'has no rule'
               WHEN COALESCE(t.value ->> 'severity', '') NOT IN ('blocking', 'advisory')
                 THEN 'has severity ' || COALESCE(quote_literal(t.value ->> 'severity'), 'null')
                      || ', which is neither blocking nor advisory'
               WHEN COALESCE(btrim(t.value ->> 'message'), '') = ''
                 THEN 'has no message for the person reading it'
             END AS problem
        FROM jsonb_array_elements(p_readiness) WITH ORDINALITY AS t(value, ord)
    ) e
   WHERE e.problem IS NOT NULL
   ORDER BY e.ord
   LIMIT 1
$$;

/*
 * One implementation of "is this a readiness report at all?", used by the
 * editor's gate and by the scheduler. Raises; returns nothing useful.
 *
 * '{}' is refused rather than read as "nothing wrong". An empty *object* is not
 * an empty findings list — it is the shape you get when nobody ran the checks.
 * An empty *array* is a report that found nothing, and that is a different
 * claim, made deliberately by a caller that ran the evaluator.
 */
CREATE OR REPLACE FUNCTION app.assert_readiness_shape(p_readiness jsonb, p_policy_version int)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE defect text;
BEGIN
  IF p_policy_version IS NULL OR p_policy_version < 1 THEN
    RAISE EXCEPTION 'a publication must name the readiness policy version it was checked against'
      USING ERRCODE = 'CMS04';
  END IF;
  IF p_readiness IS NULL OR jsonb_typeof(p_readiness) <> 'array' THEN
    RAISE EXCEPTION
      'a publication must carry a readiness report: a JSON array of findings, not %',
      COALESCE(jsonb_typeof(p_readiness), 'null') USING ERRCODE = 'CMS04';
  END IF;

  -- A malformed element is worse than a missing report: it reads as clean.
  -- `[{}]` and `[1]` both have no blocking findings in them, in the sense that
  -- nothing in them is a finding at all.
  defect := app.readiness_defect(p_readiness);
  IF defect IS NOT NULL THEN
    RAISE EXCEPTION 'malformed readiness report: %', defect USING ERRCODE = 'CMS04';
  END IF;
END
$$;

/*
 * Fail closed. Returns the blocking rules an override let through, so the
 * caller can record them; raises otherwise.
 */
CREATE OR REPLACE FUNCTION app.assert_publishable(
  p_readiness jsonb, p_policy_version int, p_override_reason text
) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE blocking text[];
BEGIN
  PERFORM app.assert_readiness_shape(p_readiness, p_policy_version);

  blocking := app.readiness_blocking(p_readiness);
  IF array_length(blocking, 1) > 0
     AND (p_override_reason IS NULL OR btrim(p_override_reason) = '') THEN
    RAISE EXCEPTION 'this version is not ready to publish: %', array_to_string(blocking, ', ')
      USING ERRCODE = 'CMS04';
  END IF;
  RETURN COALESCE(blocking, '{}'::text[]);
END
$$;

-- ============================================ the editor's publish, explicit ==
--
-- DROP rather than CREATE OR REPLACE: Postgres refuses to remove parameter
-- defaults from an existing function, and removing them is the point. The
-- two-argument call stops resolving entirely, so nothing can quietly keep the
-- old behaviour — a caller that has not been updated fails loudly at 42883
-- rather than publishing under an assumption nobody made.

DROP FUNCTION IF EXISTS app.publish_page(uuid, bigint, int, text, jsonb);

CREATE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int, p_override_reason text, p_readiness jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; draft uuid;
BEGIN
  actor := app.require_actor();
  -- Without this an editor could opt out of the compare-and-set by passing
  -- NULL and silently overwrite someone else's newer work.
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'publishing from the editor requires the revision you loaded'
      USING ERRCODE = 'CMS04';
  END IF;
  SELECT draft_version_id INTO draft FROM public.pages WHERE id = p_page_id;

  RETURN QUERY SELECT * FROM app.publish_page_version(
    p_page_id, p_expected_revision, draft, 'user', actor,
    p_readiness_policy_version, p_override_reason, p_readiness, '{}'::jsonb);
END
$$;

-- ========================================== the scheduler, same shape check ==
--
-- Re-emitted only so the shape validation is the shared one. Everything else —
-- the lease check, the policy-version pin, fail-closed on blocking findings,
-- publication and settlement in one transaction — is unchanged from 0010.

CREATE OR REPLACE FUNCTION app.execute_scheduled_action(
  p_id uuid, p_lease_token uuid, p_readiness_policy_version int, p_readiness jsonb
) RETURNS TABLE (outcome text, published_version_id uuid, revision bigint, path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE job RECORD; result RECORD; blocking text[];
BEGIN
  PERFORM app.require_worker();

  SELECT sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
         sa.created_by, sa.status, sa.lease_token_hash, sa.leased_until,
         sa.readiness_policy_version
    INTO job
    FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;

  IF job IS NULL OR job.status <> 'running'
     OR NOT app.lease_matches(job.lease_token_hash, p_lease_token) THEN
    RAISE EXCEPTION 'schedule % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;
  IF job.leased_until < now() THEN
    RAISE EXCEPTION 'the lease on schedule % expired before it was executed', p_id
      USING ERRCODE = 'CMS04';
  END IF;

  IF job.item_type <> 'page' THEN
    RAISE EXCEPTION 'unsupported schedule item type %', job.item_type USING ERRCODE = 'CMS04';
  END IF;

  IF job.action = 'publish' THEN
    IF p_readiness_policy_version IS DISTINCT FROM job.readiness_policy_version THEN
      RAISE EXCEPTION
        'this schedule pinned readiness policy version %, but it was checked against version %',
        job.readiness_policy_version, p_readiness_policy_version USING ERRCODE = 'CMS04';
    END IF;
    -- Same validation the editor's publish goes through. A worker sending a
    -- malformed report is a worker bug: it raises, and the caller records it as
    -- a permanent failure rather than the schedule slipping through as clean.
    PERFORM app.assert_readiness_shape(p_readiness, job.readiness_policy_version);

    blocking := app.readiness_blocking(p_readiness);
    IF array_length(blocking, 1) > 0 THEN
      -- Fail closed, and record enough for someone to act on. There is no
      -- scheduling override model yet (SPEC §6.8 gives one to the editor, with
      -- a written reason attached to a person); until there is, a schedule
      -- cannot supply one, so blocking findings end it. Permanent, because
      -- retrying identical immutable content produces the identical verdict.
      UPDATE public.scheduled_actions
         SET status = 'failed', finished_at = now(), failure_kind = 'readiness',
             readiness_report = p_readiness,
             last_error = 'This version is not ready to publish: '
                          || array_to_string(blocking, ', '),
             leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
       WHERE id = p_id;

      PERFORM app.write_audit(
        job.site_id, 'scheduler', NULL, 'schedule.blocked', 'scheduled_action', p_id, NULL, NULL,
        jsonb_build_object('page_id', job.item_id, 'version_id', job.version_id,
                           'readiness_policy_version', job.readiness_policy_version,
                           'blocking', to_jsonb(blocking),
                           'authorized_by', job.created_by));

      RETURN QUERY SELECT 'blocked'::text, NULL::uuid, NULL::bigint, NULL::text;
      RETURN;
    END IF;

    -- NULL expected revision: a schedule's intent is a pinned *version*, not a
    -- pinned revision (0009). Serialization comes from the FOR UPDATE inside
    -- publish_page_version.
    SELECT * INTO result FROM app.publish_page_version(
      job.item_id, NULL, job.version_id, 'scheduler', job.created_by,
      job.readiness_policy_version, NULL, p_readiness,
      jsonb_build_object('scheduled_action_id', p_id));

  ELSIF job.action = 'unpublish' THEN
    -- Readiness is a question about content going live. Taking a page down
    -- cannot be blocked by the quality of what it contained.
    IF NOT app.can_publish_as(job.created_by, job.site_id) THEN
      RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
    END IF;
    PERFORM app.unpublish_page_internal(job.item_id, NULL, 'scheduler', job.created_by, p_id);
    SELECT NULL::uuid AS published_version_id, (p.revision) AS revision,
           app.page_path(p.slug) AS path INTO result
      FROM public.pages p WHERE p.id = job.item_id;
  ELSE
    RAISE EXCEPTION 'unsupported scheduled action %', job.action USING ERRCODE = 'CMS04';
  END IF;

  UPDATE public.scheduled_actions
     SET status = 'succeeded', finished_at = now(), last_error = NULL,
         failure_kind = NULL, readiness_report = p_readiness,
         leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
   WHERE id = p_id;

  RETURN QUERY SELECT 'published'::text, result.published_version_id, result.revision, result.path;
END
$$;

-- ================================================================== grants ==
--
-- DROP took the grant with it, so publish_page is re-granted here. Nothing else
-- changed hands.

REVOKE ALL ON FUNCTION app.publish_page(uuid, bigint, int, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.readiness_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assert_readiness_shape(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assert_publishable(jsonb, int, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.publish_page(uuid, bigint, int, text, jsonb)
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
