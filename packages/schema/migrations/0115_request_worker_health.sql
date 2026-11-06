-- A one-minute authenticated request worker is healthy across normal trigger
-- jitter, but absence still closes scheduling. Continuous workers retain their
-- original 60-second contract. External absence/failure monitoring is separate.
CREATE FUNCTION app.worker_heartbeat_is_fresh(p_role text,p_seen timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT p_seen > now() - CASE WHEN p_role='request-worker' THEN interval '150 seconds' ELSE interval '60 seconds' END
$$;
ALTER FUNCTION app.worker_heartbeat_is_fresh(text,timestamptz) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.worker_heartbeat_is_fresh(text,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.worker_heartbeat(p_role text,p_version text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE seen timestamptz; worker text;
BEGIN
 worker:=app.require_worker();
 INSERT INTO public.job_heartbeats(worker_id,role,version)
 VALUES(worker,COALESCE(p_role,'worker'),COALESCE(p_version,''))
 ON CONFLICT(worker_id) DO UPDATE SET last_seen_at=now(),role=EXCLUDED.role,version=EXCLUDED.version
 RETURNING last_seen_at INTO seen;
 RETURN seen;
END
$$;

CREATE OR REPLACE FUNCTION app.scheduling_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.current_user_id() IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.job_heartbeats WHERE role IN ('worker','drain','request-worker')
  AND app.worker_heartbeat_is_fresh(role,last_seen_at))
$$;

CREATE OR REPLACE FUNCTION app.job_queue_health()
RETURNS TABLE (
 outbox_waiting bigint,outbox_running bigint,outbox_stalled bigint,
 outbox_retrying bigint,outbox_dead bigint,outbox_oldest_waiting_seconds numeric,
 schedules_waiting bigint,schedules_running bigint,schedules_stalled bigint,
 schedules_retrying bigint,schedules_failed bigint,schedules_overdue_seconds numeric,
 live_workers bigint,stale_workers bigint,last_heartbeat_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT
 (SELECT count(*) FROM public.outbox WHERE status='pending' AND next_attempt_at<=now()),
 (SELECT count(*) FROM public.outbox WHERE status='running' AND leased_until>now()),
 (SELECT count(*) FROM public.outbox WHERE status='running' AND (leased_until IS NULL OR leased_until<=now())),
 (SELECT count(*) FROM public.outbox WHERE status IN ('pending','running') AND last_error IS NOT NULL),
 (SELECT count(*) FROM public.outbox WHERE status='dead' AND app.outbox_failure_is_active(id)),
 (SELECT EXTRACT(epoch FROM now()-min(GREATEST(created_at,next_attempt_at))) FROM public.outbox
   WHERE status='running' OR (status='pending' AND next_attempt_at<=now())),
 (SELECT count(*) FROM public.scheduled_actions WHERE status='pending'),
 (SELECT count(*) FROM public.scheduled_actions WHERE status='running' AND leased_until>now()),
 (SELECT count(*) FROM public.scheduled_actions WHERE status='running' AND (leased_until IS NULL OR leased_until<=now())),
 (SELECT count(*) FROM public.scheduled_actions WHERE status IN ('pending','running') AND failure_kind='retryable'),
 (SELECT count(*) FROM public.scheduled_actions WHERE status='failed'),
 (SELECT EXTRACT(epoch FROM now()-min(run_at)) FROM public.scheduled_actions WHERE status IN ('pending','running') AND run_at<=now()),
 (SELECT count(*) FROM public.job_heartbeats WHERE app.worker_heartbeat_is_fresh(role,last_seen_at)),
 (SELECT count(*) FROM public.job_heartbeats WHERE NOT app.worker_heartbeat_is_fresh(role,last_seen_at)),
 (SELECT max(last_seen_at) FROM public.job_heartbeats)
$$;
