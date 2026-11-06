-- Expired claims count toward the existing retry limit even when a process
-- stops before it can record failure. Active leases and locked rows are left alone.

CREATE OR REPLACE FUNCTION app.claim_outbox(p_lease_seconds integer, p_exclude bigint[] DEFAULT '{}'::bigint[])
 RETURNS TABLE(id bigint, site_id uuid, event_type text, payload jsonb, attempts integer, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  worker := app.require_worker();
  token := gen_random_uuid();

  -- Bound each sweep; concurrent workers skip work held by another transaction.
  WITH exhausted AS (
    SELECT c.id FROM public.outbox c
     WHERE c.attempts >= c.max_attempts
       AND c.next_attempt_at <= now()
       AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
     ORDER BY c.id
     FOR UPDATE SKIP LOCKED LIMIT 100
  )
  UPDATE public.outbox failed
     SET status = 'dead', failed_at = now(),
         last_error = 'Background work could not finish after repeated interruptions. Review it before trying again.',
         leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
    FROM exhausted WHERE failed.id = exhausted.id;

  RETURN QUERY
  UPDATE public.outbox o
     SET status = 'running', leased_by = worker,
         lease_token_hash = app.lease_digest(token),
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempts = o.attempts + 1
   WHERE o.id = (
     SELECT c.id FROM public.outbox c
      WHERE c.status IN ('pending', 'running')
        AND c.attempts < c.max_attempts
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR c.leased_until < now())
        AND NOT (c.id = ANY (COALESCE(p_exclude, '{}'::bigint[])))
      ORDER BY c.next_attempt_at, c.id
      FOR UPDATE SKIP LOCKED LIMIT 1)
  -- `token`, not a column: the raw capability leaves through this result set
  -- and is never written anywhere.
  RETURNING o.id, o.site_id, o.event_type, o.payload, o.attempts, token;
END
$function$;

CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_lease_seconds integer)
 RETURNS TABLE(id uuid, site_id uuid, item_type reviewable_type, item_id uuid, version_id uuid, action scheduled_action_kind, created_by uuid, attempt_count integer, max_attempts integer, readiness_policy_version integer, lease_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
#variable_conflict use_column
DECLARE worker text; token uuid;
BEGIN
  worker := app.require_worker();
  token := gen_random_uuid();

  -- Bound each sweep; concurrent workers skip work held by another transaction.
  WITH exhausted AS (
    SELECT c.id FROM public.scheduled_actions c
     WHERE c.attempt_count >= c.max_attempts
       AND c.next_attempt_at <= now() AND c.run_at <= now()
       AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
     ORDER BY c.id
     FOR UPDATE SKIP LOCKED LIMIT 100
  )
  UPDATE public.scheduled_actions failed
     SET status = 'failed', finished_at = now(), failure_kind = 'attempts_exhausted',
         last_error = 'This schedule could not finish after repeated interruptions. Review the page before trying again.',
         leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
    FROM exhausted WHERE failed.id = exhausted.id;

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
        AND c.attempt_count < c.max_attempts
        AND c.next_attempt_at <= now()
        AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
      ORDER BY c.run_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
            sa.created_by, sa.attempt_count, sa.max_attempts,
            sa.readiness_policy_version, token;
END
$function$;
