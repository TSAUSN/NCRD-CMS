-- 0007 — hardening the Postgres-native job transport (ADR 0003).
--
-- What 0003's first cut got wrong, and what this fixes:
--
--   * `claim_outbox` was an ordinary SELECT ... LIMIT. Two workers running at
--     once received the same rows and both delivered them. It now leases with
--     FOR UPDATE SKIP LOCKED.
--   * A failed row was immediately eligible again, so one poison event sat at
--     the head of every batch and starved everything behind it. Failures now
--     back off exponentially with jitter, and give up into a terminal state.
--   * Nothing distinguished "this will never work" from "the database blinked".
--     Domain refusals now fail closed at once; infrastructure errors retry.
--
-- The claim/settle split also exists so the worker never holds a transaction
-- open across external I/O. Claim is one short transaction, delivery happens
-- outside any transaction, settlement is another short transaction.

CREATE TYPE outbox_status AS ENUM ('pending', 'running', 'delivered', 'dead');

ALTER TABLE outbox
  ADD COLUMN status          outbox_status NOT NULL DEFAULT 'pending',
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN max_attempts    integer NOT NULL DEFAULT 8,
  ADD COLUMN leased_by       text,
  ADD COLUMN leased_until    timestamptz,
  ADD COLUMN failed_at       timestamptz;

-- Existing rows: anything already processed is delivered, the rest is pending.
UPDATE outbox SET status = 'delivered' WHERE processed_at IS NOT NULL;

ALTER TABLE outbox
  ADD CONSTRAINT outbox_delivered_pairing
    CHECK ((status = 'delivered') = (processed_at IS NOT NULL)),
  ADD CONSTRAINT outbox_dead_pairing
    CHECK ((status = 'dead') = (failed_at IS NOT NULL)),
  ADD CONSTRAINT outbox_max_attempts_positive CHECK (max_attempts > 0);

DROP INDEX IF EXISTS outbox_unprocessed;
-- The ready set: what a claim actually scans. Dead and delivered rows are not
-- in this index at all, so a poison event stops costing anything to skip.
CREATE INDEX outbox_ready ON outbox (next_attempt_at, id)
  WHERE status IN ('pending', 'running');

-- Backoff: doubling from 5s, capped at 10 minutes, with up to 25% jitter so a
-- batch of simultaneous failures does not retry in lockstep.
CREATE OR REPLACE FUNCTION app.retry_delay(p_attempt int)
RETURNS interval LANGUAGE sql VOLATILE AS $$
  SELECT make_interval(secs =>
    LEAST(600, 5 * power(2, GREATEST(0, LEAST(p_attempt, 10) - 1))::numeric)
    * (0.75 + random() * 0.25))
$$;

-- --------------------------------------------------------------- outbox --

DROP FUNCTION IF EXISTS app.claim_outbox(int);

CREATE OR REPLACE FUNCTION app.claim_outbox(p_worker_id text, p_limit int, p_lease_seconds int)
RETURNS TABLE (id bigint, site_id uuid, event_type text, payload jsonb, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
BEGIN
  IF p_worker_id IS NULL OR p_worker_id = '' THEN
    RAISE EXCEPTION 'a claim must name the worker taking the lease' USING ERRCODE = 'CMS04';
  END IF;

  RETURN QUERY
  UPDATE public.outbox o
     SET status = 'running',
         leased_by = p_worker_id,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT c.id FROM public.outbox c
      WHERE c.status IN ('pending', 'running')
        AND c.next_attempt_at <= now()
        -- An active lease belongs to whoever holds it. Only a lapsed one is
        -- reclaimable, which is what makes a crashed worker recoverable
        -- without letting a live one be robbed.
        AND (c.status = 'pending' OR c.leased_until < now())
      ORDER BY c.next_attempt_at, c.id
      FOR UPDATE SKIP LOCKED
      LIMIT GREATEST(1, COALESCE(p_limit, 50)))
  RETURNING o.id, o.site_id, o.event_type, o.payload, o.attempts;
END
$$;

DROP FUNCTION IF EXISTS app.settle_outbox(bigint, boolean, text);

-- p_permanent lets the caller say "this will never succeed" — a malformed
-- event or an unknown event type — so it dead-letters immediately instead of
-- burning eight attempts to reach the same conclusion.
CREATE OR REPLACE FUNCTION app.settle_outbox(
  p_id bigint, p_worker_id text, p_ok boolean, p_error text, p_permanent boolean DEFAULT false
) RETURNS outbox_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status outbox_status;
BEGIN
  SELECT o.id, o.attempts, o.max_attempts, o.leased_by, o.status
    INTO row FROM public.outbox o WHERE o.id = p_id FOR UPDATE;
  IF row IS NULL THEN
    RAISE EXCEPTION 'no such outbox event %', p_id USING ERRCODE = 'CMS03';
  END IF;
  -- Settling something you do not hold would let a slow worker overwrite the
  -- result of the one that actually reclaimed the row.
  IF row.leased_by IS DISTINCT FROM p_worker_id OR row.status <> 'running' THEN
    RAISE EXCEPTION 'outbox event % is not leased by %', p_id, p_worker_id USING ERRCODE = 'CMS04';
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

-- ---------------------------------------------------- scheduled actions --

ALTER TABLE scheduled_actions
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN max_attempts    integer NOT NULL DEFAULT 5,
  ADD COLUMN failure_kind    text;

ALTER TABLE scheduled_actions
  ADD CONSTRAINT scheduled_actions_max_attempts_positive CHECK (max_attempts > 0);

DROP INDEX IF EXISTS scheduled_actions_due;
CREATE INDEX scheduled_actions_due ON scheduled_actions (run_at, next_attempt_at)
  WHERE status IN ('pending', 'running');

-- The returned row gains attempt_count/max_attempts, so the old signature has
-- to go before the new one can take its name.
DROP FUNCTION IF EXISTS app.claim_scheduled_action(text, int);

CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_worker_id text, p_lease_seconds int)
RETURNS TABLE (id uuid, site_id uuid, item_type reviewable_type, item_id uuid,
               version_id uuid, action scheduled_action_kind, created_by uuid,
               attempt_count integer, max_attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
BEGIN
  IF p_worker_id IS NULL OR p_worker_id = '' THEN
    RAISE EXCEPTION 'a claim must name the worker taking the lease' USING ERRCODE = 'CMS04';
  END IF;

  RETURN QUERY
  UPDATE public.scheduled_actions sa
     SET status = 'running', leased_by = p_worker_id,
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
-- the revision moved is *done* — retrying cannot change any of those. Only
-- infrastructure failures are worth another attempt (SPEC §6.8's "fail closed
-- with an actionable reason").
CREATE OR REPLACE FUNCTION app.fail_scheduled_action(
  p_id uuid, p_worker_id text, p_error text, p_permanent boolean
) RETURNS scheduled_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD; next_status scheduled_status;
BEGIN
  SELECT sa.id, sa.site_id, sa.attempt_count, sa.max_attempts, sa.leased_by, sa.status
    INTO row FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;
  IF row IS NULL OR row.leased_by IS DISTINCT FROM p_worker_id OR row.status <> 'running' THEN
    RAISE EXCEPTION 'no running schedule % leased by %', p_id, p_worker_id USING ERRCODE = 'CMS04';
  END IF;

  IF p_permanent OR row.attempt_count >= row.max_attempts THEN
    next_status := 'failed';
    UPDATE public.scheduled_actions
       SET status = next_status, last_error = p_error, finished_at = now(),
           failure_kind = CASE WHEN p_permanent THEN 'permanent' ELSE 'attempts_exhausted' END,
           leased_by = NULL, leased_until = NULL
     WHERE id = p_id;
    PERFORM app.write_audit(row.site_id, 'scheduler', NULL, 'schedule.failed', 'scheduled_action',
                            p_id, NULL, NULL,
                            jsonb_build_object('error', p_error, 'worker', p_worker_id,
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

-- --------------------------------------------------------- observability --

-- One row of operational truth (SPEC §6.15): what is waiting, how long the
-- oldest thing has waited, what is retrying, what has given up, and whether a
-- worker is actually alive to do any of it.
CREATE OR REPLACE FUNCTION app.job_queue_health()
RETURNS TABLE (
  outbox_pending bigint, outbox_retrying bigint, outbox_dead bigint,
  outbox_oldest_pending_seconds numeric,
  schedules_pending bigint, schedules_retrying bigint, schedules_failed bigint,
  schedules_overdue_seconds numeric,
  live_workers bigint, stale_workers bigint, last_heartbeat_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT
    (SELECT count(*) FROM public.outbox WHERE status IN ('pending','running')),
    (SELECT count(*) FROM public.outbox WHERE status IN ('pending','running') AND attempts > 0),
    (SELECT count(*) FROM public.outbox WHERE status = 'dead'),
    (SELECT EXTRACT(epoch FROM now() - min(created_at))
       FROM public.outbox WHERE status IN ('pending','running')),
    (SELECT count(*) FROM public.scheduled_actions WHERE status IN ('pending','running')),
    (SELECT count(*) FROM public.scheduled_actions
      WHERE status IN ('pending','running') AND attempt_count > 0),
    (SELECT count(*) FROM public.scheduled_actions WHERE status = 'failed'),
    (SELECT EXTRACT(epoch FROM now() - min(run_at))
       FROM public.scheduled_actions WHERE status IN ('pending','running') AND run_at <= now()),
    -- A heartbeat older than 60s is not a worker, whatever the row says.
    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at > now() - interval '60 seconds'),
    (SELECT count(*) FROM public.job_heartbeats WHERE last_seen_at <= now() - interval '60 seconds'),
    (SELECT max(last_seen_at) FROM public.job_heartbeats)
$$;

-- ---------------------------------------------------------------- grants --

REVOKE ALL ON FUNCTION app.claim_outbox(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.settle_outbox(bigint, text, boolean, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_scheduled_action(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.retry_delay(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.job_queue_health() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.claim_outbox(text, int, int),
  app.settle_outbox(bigint, text, boolean, text, boolean),
  app.claim_scheduled_action(text, int),
  app.fail_scheduled_action(uuid, text, text, boolean),
  app.job_queue_health()
TO cms_worker;

-- The product shows queue health on the dashboard, so an operator learns about
-- a stalled queue from the app rather than from a user complaint.
GRANT EXECUTE ON FUNCTION app.job_queue_health() TO cms_authenticated_user;

GRANT SELECT ON outbox TO cms_authenticated_user;

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

-- Admin may read the queue, never write it.
CREATE POLICY outbox_member_read ON outbox FOR SELECT TO cms_authenticated_user
  USING (site_id IS NULL OR app.has_site_access(site_id));
