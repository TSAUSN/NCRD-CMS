ALTER TABLE public.scheduled_actions ADD COLUMN request_id uuid UNIQUE,
  ADD COLUMN override_reason text, ADD COLUMN authorized_findings jsonb NOT NULL DEFAULT '[]';

CREATE FUNCTION app.scheduling_available() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.current_user_id() IS NOT NULL AND EXISTS(SELECT 1 FROM public.job_heartbeats
    WHERE role IN ('worker','drain') AND last_seen_at>now()-interval '60 seconds')
$$;

CREATE FUNCTION app.schedule_page_action(
  p_page_id uuid,p_expected_revision bigint,p_version_id uuid,p_action scheduled_action_kind,p_run_at timestamptz,
  p_policy int,p_readiness jsonb,p_override text,p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; version_row RECORD; existing RECORD; created uuid;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.pages WHERE id=p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'page not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'only an editor may schedule this page' USING ERRCODE='CMS02'; END IF;
  IF head.archived_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND status='archived') THEN
    RAISE EXCEPTION 'archived content cannot be scheduled' USING ERRCODE='CMS04';
  END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'a schedule needs a request reference' USING ERRCODE='CMS04'; END IF;
  SELECT * INTO existing FROM public.scheduled_actions WHERE request_id=p_request_id;
  IF existing IS NOT NULL THEN
    IF existing.created_by<>actor OR existing.item_id<>p_page_id OR existing.version_id<>p_version_id
       OR existing.action IS DISTINCT FROM p_action OR existing.run_at IS DISTINCT FROM p_run_at
       OR existing.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') THEN
      RAISE EXCEPTION 'this schedule request was already used for a different intention' USING ERRCODE='CMS04';
    END IF;
    RETURN existing.id;
  END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'this page changed; reload before scheduling' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
  IF NOT app.scheduling_available() THEN RAISE EXCEPTION 'no healthy scheduling worker is available' USING ERRCODE='CMS04'; END IF;
  IF p_run_at IS NULL OR p_run_at<clock_timestamp()+interval '1 minute' OR p_run_at>clock_timestamp()+interval '2 years' THEN
    RAISE EXCEPTION 'choose a time at least a minute from now and within two years' USING ERRCODE='CMS04';
  END IF;
  SELECT id,carries_trusted_code,trusted_code_approved_by INTO version_row FROM public.page_versions WHERE id=p_version_id AND page_id=p_page_id;
  IF version_row IS NULL THEN RAISE EXCEPTION 'that version does not belong to this page' USING ERRCODE='CMS03'; END IF;
  IF p_action='publish' THEN
    PERFORM app.assert_publishable(p_readiness,p_policy,p_override);
    IF version_row.carries_trusted_code AND version_row.trusted_code_approved_by IS NULL THEN
      RAISE EXCEPTION 'approve this version’s custom code before scheduling it' USING ERRCODE='CMS05';
    END IF;
  ELSIF p_action='unpublish' THEN
    IF head.published_version_id IS DISTINCT FROM p_version_id THEN RAISE EXCEPTION 'choose the currently live version to unpublish' USING ERRCODE='CMS04'; END IF;
    IF NULLIF(btrim(p_override),'') IS NOT NULL THEN RAISE EXCEPTION 'unpublishing does not use a readiness override' USING ERRCODE='CMS04'; END IF;
  ELSE RAISE EXCEPTION 'choose publish or unpublish' USING ERRCODE='CMS04'; END IF;
  INSERT INTO public.scheduled_actions(site_id,item_type,item_id,version_id,action,run_at,created_by,
    readiness_policy_version,request_id,override_reason,authorized_findings)
  VALUES(head.site_id,'page',p_page_id,p_version_id,p_action,p_run_at,actor,p_policy,p_request_id,NULLIF(btrim(p_override),''),COALESCE(p_readiness,'[]'))
  RETURNING id INTO created;
  PERFORM app.write_audit(head.site_id,'user',actor,'schedule.create','scheduled_action',created,NULL,p_version_id,
    jsonb_build_object('page_id',p_page_id,'version_id',p_version_id,'action',p_action,'run_at',p_run_at,'override_reason',NULLIF(btrim(p_override),'')));
  RETURN created;
END $$;

CREATE FUNCTION app.cancel_page_schedule(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; job RECORD;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO job FROM public.scheduled_actions WHERE id=p_id FOR UPDATE;
  IF job IS NULL THEN RAISE EXCEPTION 'schedule not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(job.site_id) THEN RAISE EXCEPTION 'only an editor may cancel this schedule' USING ERRCODE='CMS02'; END IF;
  IF job.status='cancelled' THEN RETURN; END IF;
  IF job.status NOT IN ('pending','running') THEN RAISE EXCEPTION 'this schedule already finished' USING ERRCODE='CMS04'; END IF;
  UPDATE public.scheduled_actions SET status='cancelled',finished_at=now(),leased_by=NULL,leased_until=NULL,lease_token_hash=NULL WHERE id=p_id;
  PERFORM app.write_audit(job.site_id,'user',actor,'schedule.cancel','scheduled_action',p_id,job.version_id,NULL,'{}');
END $$;

REVOKE ALL ON FUNCTION app.scheduling_available(),app.schedule_page_action(uuid,bigint,uuid,scheduled_action_kind,timestamptz,int,jsonb,text,uuid),app.cancel_page_schedule(uuid) FROM PUBLIC;
ALTER FUNCTION app.scheduling_available() OWNER TO cms_migration_owner;
ALTER FUNCTION app.schedule_page_action(uuid,bigint,uuid,scheduled_action_kind,timestamptz,int,jsonb,text,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.cancel_page_schedule(uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.scheduling_available(),app.schedule_page_action(uuid,bigint,uuid,scheduled_action_kind,timestamptz,int,jsonb,text,uuid),app.cancel_page_schedule(uuid) TO cms_authenticated_user;
GRANT SELECT (request_id,override_reason,authorized_findings) ON public.scheduled_actions TO cms_authenticated_user;

CREATE OR REPLACE FUNCTION app.execute_scheduled_action(
  p_id uuid, p_lease_token uuid, p_readiness_policy_version int, p_readiness jsonb
) RETURNS TABLE (outcome text, published_version_id uuid, revision bigint, path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE job RECORD; result RECORD; blocking text[]; live_page RECORD;
BEGIN
  PERFORM app.require_worker();

  SELECT sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action,
         sa.created_by, sa.status, sa.lease_token_hash, sa.leased_until,
         sa.readiness_policy_version, sa.override_reason, sa.authorized_findings
    INTO job
    FROM public.scheduled_actions sa WHERE sa.id = p_id FOR UPDATE;

  IF job IS NULL OR job.status <> 'running'
     OR NOT app.lease_matches(job.lease_token_hash, p_lease_token) THEN
    RAISE EXCEPTION 'schedule % is not held by this lease', p_id USING ERRCODE = 'CMS04';
  END IF;
  IF job.leased_until IS NULL OR job.leased_until < clock_timestamp() THEN
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
    IF array_length(blocking, 1) > 0 AND (
      job.override_reason IS NULL OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_readiness) finding
         WHERE finding->>'severity'='blocking' AND NOT (job.authorized_findings @> jsonb_build_array(finding))
      )) THEN
      -- An override covers only the findings reviewed when the schedule was
      -- created. A newly introduced problem still fails closed.
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
      job.readiness_policy_version, job.override_reason, p_readiness,
      jsonb_build_object('scheduled_action_id', p_id));

  ELSIF job.action = 'unpublish' THEN
    -- Readiness is a question about content going live. Taking a page down
    -- cannot be blocked by the quality of what it contained.
    IF NOT app.can_publish_as(job.created_by, job.site_id) THEN
      RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
    END IF;
    SELECT p.published_version_id,app.page_path(v.page_slug) AS path INTO live_page
      FROM public.pages p JOIN public.page_versions v ON v.id=p.published_version_id
     WHERE p.id=job.item_id FOR UPDATE OF p;
    IF live_page.published_version_id IS DISTINCT FROM job.version_id THEN
      RAISE EXCEPTION 'another version is live; review the scheduled unpublish intention' USING ERRCODE='CMS04';
    END IF;
    PERFORM app.unpublish_page_internal(job.item_id, NULL, 'scheduler', job.created_by, p_id);
    SELECT NULL::uuid AS published_version_id, (p.revision) AS revision,
           live_page.path AS path INTO result
      FROM public.pages p WHERE p.id = job.item_id;
  ELSE
    RAISE EXCEPTION 'unsupported scheduled action %', job.action USING ERRCODE = 'CMS04';
  END IF;

  UPDATE public.scheduled_actions
     SET status = 'succeeded', finished_at = now(), last_error = NULL,
         failure_kind = NULL, readiness_report = p_readiness,
         leased_by = NULL, leased_until = NULL, lease_token_hash = NULL
   WHERE id = p_id;

  RETURN QUERY SELECT CASE WHEN job.action='publish' THEN 'published'::text ELSE 'unpublished'::text END, result.published_version_id, result.revision, result.path;
END
$$;
