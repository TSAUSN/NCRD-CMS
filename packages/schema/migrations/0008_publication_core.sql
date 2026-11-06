-- 0008 — correctness closure on publication and the job transport.
--
-- Five defects, fixed together because they overlap in the same functions:
--
--   1. A schedule ignored its pinned version and published whatever the draft
--      pointer happened to be at execution time.
--   2. Publication and schedule settlement committed separately, so a crash
--      between them republished on the next pass — and publication is not
--      idempotent (it advances the revision and appends audit and outbox).
--      Audit also double-wrote: a 'user' row from publish_page and a
--      'scheduler' row from settlement, for one event.
--   5. Every worker function took the worker id as an argument and never
--      compared it to the session identity, so worker B could settle, steal, or
--      forge worker A's work.
--   6. `retrying` counted attempts > 0, but the first claim increments attempts,
--      so healthy first-attempt jobs were reported as retries.
--
-- Defect 4 (batch leases outliving their processing) is fixed in the worker,
-- which now claims one event immediately before processing it.

-- ================================================================ identity ==
--
-- Authorization has to be answerable for a *named* user, not only for the
-- session, because a scheduled publication is authorized by its creator while
-- being executed by the worker. The existing session-scoped helpers become thin
-- delegates so there is still one definition of each capability.

CREATE OR REPLACE FUNCTION app.site_role_of(p_user_id uuid, site uuid) RETURNS site_role_name
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_user_id IS NULL OR site IS NULL THEN NULL
    -- A disabled account has no capabilities, whoever is asking on its behalf.
    WHEN NOT EXISTS (SELECT 1 FROM public.app_users u
                      WHERE u.id = p_user_id AND u.status = 'active') THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.global_roles g
                  WHERE g.user_id = p_user_id AND g.role = 'super_admin')
      THEN 'site_admin'::public.site_role_name
    ELSE (SELECT m.role FROM public.site_memberships m
           WHERE m.user_id = p_user_id AND m.site_id = site)
  END
$$;

CREATE OR REPLACE FUNCTION app.can_publish_as(p_user_id uuid, site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(app.site_role_of(p_user_id, site) IN ('editor', 'site_admin'), false)
$$;

-- The session-scoped forms now delegate, so "who may publish" has one answer.
CREATE OR REPLACE FUNCTION app.site_role(site uuid) RETURNS site_role_name
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.site_role_of(app.current_user_id(), site)
$$;

CREATE OR REPLACE FUNCTION app.can_publish(site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.can_publish_as(app.current_user_id(), site)
$$;

-- ====================================================== the publication core ==
--
-- ONE implementation of the publication rules (SPEC §6.8). Editor publishing and
-- scheduled publishing are thin wrappers that differ in exactly two ways: which
-- version they publish, and who is recorded as having done it.
--
-- It takes an actor type and an authorizing user as arguments, which would be a
-- forgeable actor identity if any application role could call it. None can: it
-- is granted to nobody, so the only callers are the two SECURITY DEFINER
-- wrappers below, each of which derives those values itself and cannot be told
-- them (SPEC §4, §8).

CREATE OR REPLACE FUNCTION app.publish_page_version(
  p_page_id uuid,
  p_expected_revision bigint,
  -- The exact version to publish. The editor passes the current draft; a
  -- schedule passes the version it pinned when it was created.
  p_version_id uuid,
  p_actor_type actor_type,
  p_authorizing_user uuid,
  p_readiness_policy_version int,
  p_override_reason text,
  p_readiness jsonb,
  p_detail jsonb
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

  -- Reauthorized at execution time against the authorizing user, not at
  -- scheduling time: someone who has since been disabled or demoted must fail
  -- closed even though the schedule was legitimate when it was made.
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

  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to publish' USING ERRCODE = 'CMS04';
  END IF;

  -- The version must belong to this page. A schedule pinning another page's
  -- version is a permanent error, not something to publish anyway.
  SELECT pv.id, pv.carries_trusted_code, pv.trusted_code_approved_by
    INTO src FROM public.page_versions pv
   WHERE pv.id = p_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version % does not belong to page %', p_version_id, p_page_id
      USING ERRCODE = 'CMS03';
  END IF;

  -- Recomputed on save, never trusted from the client, and checked again here
  -- because a schedule may have been created before approval was revoked.
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

  -- One audit row per publication, whoever ran it (SPEC §6.13).
  --
  -- audit_log_actor_pairing requires actor_id to be NULL unless actor_type is
  -- 'user', so a scheduled fire records the authorizing person in `detail`
  -- rather than pretending they were the actor. That is the honest shape: the
  -- scheduler acted, this person authorized it.
  PERFORM app.write_audit(
    head.site_id, p_actor_type,
    CASE WHEN p_actor_type = 'user' THEN p_authorizing_user ELSE NULL END,
    'page.publish', 'page', p_page_id, head.published_version_id, src.id,
    COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'revision', next_rev, 'path', page_path,
      'version_id', src.id,
      'authorized_by', p_authorizing_user,
      'readiness_policy_version', p_readiness_policy_version,
      'override_reason', p_override_reason,
      'readiness', p_readiness));

  PERFORM app.emit_outbox(head.site_id, 'page.published',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev, 'shell_revision', shell_rev));

  RETURN QUERY SELECT src.id, next_rev, page_path, shell_rev;
END
$$;

-- build_render_manifest is granted to the editor for preview and therefore
-- checks app.has_site_access(), which is a *session* question. The publication
-- core runs on behalf of a named user (possibly with no session at all), so it
-- needs the unchecked builder. Splitting them keeps the granted one safe.
CREATE OR REPLACE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; sections jsonb; expected int; resolved int;
BEGIN
  SELECT pv.id, pv.content, pv.meta, pv.page_id, pv.site_id, p.title, p.slug
    INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id = pv.page_id
   WHERE pv.id = p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;

  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);

  SELECT COALESCE(jsonb_agg(entry ORDER BY ord), '[]'::jsonb), count(*)
    INTO sections, resolved
  FROM (
    SELECT inst.ord,
           jsonb_build_object(
             'instance', inst.value,
             'def', jsonb_build_object(
               'section_def_id', sdv.section_def_id,
               'version', sdv.version,
               'slug', sd.slug,
               'compiled_ast', sdv.compiled_ast,
               'css', sdv.source_css,
               'slots', sdv.slots,
               'sanitizer_policy_version', sdv.sanitizer_policy_version,
               'render_hash', sdv.render_hash)) AS entry
    FROM jsonb_array_elements(v.content) WITH ORDINALITY AS inst(value, ord)
    JOIN public.section_defs sd ON sd.id = (inst.value->>'section_def_id')::uuid
    JOIN public.section_def_versions sdv
      ON sdv.section_def_id = sd.id
     AND sdv.version = (inst.value->>'section_def_version')::int
  ) resolved_rows;

  IF resolved <> expected THEN
    RAISE EXCEPTION 'page version % references % section definition version(s) that do not exist',
      p_page_version_id, expected - resolved USING ERRCODE = 'CMS04';
  END IF;

  RETURN jsonb_build_object(
    'page', jsonb_build_object('id', v.page_id, 'version_id', v.id,
                               'title', v.title, 'path', app.page_path(v.slug)),
    'meta', v.meta,
    'sections', sections);
END
$$;

-- The editor's preview builder keeps its session check and delegates the work.
CREATE OR REPLACE FUNCTION app.build_render_manifest(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE owner_site uuid;
BEGIN
  SELECT site_id INTO owner_site FROM public.page_versions WHERE id = p_page_version_id;
  IF owner_site IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;
  -- This function runs as its owner, so RLS is not filtering for it. The check
  -- has to be here, not left to whoever called.
  IF NOT app.has_site_access(owner_site) THEN
    RAISE EXCEPTION 'not permitted to read this page version' USING ERRCODE = 'CMS02';
  END IF;
  RETURN app.build_render_manifest_internal(p_page_version_id);
END
$$;

-- ------------------------------------------------------- editor publishing --

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
  -- The actor is derived from the verified session and cannot be supplied.
  actor := app.require_actor();
  SELECT draft_version_id INTO draft FROM public.pages WHERE id = p_page_id;

  RETURN QUERY SELECT * FROM app.publish_page_version(
    p_page_id, p_expected_revision, draft, 'user', actor,
    p_readiness_policy_version, p_override_reason, p_readiness, '{}'::jsonb);
END
$$;

-- --------------------------------------------------- scheduled publishing --
--
-- Publication and settlement in ONE transaction (SPEC §6.8). Previously the
-- publication committed and settlement followed separately, so a crash between
-- them left the schedule claimable and the next pass published a second time.
-- Here the schedule cannot be marked succeeded without the publication, and the
-- publication cannot commit without the schedule being marked.

CREATE OR REPLACE FUNCTION app.execute_scheduled_action(p_id uuid)
RETURNS TABLE (published_version_id uuid, revision bigint, path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE job RECORD; head_rev bigint; result RECORD; worker text;
BEGIN
  worker := app.current_worker_id();
  IF worker IS NULL OR worker = '' THEN
    RAISE EXCEPTION 'no worker identity on this session' USING ERRCODE = 'CMS02';
  END IF;

  SELECT sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
         sa.created_by, sa.status, sa.leased_by
    INTO job
    FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;

  -- Only the worker currently holding the lease may execute it. This is what
  -- stops a second runner from publishing the same schedule.
  IF job IS NULL OR job.status <> 'running' OR job.leased_by IS DISTINCT FROM worker THEN
    RAISE EXCEPTION 'schedule % is not leased by %', p_id, worker USING ERRCODE = 'CMS04';
  END IF;

  IF job.item_type <> 'page' THEN
    RAISE EXCEPTION 'unsupported schedule item type %', job.item_type USING ERRCODE = 'CMS04';
  END IF;

  SELECT p.revision INTO head_rev FROM public.pages p WHERE p.id = job.item_id;
  IF head_rev IS NULL THEN
    RAISE EXCEPTION 'the page no longer exists' USING ERRCODE = 'CMS03';
  END IF;

  IF job.action = 'publish' THEN
    -- The pinned version, not whatever the draft pointer says now.
    SELECT * INTO result FROM app.publish_page_version(
      job.item_id, head_rev, job.version_id, 'scheduler', job.created_by,
      1, NULL, '{}'::jsonb,
      jsonb_build_object('scheduled_action_id', p_id, 'worker', worker));
  ELSE
    IF NOT app.can_publish_as(job.created_by, job.site_id) THEN
      RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
    END IF;
    PERFORM app.unpublish_page_internal(job.item_id, head_rev, 'scheduler', job.created_by, p_id);
    SELECT NULL::uuid AS published_version_id, (head_rev + 1) AS revision,
           app.page_path(p.slug) AS path INTO result
      FROM public.pages p WHERE p.id = job.item_id;
  END IF;

  -- Same transaction as the publication above.
  UPDATE public.scheduled_actions
     SET status = 'succeeded', finished_at = now(), last_error = NULL,
         failure_kind = NULL, leased_by = NULL, leased_until = NULL
   WHERE id = p_id;

  RETURN QUERY SELECT result.published_version_id, result.revision, result.path;
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
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  page_path := app.page_path(head.slug);
  next_rev := head.revision + 1;

  -- Routing is revoked before anything else, so an unpublished page stops being
  -- reachable even if a downstream cache purge is delayed.
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

CREATE OR REPLACE FUNCTION app.unpublish_page(p_page_id uuid, p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  RETURN app.unpublish_page_internal(p_page_id, p_expected_revision, 'user', actor, NULL);
END
$$;

-- =========================================================== worker identity ==
--
-- Defect 5: every worker function took the worker id as an argument and never
-- compared it to app.current_worker_id(). Worker B could pass worker A's id and
-- settle A's events, close out A's schedules, or forge A's heartbeat — directly
-- against SPEC §4's "accepts no caller-supplied actor identity".
--
-- The parameter is removed rather than validated. A check can be forgotten in a
-- new function; a value that does not exist cannot be passed at all. The worker
-- identity now comes only from the session GUC that asWorker() sets.

DROP FUNCTION IF EXISTS app.claim_outbox(text, int, int);
DROP FUNCTION IF EXISTS app.claim_outbox(int);
DROP FUNCTION IF EXISTS app.settle_outbox(bigint, text, boolean, text, boolean);
DROP FUNCTION IF EXISTS app.settle_outbox(bigint, boolean, text);
DROP FUNCTION IF EXISTS app.claim_scheduled_action(text, int);
DROP FUNCTION IF EXISTS app.complete_scheduled_action(uuid, text, scheduled_status, text);
DROP FUNCTION IF EXISTS app.fail_scheduled_action(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS app.worker_heartbeat(text, text, text);

CREATE OR REPLACE FUNCTION app.require_worker() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE worker text;
BEGIN
  worker := app.current_worker_id();
  IF worker IS NULL OR worker = '' THEN
    RAISE EXCEPTION 'no worker identity on this session' USING ERRCODE = 'CMS02';
  END IF;
  RETURN worker;
END
$$;

CREATE OR REPLACE FUNCTION app.worker_heartbeat(p_role text, p_version text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE seen timestamptz; worker text;
BEGIN
  worker := app.require_worker();
  INSERT INTO public.job_heartbeats (worker_id, role, version)
  VALUES (worker, COALESCE(p_role, 'worker'), COALESCE(p_version, ''))
  ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), version = EXCLUDED.version
  RETURNING last_seen_at INTO seen;
  RETURN seen;
END
$$;

-- Defect 4: the limit is gone. drainOutbox used to lease a whole batch and then
-- process it sequentially, so with slow deliveries the lease on later rows
-- expired before their turn came and another worker took them — at-least-once
-- turned into concurrently-twice. The worker now claims one event immediately
-- before processing it, so a lease never has to outlive work that has not
-- started.
CREATE OR REPLACE FUNCTION app.claim_outbox(p_lease_seconds int)
RETURNS TABLE (id bigint, site_id uuid, event_type text, payload jsonb, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text;
BEGIN
  worker := app.require_worker();

  RETURN QUERY
  UPDATE public.outbox o
     SET status = 'running', leased_by = worker,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempts = o.attempts + 1
   WHERE o.id = (
     SELECT c.id FROM public.outbox c
      WHERE c.status IN ('pending', 'running')
        AND c.next_attempt_at <= now()
        -- An active lease belongs to whoever holds it. Only a lapsed one is
        -- reclaimable, which recovers a crashed worker's work without letting a
        -- live one be robbed.
        AND (c.status = 'pending' OR c.leased_until < now())
      ORDER BY c.next_attempt_at, c.id
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING o.id, o.site_id, o.event_type, o.payload, o.attempts;
END
$$;

CREATE OR REPLACE FUNCTION app.settle_outbox(
  p_id bigint, p_ok boolean, p_error text, p_permanent boolean DEFAULT false
) RETURNS outbox_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status outbox_status; worker text;
BEGIN
  worker := app.require_worker();

  SELECT o.id, o.attempts, o.max_attempts, o.leased_by, o.status
    INTO row FROM public.outbox o WHERE o.id = p_id FOR UPDATE;
  IF row IS NULL THEN
    RAISE EXCEPTION 'no such outbox event %', p_id USING ERRCODE = 'CMS03';
  END IF;
  -- Settling something you do not hold would let a slow worker overwrite the
  -- result of the one that actually reclaimed the row.
  IF row.leased_by IS DISTINCT FROM worker OR row.status <> 'running' THEN
    RAISE EXCEPTION 'outbox event % is not leased by %', p_id, worker USING ERRCODE = 'CMS04';
  END IF;

  IF p_ok THEN
    next_status := 'delivered';
    UPDATE public.outbox
       SET status = next_status, processed_at = now(), last_error = NULL,
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
  ELSIF p_permanent OR row.attempts >= row.max_attempts THEN
    next_status := 'dead';
    UPDATE public.outbox
       SET status = next_status, failed_at = now(), last_error = p_error,
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
  ELSE
    next_status := 'pending';
    UPDATE public.outbox
       SET status = next_status, last_error = p_error,
           next_attempt_at = now() + app.retry_delay(row.attempts),
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_lease_seconds int)
RETURNS TABLE (id uuid, site_id uuid, item_type reviewable_type, item_id uuid,
               version_id uuid, action scheduled_action_kind, created_by uuid,
               attempt_count integer, max_attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE worker text;
BEGIN
  worker := app.require_worker();

  RETURN QUERY
  UPDATE public.scheduled_actions sa
     SET status = 'running', leased_by = worker,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempt_count = sa.attempt_count + 1
   WHERE sa.id = (
     SELECT c.id FROM public.scheduled_actions c
      WHERE c.run_at <= now()
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
      ORDER BY c.run_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
            sa.created_by, sa.attempt_count, sa.max_attempts;
END
$$;

-- A schedule that fails because authorization was lost, the content is gone, or
-- the pinned version is wrong is *done* — retrying cannot change any of those.
-- Only infrastructure failures are worth another attempt (SPEC §6.8).
CREATE OR REPLACE FUNCTION app.fail_scheduled_action(
  p_id uuid, p_error text, p_permanent boolean
) RETURNS scheduled_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status scheduled_status; worker text;
BEGIN
  worker := app.require_worker();

  SELECT sa.id, sa.site_id, sa.attempt_count, sa.max_attempts, sa.leased_by, sa.status
    INTO row FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;
  IF row IS NULL OR row.leased_by IS DISTINCT FROM worker OR row.status <> 'running' THEN
    RAISE EXCEPTION 'no running schedule % leased by %', p_id, worker USING ERRCODE = 'CMS04';
  END IF;

  IF p_permanent OR row.attempt_count >= row.max_attempts THEN
    next_status := 'failed';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, finished_at = now(),
           failure_kind = CASE WHEN p_permanent THEN 'permanent' ELSE 'attempts_exhausted' END,
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
    -- The scheduler acted; no publication happened, so this is its own entry.
    PERFORM app.write_audit(row.site_id, 'scheduler', NULL, 'schedule.failed', 'scheduled_action',
                            p_id, NULL, NULL,
                            jsonb_build_object('error', p_error, 'worker', worker,
                                               'permanent', p_permanent));
  ELSE
    next_status := 'pending';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, failure_kind = 'retryable',
           next_attempt_at = now() + app.retry_delay(row.attempt_count),
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
  END IF;

  RETURN next_status;
END
$$;

-- ============================================================ queue metrics ==
--
-- Defect 6: `retrying` counted attempts > 0, but claim_outbox increments
-- attempts on the FIRST claim. A perfectly healthy job in flight for the first
-- time was reported as a retry, so the dashboard's "Trying again" figure was
-- never zero while anything was running and told an operator nothing.
--
-- Retrying now means "has failed at least once and has not given up", which is
-- what someone reading the number assumes it means. Waiting and running are
-- also separated: "nothing has picked this up yet" and "this is being delivered
-- right now" are different situations with different causes.

DROP FUNCTION IF EXISTS app.job_queue_health();

CREATE OR REPLACE FUNCTION app.job_queue_health()
RETURNS TABLE (
  outbox_waiting bigint, outbox_running bigint, outbox_retrying bigint, outbox_dead bigint,
  outbox_oldest_waiting_seconds numeric,
  schedules_waiting bigint, schedules_running bigint, schedules_retrying bigint,
  schedules_failed bigint, schedules_overdue_seconds numeric,
  live_workers bigint, stale_workers bigint, last_heartbeat_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT
    -- Queued and not yet picked up.
    (SELECT count(*) FROM public.outbox WHERE status = 'pending'),
    -- Being delivered right now, by someone holding an unexpired lease.
    (SELECT count(*) FROM public.outbox
      WHERE status = 'running' AND leased_until > now()),
    -- Has failed before and is still trying. `last_error` is the evidence of a
    -- previous failure; attempts alone is not, because the first claim sets it.
    (SELECT count(*) FROM public.outbox
      WHERE status IN ('pending', 'running') AND last_error IS NOT NULL),
    (SELECT count(*) FROM public.outbox WHERE status = 'dead'),
    -- How long the oldest undelivered event has been waiting: the number that
    -- actually says "the queue is stuck".
    (SELECT EXTRACT(epoch FROM now() - min(created_at))
       FROM public.outbox WHERE status IN ('pending', 'running')),

    (SELECT count(*) FROM public.scheduled_actions WHERE status = 'pending'),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status = 'running' AND leased_until > now()),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status IN ('pending', 'running') AND failure_kind = 'retryable'),
    (SELECT count(*) FROM public.scheduled_actions WHERE status = 'failed'),
    (SELECT EXTRACT(epoch FROM now() - min(run_at))
       FROM public.scheduled_actions WHERE status IN ('pending', 'running') AND run_at <= now()),

    -- A heartbeat older than 60s is not a worker, whatever the row says.
    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at > now() - interval '60 seconds'),
    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at <= now() - interval '60 seconds'),
    (SELECT max(last_seen_at) FROM public.job_heartbeats)
$$;

-- ================================================================== grants ==
--
-- The publication core and the internal manifest builder are granted to NOBODY.
-- They accept an actor as an argument, so reachability by an application role
-- would be exactly the forged-actor hole this migration exists to close. Only
-- the SECURITY DEFINER wrappers can call them, and each derives its own actor.

REVOKE ALL ON FUNCTION app.publish_page_version(uuid, bigint, uuid, actor_type, uuid, int, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.unpublish_page_internal(uuid, bigint, actor_type, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.build_render_manifest_internal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.site_role_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.can_publish_as(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.require_worker() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.execute_scheduled_action(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_outbox(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_outbox(bigint, boolean, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_scheduled_action(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_scheduled_action(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.worker_heartbeat(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.job_queue_health() FROM PUBLIC;

-- The editor publishes its own drafts and nothing else.
GRANT EXECUTE ON FUNCTION
  app.publish_page(uuid, bigint, int, text, jsonb),
  app.unpublish_page(uuid, bigint),
  app.build_render_manifest(uuid),
  app.job_queue_health()
TO cms_authenticated_user;

-- The worker executes schedules through one command that publishes and settles
-- together. It is deliberately NOT granted publish_page or unpublish_page any
-- more: a scheduled publication must go through the path that pins the version
-- and commits the settlement with it.
GRANT EXECUTE ON FUNCTION
  app.execute_scheduled_action(uuid),
  app.claim_scheduled_action(int),
  app.fail_scheduled_action(uuid, text, boolean),
  app.claim_outbox(int),
  app.settle_outbox(bigint, boolean, text, boolean),
  app.worker_heartbeat(text, text),
  app.job_queue_health()
TO cms_worker;

REVOKE EXECUTE ON FUNCTION app.publish_page(uuid, bigint, int, text, jsonb) FROM cms_worker;
REVOKE EXECUTE ON FUNCTION app.unpublish_page(uuid, bigint) FROM cms_worker;

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
