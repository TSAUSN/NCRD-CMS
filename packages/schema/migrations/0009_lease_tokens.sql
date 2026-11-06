-- 0009 — lease tokens: worker authorization that a worker cannot assert.
--
-- 0008 removed the worker id from every function signature and derived it from
-- app.current_worker_id() instead. That was not enough, and an adversarial pass
-- proved it: app.current_worker_id() reads `app.worker_id`, an ordinary session
-- GUC, and every worker process authenticates as the *same* database role
-- (cms_worker_app). So a second worker only has to run
--
--     SELECT set_config('app.worker_id', 'worker-a', false);
--
-- to settle worker A's in-flight events, execute A's leased schedules — which
-- publishes a page — and forge A's heartbeat. The forgeable value moved from a
-- function argument to a session variable set by the same caller in the same
-- round trip. That is the identical trust level, which is to say none.
--
-- Identity a session chooses cannot authorize anything. The fix is a
-- capability instead of an assertion: claiming a row mints an unguessable
-- token, returns it to the claimant alone, and every later operation on that
-- row requires it. A worker holds the token only if it actually won the claim,
-- and no amount of GUC-setting produces one.
--
-- `leased_by` stays, demoted to what it always honestly was: a label for
-- operators reading the queue, never an authorization input.

ALTER TABLE outbox            ADD COLUMN lease_token uuid;
ALTER TABLE scheduled_actions ADD COLUMN lease_token uuid;

-- ================================================================= outbox ==

DROP FUNCTION IF EXISTS app.claim_outbox(int);

CREATE OR REPLACE FUNCTION app.claim_outbox(p_lease_seconds int)
RETURNS TABLE (id bigint, site_id uuid, event_type text, payload jsonb,
               attempts integer, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  -- Still recorded, so an operator can see which process holds what. It is a
  -- label from here on, not a credential.
  worker := app.require_worker();
  token := gen_random_uuid();

  RETURN QUERY
  UPDATE public.outbox o
     SET status = 'running', leased_by = worker, lease_token = token,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempts = o.attempts + 1
   WHERE o.id = (
     SELECT c.id FROM public.outbox c
      WHERE c.status IN ('pending', 'running')
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR c.leased_until < now())
      ORDER BY c.next_attempt_at, c.id
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING o.id, o.site_id, o.event_type, o.payload, o.attempts, o.lease_token;
END
$$;

DROP FUNCTION IF EXISTS app.settle_outbox(bigint, boolean, text, boolean);

CREATE OR REPLACE FUNCTION app.settle_outbox(
  p_id bigint, p_lease_token uuid, p_ok boolean, p_error text,
  p_permanent boolean DEFAULT false
) RETURNS outbox_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status outbox_status;
BEGIN
  PERFORM app.require_worker();

  SELECT o.id, o.attempts, o.max_attempts, o.status, o.lease_token, o.leased_until
    INTO row FROM public.outbox o WHERE o.id = p_id FOR UPDATE;
  IF row IS NULL THEN
    RAISE EXCEPTION 'no such outbox event %', p_id USING ERRCODE = 'CMS03';
  END IF;

  -- The token is the whole authorization. It is not derivable from anything the
  -- caller controls, so only the session that won the claim can settle.
  IF row.status <> 'running' OR row.lease_token IS NULL
     OR row.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'outbox event % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;
  -- An expired lease has already been offered to someone else. Settling on it
  -- would let a slow worker overwrite the result of whoever reclaimed the row.
  IF row.leased_until < now() THEN
    RAISE EXCEPTION 'the lease on outbox event % expired before it was settled', p_id
      USING ERRCODE = 'CMS04';
  END IF;

  IF p_ok THEN
    next_status := 'delivered';
    UPDATE public.outbox
       SET status = next_status, processed_at = now(), last_error = NULL,
           leased_by = NULL, leased_until = NULL, lease_token = NULL
     WHERE id = p_id;
  ELSIF p_permanent OR row.attempts >= row.max_attempts THEN
    next_status := 'dead';
    UPDATE public.outbox
       SET status = next_status, failed_at = now(),
           last_error = COALESCE(p_error, 'failed without a message'),
           leased_by = NULL, leased_until = NULL, lease_token = NULL
     WHERE id = p_id;
  ELSE
    next_status := 'pending';
    UPDATE public.outbox
       SET status = next_status,
           -- Never NULL on the retry path: `last_error IS NOT NULL` is what
           -- job_queue_health uses to distinguish a retry from a first attempt.
           last_error = COALESCE(p_error, 'failed without a message'),
           next_attempt_at = now() + app.retry_delay(row.attempts),
           leased_by = NULL, leased_until = NULL, lease_token = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

-- ====================================================== scheduled actions ==

DROP FUNCTION IF EXISTS app.claim_scheduled_action(int);

CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_lease_seconds int)
RETURNS TABLE (id uuid, site_id uuid, item_type reviewable_type, item_id uuid,
               version_id uuid, action scheduled_action_kind, created_by uuid,
               attempt_count integer, max_attempts integer, lease_token uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  worker := app.require_worker();
  token := gen_random_uuid();

  RETURN QUERY
  UPDATE public.scheduled_actions sa
     SET status = 'running', leased_by = worker, lease_token = token,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempt_count = sa.attempt_count + 1,
         -- Cleared on every fresh attempt so `failure_kind = 'retryable'` means
         -- "failed last time and is waiting", not "failed once, ever".
         failure_kind = NULL
   WHERE sa.id = (
     SELECT c.id FROM public.scheduled_actions c
      WHERE c.run_at <= now()
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
      ORDER BY c.run_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
            sa.created_by, sa.attempt_count, sa.max_attempts, sa.lease_token;
END
$$;

DROP FUNCTION IF EXISTS app.execute_scheduled_action(uuid);

CREATE OR REPLACE FUNCTION app.execute_scheduled_action(p_id uuid, p_lease_token uuid)
RETURNS TABLE (published_version_id uuid, revision bigint, path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE job RECORD; result RECORD;
BEGIN
  PERFORM app.require_worker();

  SELECT sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
         sa.created_by, sa.status, sa.lease_token, sa.leased_until
    INTO job
    FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;

  IF job IS NULL OR job.status <> 'running' OR job.lease_token IS NULL
     OR job.lease_token IS DISTINCT FROM p_lease_token THEN
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
    -- NULL expected revision: a schedule's intent is a *pinned version*, not a
    -- pinned revision. 0008 read pages.revision moments before locking the row
    -- and passed it back as the "expected" value, so the comparison compared
    -- the row against itself — a no-op that could only ever fire when an
    -- ordinary autosave raced it, and CMS01 is classified permanent, so a
    -- legitimate scheduled publish died forever because someone was typing.
    -- Serialization comes from the FOR UPDATE inside publish_page_version.
    SELECT * INTO result FROM app.publish_page_version(
      job.item_id, NULL, job.version_id, 'scheduler', job.created_by,
      1, NULL, '{}'::jsonb,
      jsonb_build_object('scheduled_action_id', p_id));
  ELSIF job.action = 'unpublish' THEN
    IF NOT app.can_publish_as(job.created_by, job.site_id) THEN
      RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
    END IF;
    PERFORM app.unpublish_page_internal(job.item_id, NULL, 'scheduler', job.created_by, p_id);
    SELECT NULL::uuid, (p.revision) AS revision, app.page_path(p.slug) AS path INTO result
      FROM public.pages p WHERE p.id = job.item_id;
  ELSE
    -- A future enum value must be refused, not silently treated as an unpublish.
    RAISE EXCEPTION 'unsupported scheduled action %', job.action USING ERRCODE = 'CMS04';
  END IF;

  UPDATE public.scheduled_actions
     SET status = 'succeeded', finished_at = now(), last_error = NULL,
         failure_kind = NULL, leased_by = NULL, leased_until = NULL, lease_token = NULL
   WHERE id = p_id;

  RETURN QUERY SELECT result.published_version_id, result.revision, result.path;
END
$$;

DROP FUNCTION IF EXISTS app.fail_scheduled_action(uuid, text, boolean);

CREATE OR REPLACE FUNCTION app.fail_scheduled_action(
  p_id uuid, p_lease_token uuid, p_error text, p_permanent boolean
) RETURNS scheduled_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status scheduled_status; worker text;
BEGIN
  worker := app.require_worker();

  SELECT sa.id, sa.site_id, sa.attempt_count, sa.max_attempts, sa.status, sa.lease_token
    INTO row FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;
  IF row IS NULL OR row.status <> 'running' OR row.lease_token IS NULL
     OR row.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'schedule % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;

  IF p_permanent OR row.attempt_count >= row.max_attempts THEN
    next_status := 'failed';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, finished_at = now(),
           failure_kind = CASE WHEN p_permanent THEN 'permanent' ELSE 'attempts_exhausted' END,
           leased_by = NULL, leased_until = NULL, lease_token = NULL
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
           leased_by = NULL, leased_until = NULL, lease_token = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

-- ================================================= publication without CAS ==

-- The core: skip the comparison when no revision was supplied.
CREATE OR REPLACE FUNCTION app.publish_page_version(
  p_page_id uuid, p_expected_revision bigint, p_version_id uuid,
  p_actor_type actor_type, p_authorizing_user uuid,
  p_readiness_policy_version int, p_override_reason text, p_readiness jsonb, p_detail jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  head RECORD; src RECORD; site RECORD;
  next_rev bigint; manifest jsonb; shell_rev bigint; page_path text;
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
      'override_reason', p_override_reason, 'readiness', p_readiness));

  PERFORM app.emit_outbox(head.site_id, 'page.published',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev, 'shell_revision', shell_rev));

  RETURN QUERY SELECT src.id, next_rev, page_path, shell_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.unpublish_page_internal(
  p_page_id uuid, p_expected_revision bigint, p_actor_type actor_type,
  p_authorizing_user uuid, p_scheduled_action_id uuid
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head RECORD; next_rev bigint; page_path text;
BEGIN
  SELECT p.id, p.site_id, p.revision, p.slug, p.published_version_id INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish_as(p_authorizing_user, head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF p_expected_revision IS NOT NULL AND head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  page_path := app.page_path(head.slug);
  next_rev := head.revision + 1;

  DELETE FROM public.published_routes WHERE site_id = head.site_id AND path = page_path;
  UPDATE public.pages SET published_version_id = NULL, revision = next_rev, status = 'draft'
   WHERE id = p_page_id;

  PERFORM app.write_audit(head.site_id, p_actor_type,
                          CASE WHEN p_actor_type = 'user' THEN p_authorizing_user ELSE NULL END,
                          'page.unpublish', 'page', p_page_id, head.published_version_id, NULL,
                          jsonb_build_object('revision', next_rev, 'path', page_path,
                                             'authorized_by', p_authorizing_user,
                                             'scheduled_action_id', p_scheduled_action_id));
  PERFORM app.emit_outbox(head.site_id, 'page.unpublished',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev));
  RETURN next_rev;
END
$$;

--
-- p_expected_revision may now be NULL, meaning "no compare-and-set: the caller's
-- intent is pinned by the version, not by the revision". Only the scheduler
-- passes NULL. The editor's wrapper refuses it, because an editor publish
-- absolutely does need the optimistic check — that is how a stale tab is caught.

CREATE OR REPLACE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int DEFAULT 1,
  p_override_reason text DEFAULT NULL,
  p_readiness jsonb DEFAULT '{}'::jsonb
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

CREATE OR REPLACE FUNCTION app.unpublish_page(p_page_id uuid, p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'unpublishing from the editor requires the revision you loaded'
      USING ERRCODE = 'CMS04';
  END IF;
  RETURN app.unpublish_page_internal(p_page_id, p_expected_revision, 'user', actor, NULL);
END
$$;

-- ============================================================ queue metrics ==
--
-- 0008 defined outbox_running as `status='running' AND leased_until > now()`
-- and outbox_waiting as `status='pending'`. A row abandoned by a crashed worker
-- — status 'running', lease long expired — was therefore in NEITHER bucket, and
-- disappeared from the dashboard entirely at exactly the moment an operator most
-- needed to see it. A `stalled` bucket now names that state, and the three
-- undelivered buckets are exhaustive by construction.

DROP FUNCTION IF EXISTS app.job_queue_health();

CREATE OR REPLACE FUNCTION app.job_queue_health()
RETURNS TABLE (
  outbox_waiting bigint, outbox_running bigint, outbox_stalled bigint,
  outbox_retrying bigint, outbox_dead bigint, outbox_oldest_waiting_seconds numeric,
  schedules_waiting bigint, schedules_running bigint, schedules_stalled bigint,
  schedules_retrying bigint, schedules_failed bigint, schedules_overdue_seconds numeric,
  live_workers bigint, stale_workers bigint, last_heartbeat_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT
    -- Queued, nobody has picked it up.
    (SELECT count(*) FROM public.outbox WHERE status = 'pending'),
    -- Actually in flight: someone holds an unexpired lease.
    (SELECT count(*) FROM public.outbox
      WHERE status = 'running' AND leased_until > now()),
    -- Claimed and then abandoned. Recoverable on the next pass, but if this is
    -- persistently non-zero a worker is dying mid-delivery.
    (SELECT count(*) FROM public.outbox
      WHERE status = 'running' AND (leased_until IS NULL OR leased_until <= now())),
    -- Has failed before and has not given up. `last_error` is the evidence;
    -- attempts alone is not, because the first claim already increments it.
    (SELECT count(*) FROM public.outbox
      WHERE status IN ('pending', 'running') AND last_error IS NOT NULL),
    (SELECT count(*) FROM public.outbox WHERE status = 'dead'),
    (SELECT EXTRACT(epoch FROM now() - min(created_at))
       FROM public.outbox WHERE status IN ('pending', 'running')),

    (SELECT count(*) FROM public.scheduled_actions WHERE status = 'pending'),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status = 'running' AND leased_until > now()),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status = 'running' AND (leased_until IS NULL OR leased_until <= now())),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status IN ('pending', 'running') AND failure_kind = 'retryable'),
    (SELECT count(*) FROM public.scheduled_actions WHERE status = 'failed'),
    (SELECT EXTRACT(epoch FROM now() - min(run_at))
       FROM public.scheduled_actions WHERE status IN ('pending', 'running') AND run_at <= now()),

    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at > now() - interval '60 seconds'),
    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at <= now() - interval '60 seconds'),
    (SELECT max(last_seen_at) FROM public.job_heartbeats)
$$;

-- ================================================================== grants ==

REVOKE ALL ON FUNCTION app.claim_outbox(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_outbox(bigint, uuid, boolean, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_scheduled_action(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.execute_scheduled_action(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_scheduled_action(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.job_queue_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_page_version(uuid, bigint, uuid, actor_type, uuid, int, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.unpublish_page_internal(uuid, bigint, actor_type, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.claim_outbox(int),
  app.settle_outbox(bigint, uuid, boolean, text, boolean),
  app.claim_scheduled_action(int),
  app.execute_scheduled_action(uuid, uuid),
  app.fail_scheduled_action(uuid, uuid, text, boolean),
  app.job_queue_health()
TO cms_worker;

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
