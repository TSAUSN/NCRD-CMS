-- Manual retries are new, linked intentions. Failed attempts retain their
-- original actor, timestamps, errors, lease history and readiness evidence.
ALTER TABLE public.scheduled_actions
  ADD COLUMN retry_of_id uuid UNIQUE REFERENCES public.scheduled_actions(id),
  ADD CONSTRAINT schedule_retry_not_self CHECK(retry_of_id IS NULL OR retry_of_id<>id);
GRANT SELECT (retry_of_id) ON public.scheduled_actions TO cms_authenticated_user;

CREATE FUNCTION app.retry_page_schedule(
  p_failed_id uuid,p_expected_page_revision bigint,p_run_at timestamptz,
  p_policy int,p_readiness jsonb,p_override text,p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; failed RECORD; head RECORD; previous RECORD; existing RECORD; created uuid;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO failed FROM public.scheduled_actions WHERE id=p_failed_id;
  IF failed.id IS NULL THEN RAISE EXCEPTION 'schedule not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(failed.site_id) THEN RAISE EXCEPTION 'only an editor may retry this schedule' USING ERRCODE='CMS02'; END IF;
  IF failed.item_type<>'page' OR failed.status<>'failed' THEN
    RAISE EXCEPTION 'only a failed page schedule can be retried' USING ERRCODE='CMS04';
  END IF;
  -- Lock the page first, matching ordinary schedule creation. A failed source
  -- cannot be claimed again, so no in-flight worker publication is reset.
  SELECT * INTO head FROM public.pages WHERE id=failed.item_id FOR UPDATE;
  SELECT * INTO failed FROM public.scheduled_actions WHERE id=p_failed_id FOR UPDATE;
  IF head.id IS NULL THEN RAISE EXCEPTION 'page not found' USING ERRCODE='CMS03'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'a retry needs a request reference' USING ERRCODE='CMS04'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,56));
  SELECT * INTO existing FROM public.scheduled_actions WHERE request_id=p_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.retry_of_id IS DISTINCT FROM p_failed_id OR existing.created_by<>actor
      OR existing.run_at IS DISTINCT FROM p_run_at OR existing.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') THEN
      RAISE EXCEPTION 'this retry request was used for a different intention' USING ERRCODE='CMS04';
    END IF;
    RETURN existing.id;
  END IF;
  SELECT * INTO previous FROM public.scheduled_actions WHERE retry_of_id=p_failed_id;
  IF previous.id IS NOT NULL THEN
    RAISE EXCEPTION 'a retry already exists for this failure; review that attempt before creating more work' USING ERRCODE='CMS04';
  END IF;
  -- The existing creation command rechecks revision, active content, current
  -- actor, worker heartbeat, future time, trusted code and the fresh report.
  -- Its unpublish branch also refuses to remove a different live version.
  created:=app.schedule_page_action(failed.item_id,p_expected_page_revision,failed.version_id,failed.action,p_run_at,
    p_policy,p_readiness,p_override,p_request_id);
  UPDATE public.scheduled_actions SET retry_of_id=p_failed_id WHERE id=created;
  PERFORM app.write_audit(failed.site_id,'user',actor,'schedule.retry','scheduled_action',created,failed.version_id,failed.version_id,
    jsonb_build_object('retry_of_id',p_failed_id,'previous_actor',failed.created_by,'action',failed.action,'run_at',p_run_at));
  RETURN created;
END $$;
REVOKE ALL ON FUNCTION app.retry_page_schedule(uuid,bigint,timestamptz,int,jsonb,text,uuid) FROM PUBLIC;
ALTER FUNCTION app.retry_page_schedule(uuid,bigint,timestamptz,int,jsonb,text,uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.retry_page_schedule(uuid,bigint,timestamptz,int,jsonb,text,uuid) TO cms_authenticated_user;
