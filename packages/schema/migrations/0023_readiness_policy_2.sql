-- 0023 — readiness policy 2, and what becomes of the schedules pinned to 1.
--
-- @cms/domain's READINESS_POLICY_VERSION is now 2. Version 2 implements
-- `refused_canonical`, the last of SPEC §6.8's blocking readiness rules that
-- `runReadinessChecks` did not: an author who typed a canonical link naming
-- another host was never told it had been ignored, because the renderer's
-- fallback replaces the refused value with the page's own address and publishes
-- a page that looks entirely correct. None of that rule lives in SQL — it needs
-- a rendered page, which SQL does not produce — but the version number does,
-- because a schedule pins it.
--
-- THE PROBLEM THE BUMP CREATES
--
-- `scheduled_actions.readiness_policy_version` is fixed when the schedule is
-- created, and `app.execute_scheduled_action` raises CMS04 when the version the
-- worker checked against is not the version the schedule pinned. That check is
-- correct and stays: it is what stops a schedule agreed under one policy from
-- being judged by a policy nobody agreed to. But it means that the moment the
-- worker starts reporting version 2, every schedule already pinned to 1 fails —
-- and the worker classifies CMS04 as permanent, so it fails once, terminally,
-- on the date somebody's release was supposed to go out, with a message about
-- policy version numbers and no remedy but recreating the schedule.
--
-- WHAT THIS DOES INSTEAD, AND WHY IT IS NOT A SILENT REINTERPRETATION
--
-- Every schedule that has not run yet has its pin carried forward from 1 to 2,
-- and each carry writes one audit row naming both versions. Three things make
-- that the honest answer rather than a shortcut:
--
--   * Version 2 adds a rule and relaxes none. Every verdict version 1 reached,
--     version 2 still reaches, so nothing version 1 refused becomes publishable
--     and no page goes live that would not have gone live anyway. The move is
--     one-way and monotonically stricter, which is why the function below
--     refuses to carry a pin backwards onto an older, more permissive policy.
--   * The only schedule whose outcome can change is one whose canonical link
--     was going to be refused — and that schedule publishes today, silently
--     dropping the author's canonical. Under version 2 it stops instead, with
--     `failure_kind = 'readiness'`, `refused_canonical` in `last_error`, and a
--     `schedule.blocked` audit row. That is not a reinterpretation of the
--     release; it is the feedback this policy version exists to produce,
--     arriving before the page goes out rather than never.
--   * It is visible, in the two places an operator actually looks. One
--     `schedule.readiness_policy_superseded` row per moved schedule lands in
--     that site's audit feed carrying the old version, the new version, the
--     reason, the pinned page and version, and the run time; and the function
--     raises a NOTICE with the count, so the deploy log carries it too.
--
-- The alternatives are worse. Leaving the pins alone means one permanent,
-- confusing failure per pending release, spread over whenever each was due.
-- Failing them all here is louder still but cancels releases whose content was
-- never in question, punishing every author for a rule that concerns one field.
--
-- DEPLOYMENT NOTE — these two halves belong in the same release. Between this
-- migration and a worker carrying READINESS_POLICY_VERSION = 2 there is a
-- window in which the pins and the worker disagree, and CMS04 is permanent in
-- `apps/worker/src/handlers.ts`, so a schedule firing inside that window dies
-- and needs `retryScheduledAction`. Nothing publishes wrongly — the mismatch
-- fails closed — but the window should be minutes, not a deploy apart.

-- ================================================== carrying a pin forward ==

/*
 * Move every not-yet-run schedule from one readiness policy version to the
 * next, and say so once per schedule. Returns how many moved.
 *
 * A function rather than a bare UPDATE in this file, because this is not the
 * last policy version there will ever be and the guards are the part that has
 * to be identical next time: forward only, a stated reason, one audit row per
 * schedule. A future bump calls this with its own two numbers.
 *
 * Re-running it is a no-op: the second call finds nothing still pinned to
 * `p_from`, moves nothing, and writes nothing.
 */
CREATE OR REPLACE FUNCTION app.carry_forward_readiness_policy(
  p_from int, p_to int, p_reason text
) RETURNS integer
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE sched RECORD; moved integer := 0;
BEGIN
  -- Forward only. Re-pinning a schedule onto an older policy would judge it by
  -- a more permissive rule set than the one in force, which is the one way this
  -- operation could let something through that the current policy refuses.
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION
      'a readiness policy pin may only be carried forward, and % to % is not forward',
      p_from, p_to USING ERRCODE = 'CMS04';
  END IF;
  -- The reason is written into every audit row this produces. A pin moved with
  -- no recorded justification is exactly the silent reinterpretation this
  -- migration exists to avoid.
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'carrying schedules onto another readiness policy requires a stated reason'
      USING ERRCODE = 'CMS04';
  END IF;

  -- 'pending' and 'running' are exactly the rows `app.claim_scheduled_action`
  -- can still pick up. Everything else is history and is left alone: rewriting
  -- the policy version of a schedule that already ran would falsify the record
  -- of what it was judged by.
  --
  -- A row being executed at this moment holds FOR UPDATE inside
  -- `app.execute_scheduled_action`, so this statement blocks on it and then
  -- re-checks the status that transaction committed. A schedule that publishes
  -- mid-migration under its own pin is therefore skipped rather than rewritten
  -- underneath itself.
  FOR sched IN
    WITH carried AS (
      UPDATE public.scheduled_actions sa
         SET readiness_policy_version = p_to
       WHERE sa.readiness_policy_version = p_from
         AND sa.status IN ('pending', 'running')
      RETURNING sa.id, sa.site_id, sa.item_id, sa.version_id, sa.action,
                sa.run_at, sa.created_by
    )
    SELECT * FROM carried
  LOOP
    -- 'migration', not 'user' and not 'scheduler': nobody in the product asked
    -- for this, the person deploying did, and audit_log's shape constraint only
    -- lets a 'user' row name an actor. Same reasoning as 0018's revalidation.
    --
    -- The site is named rather than left NULL so the row appears in that site's
    -- own audit feed, next to the schedule it is about.
    PERFORM app.write_audit(
      sched.site_id, 'migration', NULL, 'schedule.readiness_policy_superseded',
      'scheduled_action', sched.id, NULL, NULL,
      jsonb_build_object(
        'from_readiness_policy_version', p_from,
        'to_readiness_policy_version', p_to,
        'reason', p_reason,
        'page_id', sched.item_id,
        'version_id', sched.version_id,
        'action', sched.action,
        'run_at', sched.run_at,
        'authorized_by', sched.created_by));
    moved := moved + 1;
  END LOOP;

  RAISE NOTICE 'readiness policy % -> %: % scheduled action(s) carried forward',
    p_from, p_to, moved;
  RETURN moved;
END
$$;

-- ======================================================== the bump, applied ==

SELECT app.carry_forward_readiness_policy(
  1, 2,
  'readiness policy 2 adds the refused_canonical rule (SPEC §6.8) and relaxes none, so a '
  || 'schedule judged by it reaches every verdict version 1 reached');

-- ================================================================== grants ==
--
-- No application role may call this. Moving the policy a pinned schedule will
-- be judged by is an operator act carried out with the migration credential,
-- the same as 0018's revalidation; an editor changes a schedule by cancelling
-- it and creating another. The owner reaches it by owning it.

REVOKE ALL ON FUNCTION app.carry_forward_readiness_policy(int, int, text) FROM PUBLIC;

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
