-- A schedule carries an immutable reviewed release, never a caller-selected
-- user or a mutable set of draft pointers. Execution reuses the admin engine.
ALTER TABLE public.scheduled_actions ADD COLUMN IF NOT EXISTS samples_confirmed boolean NOT NULL DEFAULT false;
GRANT SELECT(samples_confirmed) ON public.scheduled_actions TO cms_authenticated_user;

CREATE OR REPLACE FUNCTION app.schedule_release_action(
 p_release_id uuid,p_run_at timestamptz,p_override text,p_samples_confirmed boolean,p_request_id uuid,p_policy int
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; plan RECORD; old RECORD; created uuid; check_row jsonb; findings jsonb;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id;
 IF plan.id IS NULL THEN RAISE EXCEPTION 'release not found' USING ERRCODE='CMS03'; END IF;
 PERFORM app.lock_release_site(plan.site_id);
 SELECT * INTO plan FROM public.site_releases WHERE id=p_release_id FOR UPDATE;
 IF NOT app.can_publish(plan.site_id) OR (EXISTS(SELECT 1 FROM jsonb_array_elements(plan.snapshot) item WHERE item->>'requiresAdmin'='true') AND NOT app.can_administer_site(plan.site_id)) THEN
  RAISE EXCEPTION 'you cannot schedule these changes' USING ERRCODE='CMS02';
 END IF;
 IF p_request_id IS NULL OR p_policy IS NULL OR p_policy<1 OR p_samples_confirmed IS NULL OR length(COALESCE(p_override,''))>2000 THEN
  RAISE EXCEPTION 'a schedule needs an explicit review and request reference' USING ERRCODE='CMS04';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,56));
 SELECT * INTO old FROM public.scheduled_actions WHERE request_id=p_request_id;
 IF old.id IS NOT NULL THEN
  IF old.created_by<>actor OR old.item_type<>'release' OR old.item_id<>p_release_id OR old.run_at IS DISTINCT FROM p_run_at
   OR old.override_reason IS DISTINCT FROM NULLIF(btrim(p_override),'') OR old.samples_confirmed IS DISTINCT FROM p_samples_confirmed OR old.readiness_policy_version IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'this schedule request was used for different choices' USING ERRCODE='CMS04';
  END IF;
  RETURN old.id;
 END IF;
 IF plan.status<>'planned' OR EXISTS(SELECT 1 FROM public.sites WHERE id=plan.site_id AND status='archived') THEN
  RAISE EXCEPTION 'only a pending release on an active site can be scheduled' USING ERRCODE='CMS04';
 END IF;
 IF app.release_fingerprint(plan.site_id) IS DISTINCT FROM plan.context_hash THEN
  RAISE EXCEPTION 'the site changed; review these changes again' USING ERRCODE='CMS01';
 END IF;
 IF NOT app.scheduling_available() THEN RAISE EXCEPTION 'no healthy scheduling worker is available' USING ERRCODE='CMS04'; END IF;
 IF p_run_at IS NULL OR p_run_at<clock_timestamp()+interval '1 minute' OR p_run_at>clock_timestamp()+interval '2 years' THEN
  RAISE EXCEPTION 'choose a time at least a minute from now and within two years' USING ERRCODE='CMS04';
 END IF;
 FOR check_row IN SELECT value FROM jsonb_array_elements(plan.preview_report) LOOP
  IF (check_row->'report'->>'policyVersion')::int IS DISTINCT FROM p_policy THEN
   RAISE EXCEPTION 'the publishing checks changed; review these changes again' USING ERRCODE='CMS04';
  END IF;
  findings:=check_row->'report'->'findings';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(findings) finding WHERE finding->>'rule'='sample_content' AND finding->>'severity'='blocking') AND NOT p_samples_confirmed THEN
   RAISE EXCEPTION 'confirm the sample content before scheduling' USING ERRCODE='CMS04';
  END IF;
  IF p_samples_confirmed THEN SELECT COALESCE(jsonb_agg(value),'[]') INTO findings FROM jsonb_array_elements(findings) WHERE value->>'rule'<>'sample_content'; END IF;
  PERFORM app.assert_publishable(findings,(check_row->'report'->>'policyVersion')::int,p_override);
 END LOOP;
 INSERT INTO public.scheduled_actions(site_id,item_type,item_id,version_id,action,run_at,created_by,readiness_policy_version,request_id,override_reason,authorized_findings,samples_confirmed)
 VALUES(plan.site_id,'release',plan.id,plan.id,'publish',p_run_at,actor,p_policy,p_request_id,NULLIF(btrim(p_override),''),plan.preview_report,p_samples_confirmed) RETURNING id INTO created;
 PERFORM app.write_audit(plan.site_id,'user',actor,'schedule.create','scheduled_action',created,NULL,plan.id,
  jsonb_build_object('release_id',plan.id,'run_at',p_run_at,'samples_confirmed',p_samples_confirmed,'override_reason',NULLIF(btrim(p_override),'')));
 RETURN created;
END $$;

-- No actor supplied by HTTP is trusted. Only possession of the unguessable,
-- live queue lease can resolve the creator of this one stored intention.
CREATE OR REPLACE FUNCTION app.release_schedule_capability(p_id uuid,p_token uuid)
RETURNS TABLE(actor_id uuid,release_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT s.created_by,s.item_id FROM public.scheduled_actions s
 WHERE s.id=p_id AND s.item_type='release' AND s.action='publish' AND s.status='running'
 AND s.run_at<=clock_timestamp() AND s.leased_until>clock_timestamp() AND app.lease_matches(s.lease_token_hash,p_token)
$$;

CREATE OR REPLACE FUNCTION app.lock_release_schedule(p_id uuid,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; job RECORD;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO job FROM public.scheduled_actions WHERE id=p_id FOR UPDATE;
 IF job.id IS NULL OR job.item_type<>'release' OR job.action<>'publish' OR job.status<>'running'
  OR job.created_by<>actor OR job.run_at>clock_timestamp() OR job.leased_until IS NULL OR job.leased_until<=clock_timestamp()
  OR NOT app.lease_matches(job.lease_token_hash,p_token) THEN
  RAISE EXCEPTION 'this scheduled release is not held by this lease' USING ERRCODE='CMS04';
 END IF;
 IF NOT app.can_publish(job.site_id) OR EXISTS(SELECT 1 FROM public.sites WHERE id=job.site_id AND status='archived') THEN
  RAISE EXCEPTION 'the person who scheduled these changes can no longer publish them' USING ERRCODE='CMS02';
 END IF;
 -- Do not return the private lease digest, or permit a cross-site plan.
 IF NOT EXISTS(SELECT 1 FROM public.site_releases WHERE id=job.item_id AND site_id=job.site_id) THEN
  RAISE EXCEPTION 'the scheduled release is unavailable' USING ERRCODE='CMS03';
 END IF;
 RETURN jsonb_build_object('release_id',job.item_id,'override_reason',job.override_reason,'samples_confirmed',job.samples_confirmed,'readiness_policy_version',job.readiness_policy_version);
END $$;

CREATE OR REPLACE FUNCTION app.finish_release_schedule(p_id uuid,p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job jsonb; site uuid; actor uuid;
BEGIN
 job:=app.lock_release_schedule(p_id,p_token); actor:=app.require_actor();
 IF NOT EXISTS(SELECT 1 FROM public.site_releases WHERE id=(job->>'release_id')::uuid AND status='applied') THEN
  RAISE EXCEPTION 'the scheduled release has not been applied' USING ERRCODE='CMS04';
 END IF;
 UPDATE public.scheduled_actions SET status='succeeded',finished_at=now(),last_error=NULL,failure_kind=NULL,
  leased_by=NULL,leased_until=NULL,lease_token_hash=NULL,
  readiness_report=(SELECT detail->'readiness' FROM public.audit_log WHERE item_id=(job->>'release_id')::uuid AND action='release.publish' ORDER BY id DESC LIMIT 1)
 WHERE id=p_id RETURNING site_id INTO site;
 PERFORM app.write_audit(site,'scheduler',NULL,'schedule.succeeded','scheduled_action',p_id,NULL,(job->>'release_id')::uuid,jsonb_build_object('scheduled_by',actor));
END $$;

ALTER FUNCTION app.schedule_release_action(uuid,timestamptz,text,boolean,uuid,int) OWNER TO cms_migration_owner;
ALTER FUNCTION app.release_schedule_capability(uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.lock_release_schedule(uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.finish_release_schedule(uuid,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.schedule_release_action(uuid,timestamptz,text,boolean,uuid,int),app.release_schedule_capability(uuid,uuid),app.lock_release_schedule(uuid,uuid),app.finish_release_schedule(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.schedule_release_action(uuid,timestamptz,text,boolean,uuid,int),app.release_schedule_capability(uuid,uuid),app.lock_release_schedule(uuid,uuid),app.finish_release_schedule(uuid,uuid) TO cms_authenticated_user;
