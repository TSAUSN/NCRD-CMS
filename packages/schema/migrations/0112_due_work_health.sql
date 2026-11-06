-- Deferred cleanup and retry backoff are not overdue work before eligibility.
-- Count due waiting tasks and measure time from their eligibility, not creation.
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
    (SELECT count(*) FROM public.outbox WHERE status = 'pending' AND next_attempt_at <= now()),
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
    (SELECT count(*) FROM public.outbox WHERE status='dead' AND app.outbox_failure_is_active(id)),
    (SELECT EXTRACT(epoch FROM now() - min(GREATEST(created_at,next_attempt_at)))
       FROM public.outbox WHERE status='running' OR (status='pending' AND next_attempt_at<=now())),

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

-- Archived-site thumbnail failures are retained history, not active work.
CREATE OR REPLACE FUNCTION app.outbox_failure_is_active(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.outbox failed WHERE failed.id=p_id AND failed.status='dead'
 AND NOT (failed.event_type='section_def.thumbnail_requested' AND EXISTS(SELECT 1 FROM public.sites s WHERE s.id=failed.site_id AND (s.archived_at IS NOT NULL OR s.status='archived')))
 AND NOT EXISTS(SELECT 1 FROM app.thumbnail_retry_receipts receipt JOIN public.outbox retry ON retry.id=receipt.retry_id
 WHERE receipt.failed_id=failed.id AND retry.status IN ('delivered','dead')))
$$;
