-- 0010 — a lease token nobody can read, and readiness parity for the scheduler.
--
-- Two acceptance claims made after 0009 were false, and both were provable
-- against the migrated database rather than by reading the code.
--
-- (1) "the token is returned only to the claimant" was not true. 0002 granted
--     cms_worker table-level SELECT on outbox and scheduled_actions with a
--     USING (true) policy, and 0007 did the same for cms_authenticated_user.
--     A table-level grant covers columns added later, so 0009's lease_token
--     column was readable by every worker the moment it existed:
--
--       has_column_privilege('cms_worker','outbox','lease_token','SELECT') = t
--
--     The 0009 regression only ever offered an all-zero token, so it proved
--     tokens are unguessable and said nothing about whether they are secret.
--     A non-claiming worker could simply SELECT the live token and settle,
--     execute, or fail another worker's row — the same impersonation 0009 set
--     out to close, reached through a different door.
--
-- (2) "the same readiness policy runs for every publish path" (SPEC §6.8) was
--     not true either. execute_scheduled_action passed policy version 1 and an
--     empty '{}' readiness report, and the worker never ran the checks at all.
--     A version the editor refuses — no H1, no sections, an image with no alt
--     text, a link to a page that does not exist — published fine on a
--     schedule. The rule the SPEC states is that the *same invalid draft is
--     refused everywhere*, so the scheduler is the path that has to change.
--
-- The shape of the fix for (1) is that the database stops storing anything a
-- reader could use. Only a SHA-256 digest of the token is persisted; the raw
-- token exists in the claim's result set and nowhere else. Even a privileged
-- read — a superuser, a backup, a leaked replica — recovers a digest, and a
-- digest cannot be presented to settle. The grants are narrowed as well, so
-- there are two independent reasons a worker cannot obtain a token it did not
-- win.

-- ===================================================== token secrecy: shape ==
--
-- Dropping lease_token invalidates any lease held across the deployment: the
-- digest is NULL, so settlement is refused and the row becomes reclaimable when
-- its lease lapses. At-least-once delivery already covers that, and it happens
-- once, at the migration.

ALTER TABLE outbox            DROP COLUMN lease_token;
ALTER TABLE scheduled_actions DROP COLUMN lease_token;
ALTER TABLE outbox            ADD COLUMN lease_token_hash bytea;
ALTER TABLE scheduled_actions ADD COLUMN lease_token_hash bytea;

COMMENT ON COLUMN outbox.lease_token_hash IS
  'SHA-256 of the lease capability. The token itself is returned by app.claim_outbox and never stored.';
COMMENT ON COLUMN scheduled_actions.lease_token_hash IS
  'SHA-256 of the lease capability. The token itself is returned by app.claim_scheduled_action and never stored.';

CREATE OR REPLACE FUNCTION app.lease_digest(p_token uuid) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT sha256(convert_to(p_token::text, 'UTF8'))
$$;

-- One place that answers "does this caller hold the lease on this row?", so the
-- five call sites below cannot drift apart. NULL-safe in both directions: a row
-- with no digest is held by nobody, and a caller with no token holds nothing.
CREATE OR REPLACE FUNCTION app.lease_matches(p_stored bytea, p_offered uuid) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT p_stored IS NOT NULL AND p_offered IS NOT NULL
     AND p_stored = app.lease_digest(p_offered)
$$;

-- ================================================================== outbox ==
--
-- p_exclude is new. drainOutbox keeps a set of the events it has already
-- delivered this pass, and 0009 handled a re-claimed duplicate by breaking out
-- of the loop — which left the row it had just claimed leased and stranded
-- until that lease expired, delaying it by a lease duration for no reason.
-- Refusing to hand it out in the first place has no such window.

DROP FUNCTION IF EXISTS app.claim_outbox(int);

CREATE OR REPLACE FUNCTION app.claim_outbox(p_lease_seconds int, p_exclude bigint[] DEFAULT '{}')
RETURNS TABLE (id bigint, site_id uuid, event_type text, payload jsonb,
               attempts integer, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  worker := app.require_worker();
  token := gen_random_uuid();

  RETURN QUERY
  UPDATE public.outbox o
     SET status = 'running', leased_by = worker,
         lease_token_hash = app.lease_digest(token),
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempts = o.attempts + 1
   WHERE o.id = (
     SELECT c.id FROM public.outbox c
      WHERE c.status IN ('pending', 'running')
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR c.leased_until < now())
        AND NOT (c.id = ANY (COALESCE(p_exclude, '{}'::bigint[])))
      ORDER BY c.next_attempt_at, c.id
      FOR UPDATE SKIP LOCKED LIMIT 1)
  -- `token`, not a column: the raw capability leaves through this result set
  -- and is never written anywhere.
  RETURNING o.id, o.site_id, o.event_type, o.payload, o.attempts, token;
END
$$;

CREATE OR REPLACE FUNCTION app.settle_outbox(
  p_id bigint, p_lease_token uuid, p_ok boolean, p_error text,
  p_permanent boolean DEFAULT false
) RETURNS outbox_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status outbox_status;
BEGIN
  PERFORM app.require_worker();

  SELECT o.id, o.attempts, o.max_attempts, o.status, o.lease_token_hash, o.leased_until
    INTO row FROM public.outbox o WHERE o.id = p_id FOR UPDATE;
  IF row IS NULL THEN
    RAISE EXCEPTION 'no such outbox event %', p_id USING ERRCODE = 'CMS03';
  END IF;

  IF row.status <> 'running' OR NOT app.lease_matches(row.lease_token_hash, p_lease_token) THEN
    RAISE EXCEPTION 'outbox event % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;
  IF row.leased_until < now() THEN
    RAISE EXCEPTION 'the lease on outbox event % expired before it was settled', p_id
      USING ERRCODE = 'CMS04';
  END IF;

  -- Every exit clears the digest. A token is good for exactly one settlement:
  -- once the row leaves 'running' the capability it was minted for is spent,
  -- and a replay of the same token finds nothing to match against.
  IF p_ok THEN
    next_status := 'delivered';
    UPDATE public.outbox
       SET status = next_status, processed_at = now(), last_error = NULL,
           leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
     WHERE id = p_id;
  ELSIF p_permanent OR row.attempts >= row.max_attempts THEN
    next_status := 'dead';
    UPDATE public.outbox
       SET status = next_status, failed_at = now(),
           last_error = COALESCE(p_error, 'failed without a message'),
           leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
     WHERE id = p_id;
  ELSE
    next_status := 'pending';
    UPDATE public.outbox
       SET status = next_status,
           last_error = COALESCE(p_error, 'failed without a message'),
           next_attempt_at = now() + app.retry_delay(row.attempts),
           leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

-- ============================================== readiness: one gate, shared ==
--
-- The product-level rules live in @cms/domain because they need a rendered
-- page. What lives here is the part that must hold no matter which process
-- calls: a publication carries a readiness report, and blocking findings stop
-- it unless someone wrote down a reason. Enforcing that in the database is what
-- makes "the same invalid draft is refused everywhere" a property of the system
-- rather than a property of one code path remembering to check.

CREATE OR REPLACE FUNCTION app.readiness_blocking(p_readiness jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT f.value ->> 'rule'), '{}'::text[])
    FROM jsonb_array_elements(p_readiness) AS f(value)
   WHERE f.value ->> 'severity' = 'blocking'
$$;

/*
 * Fail closed. Returns the blocking rules it allowed through under an override,
 * so the caller can record them; raises otherwise.
 *
 * '{}' is refused rather than read as "nothing wrong". An empty *object* is not
 * an empty findings list — it is the shape you get when nobody ran the checks,
 * which is precisely the state the scheduler was in. An empty *array* is a
 * report that found nothing, and that is a different claim.
 */
CREATE OR REPLACE FUNCTION app.assert_publishable(
  p_readiness jsonb, p_policy_version int, p_override_reason text
) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE blocking text[];
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

  blocking := app.readiness_blocking(p_readiness);
  IF array_length(blocking, 1) > 0
     AND (p_override_reason IS NULL OR btrim(p_override_reason) = '') THEN
    RAISE EXCEPTION 'this version is not ready to publish: %', array_to_string(blocking, ', ')
      USING ERRCODE = 'CMS04';
  END IF;
  RETURN COALESCE(blocking, '{}'::text[]);
END
$$;

-- ====================================================== scheduled: pinning ==
--
-- SPEC §6.8: a schedule pins the readiness policy version, the same way it
-- pins the version to publish. Deliberately NOT NULL with no default, so
-- creating a schedule is a decision about which policy it will be judged by
-- rather than a silent inheritance of whatever is current when it fires.

ALTER TABLE scheduled_actions ADD COLUMN readiness_policy_version int;
UPDATE scheduled_actions SET readiness_policy_version = 1 WHERE readiness_policy_version IS NULL;
ALTER TABLE scheduled_actions ALTER COLUMN readiness_policy_version SET NOT NULL;

-- What the worker actually evaluated, kept whether the schedule published or
-- was blocked. Without it "the scheduler said no" is unreviewable.
ALTER TABLE scheduled_actions ADD COLUMN readiness_report jsonb;

DROP FUNCTION IF EXISTS app.claim_scheduled_action(int);

CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_lease_seconds int)
RETURNS TABLE (id uuid, site_id uuid, item_type reviewable_type, item_id uuid,
               version_id uuid, action scheduled_action_kind, created_by uuid,
               attempt_count integer, max_attempts integer,
               readiness_policy_version integer, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  worker := app.require_worker();
  token := gen_random_uuid();

  RETURN QUERY
  UPDATE public.scheduled_actions sa
     SET status = 'running', leased_by = worker,
         lease_token_hash = app.lease_digest(token),
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempt_count = sa.attempt_count + 1,
         failure_kind = NULL
   WHERE sa.id = (
     SELECT c.id FROM public.scheduled_actions c
      WHERE c.run_at <= now()
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
      ORDER BY c.run_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
            sa.created_by, sa.attempt_count, sa.max_attempts,
            sa.readiness_policy_version, token;
END
$$;

DROP FUNCTION IF EXISTS app.execute_scheduled_action(uuid, uuid);

/*
 * Execute one due schedule, with its readiness verdict.
 *
 * The verdict is computed by the caller because it needs a rendered page, which
 * is not something SQL can produce. What the caller cannot do is skip it: the
 * report is a required argument, its shape is checked, and a blocking finding
 * ends the schedule here rather than in the worker's discretion. A worker that
 * simply never called fail_scheduled_action still cannot publish a blocked
 * version.
 *
 * The policy version must match the one the schedule pinned. A worker running
 * older code than the schedule was written against is refused with a message
 * that says so, instead of quietly judging the page by the wrong rules.
 *
 * Publication and settlement remain in this one transaction — the 0008 fix
 * stands. Readiness is evaluated before it, because it is a read of an
 * immutable version plus a pure function, and holding a transaction open across
 * that work would put the lease and the transaction on different clocks.
 */
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
    IF p_readiness IS NULL OR jsonb_typeof(p_readiness) <> 'array' THEN
      RAISE EXCEPTION
        'a scheduled publish must carry a readiness report: a JSON array of findings, not %',
        COALESCE(jsonb_typeof(p_readiness), 'null') USING ERRCODE = 'CMS04';
    END IF;

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

CREATE OR REPLACE FUNCTION app.fail_scheduled_action(
  p_id uuid, p_lease_token uuid, p_error text, p_permanent boolean
) RETURNS scheduled_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status scheduled_status; worker text;
BEGIN
  worker := app.require_worker();

  SELECT sa.id, sa.site_id, sa.attempt_count, sa.max_attempts, sa.status, sa.lease_token_hash
    INTO row FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;
  IF row IS NULL OR row.status <> 'running'
     OR NOT app.lease_matches(row.lease_token_hash, p_lease_token) THEN
    RAISE EXCEPTION 'schedule % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;

  IF p_permanent OR row.attempt_count >= row.max_attempts THEN
    next_status := 'failed';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, finished_at = now(),
           failure_kind = CASE WHEN p_permanent THEN 'permanent' ELSE 'attempts_exhausted' END,
           leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
     WHERE id = p_id;
    PERFORM app.write_audit(row.site_id, 'scheduler', NULL, 'schedule.failed', 'scheduled_action',
                            p_id, NULL, NULL,
                            jsonb_build_object('error', p_error, 'worker', worker,
                                               'permanent', p_permanent));
  ELSE
    next_status := 'pending';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, failure_kind = 'retryable',
           next_attempt_at = now() + app.retry_delay(row.attempt_count),
           leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

-- ================================================ publication: the one gate ==
--
-- Every path into publication goes through this function, so this is where the
-- readiness contract belongs. The editor checked in TypeScript and the
-- scheduler checked nowhere; now neither can publish blocking content without
-- an override reason, and the reason is recorded with the findings it waived.

CREATE OR REPLACE FUNCTION app.publish_page_version(
  p_page_id uuid, p_expected_revision bigint, p_version_id uuid,
  p_actor_type actor_type, p_authorizing_user uuid,
  p_readiness_policy_version int, p_override_reason text, p_readiness jsonb, p_detail jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  head RECORD; src RECORD; site RECORD;
  next_rev bigint; manifest jsonb; shell_rev bigint; page_path text; waived text[];
BEGIN
  IF p_authorizing_user IS NULL THEN
    RAISE EXCEPTION 'a publication must name the user who authorized it' USING ERRCODE = 'CMS02';
  END IF;

  SELECT p.id, p.site_id, p.revision, p.slug, p.draft_version_id, p.published_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;

  IF NOT app.can_publish_as(p_authorizing_user, head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.id, s.status INTO site FROM public.sites s WHERE s.id = head.site_id;
  IF site.status = 'archived' THEN
    RAISE EXCEPTION 'site is archived' USING ERRCODE = 'CMS04';
  END IF;

  -- After authorization, before any write: an unauthorized caller learns
  -- nothing about the page's readiness, and a refused publication leaves no
  -- trace of a half-applied one.
  waived := app.assert_publishable(p_readiness, p_readiness_policy_version, p_override_reason);

  -- NULL means the caller pinned a version instead of a revision. The row is
  -- already locked above, so serialization does not depend on this comparison.
  IF p_expected_revision IS NOT NULL AND head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to publish' USING ERRCODE = 'CMS04';
  END IF;

  SELECT pv.id, pv.carries_trusted_code, pv.trusted_code_approved_by
    INTO src FROM public.page_versions pv
   WHERE pv.id = p_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version % does not belong to page %', p_version_id, p_page_id
      USING ERRCODE = 'CMS03';
  END IF;

  IF src.carries_trusted_code AND src.trusted_code_approved_by IS NULL THEN
    RAISE EXCEPTION 'version carries raw markup and needs super-admin approval'
      USING ERRCODE = 'CMS05';
  END IF;

  manifest := app.build_render_manifest_internal(src.id);
  shell_rev := app.ensure_site_shell(head.site_id);
  page_path := app.page_path(head.slug);
  next_rev := head.revision + 1;

  UPDATE public.pages
     SET published_version_id = src.id, revision = next_rev, status = 'published'
   WHERE id = p_page_id;

  INSERT INTO public.published_routes
    (site_id, path, page_id, page_version_id, shell_revision, render_manifest, updated_at)
  VALUES (head.site_id, page_path, p_page_id, src.id, shell_rev, manifest, now())
  ON CONFLICT (site_id, path) DO UPDATE
    SET page_id = EXCLUDED.page_id, page_version_id = EXCLUDED.page_version_id,
        shell_revision = EXCLUDED.shell_revision, render_manifest = EXCLUDED.render_manifest,
        updated_at = now();

  PERFORM app.write_audit(
    head.site_id, p_actor_type,
    CASE WHEN p_actor_type = 'user' THEN p_authorizing_user ELSE NULL END,
    'page.publish', 'page', p_page_id, head.published_version_id, src.id,
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'revision', next_rev, 'path', page_path, 'version_id', src.id,
      'authorized_by', p_authorizing_user,
      'readiness_policy_version', p_readiness_policy_version,
      'override_reason', p_override_reason,
      -- Named separately from the full report so "what did this override let
      -- through" is answerable without re-deriving it.
      'overridden_blocking', to_jsonb(waived),
      'readiness', p_readiness));

  PERFORM app.emit_outbox(head.site_id, 'page.published',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev, 'shell_revision', shell_rev));

  RETURN QUERY SELECT src.id, next_rev, page_path, shell_rev;
END
$$;

-- The default is now an empty findings *list*, which is what "the caller ran
-- the checks and found nothing" looks like. It is still a claim the caller
-- makes; the rules that must never be bypassable — unapproved raw markup, an
-- unresolvable section version — are enforced above regardless of any report.
CREATE OR REPLACE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int DEFAULT 1,
  p_override_reason text DEFAULT NULL,
  p_readiness jsonb DEFAULT '[]'::jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; draft uuid;
BEGIN
  actor := app.require_actor();
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

-- ================================================================== grants ==
--
-- The table-level SELECT is the defect. A grant on the table follows the table
-- as it grows, so every column added after it is granted too — which is exactly
-- how a secret minted in 0009 became readable by everyone who could already
-- read the queue. Column lists do not do that: a column added later is not
-- readable until someone names it, and the failure when that is an oversight is
-- a visible permission error rather than a silent disclosure.

REVOKE ALL ON outbox, scheduled_actions FROM cms_worker, cms_authenticated_user;

-- The worker reaches both tables exclusively through the functions above. It
-- has no reason to read a row it did not claim, and now no way to.
DROP POLICY IF EXISTS outbox_worker ON outbox;
DROP POLICY IF EXISTS scheduled_actions_worker ON scheduled_actions;

-- Admin keeps what it had, minus the capability. outbox_member_read and
-- scheduled_actions_member still scope these to the reader's own sites; this is
-- the second, independent reason a token cannot be read.
GRANT SELECT (id, site_id, event_type, payload, status, created_at, processed_at,
              failed_at, attempts, max_attempts, next_attempt_at, leased_by,
              leased_until, last_error)
  ON outbox TO cms_authenticated_user;

GRANT SELECT (id, site_id, item_type, item_id, version_id, action, run_at, status,
              created_by, attempt_count, max_attempts, last_error, failure_kind,
              next_attempt_at, leased_by, leased_until, created_at, finished_at,
              readiness_policy_version, readiness_report)
  ON scheduled_actions TO cms_authenticated_user;

REVOKE ALL ON FUNCTION app.claim_outbox(int, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_outbox(bigint, uuid, boolean, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_scheduled_action(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.execute_scheduled_action(uuid, uuid, int, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_scheduled_action(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_page_version(uuid, bigint, uuid, actor_type, uuid, int, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.lease_digest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.lease_matches(bytea, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.readiness_blocking(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assert_publishable(jsonb, int, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.claim_outbox(int, bigint[]),
  app.settle_outbox(bigint, uuid, boolean, text, boolean),
  app.claim_scheduled_action(int),
  app.execute_scheduled_action(uuid, uuid, int, jsonb),
  app.fail_scheduled_action(uuid, uuid, text, boolean),
  app.job_queue_health()
TO cms_worker;

-- Readiness for a scheduled publish is evaluated against the pinned version, by
-- the same code the editor runs. The tenant-checked build_render_manifest is
-- the editor's door; the worker is not a tenant and uses the internal one,
-- which is why it needs naming here rather than inheriting a member's access.
GRANT EXECUTE ON FUNCTION app.build_render_manifest_internal(uuid) TO cms_worker;

GRANT EXECUTE ON FUNCTION
  app.publish_page(uuid, bigint, int, text, jsonb),
  app.unpublish_page(uuid, bigint),
  app.job_queue_health()
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
