-- Customer DNS remains operator-owned. Product commands reserve hostnames,
-- revoke routing synchronously, and queue provider work with lease receipts.
ALTER TABLE public.domains ALTER COLUMN verify_token SET DEFAULT gen_random_uuid()::text;
UPDATE public.domains SET verify_token=gen_random_uuid()::text WHERE verify_token IS NULL;
ALTER TABLE public.domains ADD COLUMN revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_requested_at timestamptz, ADD COLUMN removed_at timestamptz;
CREATE TABLE public.domain_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain_id uuid NOT NULL, site_id uuid NOT NULL REFERENCES public.sites(id),
  status text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.domain_events OWNER TO cms_migration_owner;
ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.domain_events TO cms_authenticated_user;
CREATE POLICY domain_events_member ON public.domain_events FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE INDEX domain_events_domain ON public.domain_events(domain_id,created_at DESC);

CREATE FUNCTION app.enqueue_domain(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD;
BEGIN
 SELECT * INTO d FROM public.domains WHERE id=p_id FOR UPDATE;
 IF d IS NULL OR d.removed_at IS NOT NULL THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.outbox WHERE event_type='domain.sync' AND payload->>'domain_id'=p_id::text
   AND status IN ('pending','running') AND payload->>'revision'=d.revision::text) THEN
   PERFORM app.emit_outbox(d.site_id,'domain.sync',jsonb_build_object('domain_id',d.id,'revision',d.revision));
 END IF;
 UPDATE public.domains SET last_requested_at=now() WHERE id=p_id;
END $$;

CREATE FUNCTION app.add_domain(p_site_id uuid,p_hostname text,p_with_www boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; site RECORD; host text; alias text; target uuid; new_id uuid; existing RECORD;
BEGIN
 actor:=app.require_actor();
 IF NOT app.can_administer_site(p_site_id) THEN RAISE EXCEPTION 'a site administrator connects domains' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO site FROM public.sites WHERE id=p_site_id FOR UPDATE;
 IF site IS NULL OR site.status='archived' THEN RAISE EXCEPTION 'an active site is required' USING ERRCODE='CMS04'; END IF;
 host:=lower(btrim(p_hostname));
 IF host IS NULL OR length(host) NOT BETWEEN 3 AND 253 OR host !~ '\.' OR host ~ '^[0-9.]+$'
  OR host ~ '(\.localhost|\.local|\.test|\.invalid)$' OR EXISTS(SELECT 1 FROM regexp_split_to_table(host,'\.') label
    WHERE label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') THEN
  RAISE EXCEPTION 'enter a public hostname without a protocol, port or path' USING ERRCODE='CMS04';
 END IF;
 -- Reserve the pair in a consistent order across different tenant transactions.
 alias:=CASE WHEN host LIKE 'www.%' THEN substr(host,5) ELSE 'www.'||host END;
 PERFORM pg_advisory_xact_lock(hashtextextended(least(host,alias),63));
 PERFORM pg_advisory_xact_lock(hashtextextended(greatest(host,alias),63));
 IF EXISTS(SELECT 1 FROM public.sites WHERE staging_hostname=host OR (p_with_www AND staging_hostname=alias)) THEN
  RAISE EXCEPTION 'that hostname is reserved for staging' USING ERRCODE='CMS04'; END IF;
 SELECT * INTO existing FROM public.domains WHERE hostname_normalized=host;
 IF existing.id IS NOT NULL AND existing.site_id=p_site_id AND existing.removed_at IS NULL AND existing.status<>'removing' THEN RETURN existing.id; END IF;
 IF EXISTS(SELECT 1 FROM public.domains WHERE hostname_normalized IN (host,CASE WHEN p_with_www THEN alias ELSE host END) AND removed_at IS NULL) THEN
  RAISE EXCEPTION 'that hostname is connected or still being removed' USING ERRCODE='CMS04'; END IF;
 UPDATE public.domains SET kind='primary',redirect_to_domain_id=NULL WHERE removed_at IS NOT NULL AND redirect_to_domain_id IN
  (SELECT id FROM public.domains WHERE hostname_normalized IN (host,CASE WHEN p_with_www THEN alias ELSE host END) AND removed_at IS NOT NULL);
 DELETE FROM public.domains WHERE hostname_normalized IN (host,CASE WHEN p_with_www THEN alias ELSE host END) AND removed_at IS NOT NULL;
 SELECT id INTO target FROM public.domains WHERE site_id=p_site_id AND kind='primary' AND status<>'removing' ORDER BY created_at LIMIT 1;
 INSERT INTO public.domains(site_id,hostname_normalized,kind,redirect_to_domain_id)
  VALUES(p_site_id,host,CASE WHEN target IS NULL THEN 'primary'::domain_kind ELSE 'redirect'::domain_kind END,target) RETURNING id INTO new_id;
 INSERT INTO public.domain_events(domain_id,site_id,status) VALUES(new_id,p_site_id,'pending_dns');
 PERFORM app.enqueue_domain(new_id);
 IF p_with_www THEN
  INSERT INTO public.domains(site_id,hostname_normalized,kind,redirect_to_domain_id) VALUES(p_site_id,alias,'redirect',COALESCE(target,new_id)) RETURNING id INTO target;
  INSERT INTO public.domain_events(domain_id,site_id,status) VALUES(target,p_site_id,'pending_dns');
  PERFORM app.enqueue_domain(target);
 END IF;
 PERFORM app.write_audit(p_site_id,'user',actor,'domain.add','domain',new_id,NULL,NULL,jsonb_build_object('hostname',host,'paired',p_with_www));
 RETURN new_id;
END $$;

CREATE FUNCTION app.check_domain(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO d FROM public.domains WHERE id=p_id FOR UPDATE;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
 IF NOT app.can_administer_site(d.site_id) THEN RAISE EXCEPTION 'a site administrator checks domains' USING ERRCODE='CMS02'; END IF;
 IF d.removed_at IS NOT NULL OR d.kind='staging' THEN RAISE EXCEPTION 'domain is not available for verification' USING ERRCODE='CMS04'; END IF;
 PERFORM app.enqueue_domain(p_id);
 PERFORM app.write_audit(d.site_id,'user',actor,'domain.check','domain',p_id,NULL,NULL,'{}');
END $$;

CREATE FUNCTION app.remove_domain(p_id uuid,p_revision bigint,p_confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; row RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO d FROM public.domains WHERE id=p_id;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
 IF NOT app.can_administer_site(d.site_id) THEN RAISE EXCEPTION 'a site administrator removes domains' USING ERRCODE='CMS02'; END IF;
 PERFORM 1 FROM public.sites WHERE id=d.site_id FOR UPDATE;
 SELECT * INTO d FROM public.domains WHERE id=p_id FOR UPDATE;
 IF p_confirmation IS DISTINCT FROM d.hostname_normalized THEN RAISE EXCEPTION 'type the hostname to confirm removal' USING ERRCODE='CMS04'; END IF;
 IF d.kind='staging' THEN RAISE EXCEPTION 'staging addresses are managed with the site' USING ERRCODE='CMS04'; END IF;
 IF d.status='removing' THEN RETURN; END IF;
 IF d.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'domain changed; reload before removing it' USING ERRCODE='CMS01'; END IF;
 FOR row IN SELECT * FROM public.domains WHERE id=p_id OR redirect_to_domain_id=p_id ORDER BY id FOR UPDATE LOOP
  UPDATE public.domains SET status='removing',revision=revision+1,error_code=NULL,error_detail=NULL WHERE id=row.id;
  INSERT INTO public.domain_events(domain_id,site_id,status) VALUES(row.id,d.site_id,'removing');
  PERFORM app.enqueue_domain(row.id);
 END LOOP;
 PERFORM app.rebuild_site_shell(d.site_id);
 PERFORM app.write_audit(d.site_id,'user',actor,'domain.remove','domain',p_id,NULL,NULL,jsonb_build_object('hostname',d.hostname_normalized));
END $$;

CREATE FUNCTION app.set_primary_domain(p_id uuid,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO d FROM public.domains WHERE id=p_id;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
 IF NOT app.can_administer_site(d.site_id) THEN RAISE EXCEPTION 'a site administrator changes the primary address' USING ERRCODE='CMS02'; END IF;
 PERFORM 1 FROM public.sites WHERE id=d.site_id FOR UPDATE;
 PERFORM 1 FROM public.domains WHERE site_id=d.site_id ORDER BY id FOR UPDATE;
 SELECT * INTO d FROM public.domains WHERE id=p_id;
 IF d.kind='primary' AND d.status='live' THEN RETURN; END IF;
 IF d.status<>'live' OR d.kind='staging' THEN RAISE EXCEPTION 'verify this domain and its certificate first' USING ERRCODE='CMS04'; END IF;
 IF d.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'domain changed; reload before changing primary address' USING ERRCODE='CMS01'; END IF;
 UPDATE public.domains SET kind='primary',redirect_to_domain_id=NULL,revision=revision+1 WHERE id=p_id;
 UPDATE public.domains SET kind='redirect',redirect_to_domain_id=p_id,revision=revision+1 WHERE site_id=d.site_id AND id<>p_id AND kind<>'staging' AND status<>'removing';
 PERFORM app.rebuild_site_shell(d.site_id);
 PERFORM app.write_audit(d.site_id,'user',actor,'domain.primary','domain',p_id,NULL,NULL,jsonb_build_object('hostname',d.hostname_normalized));
END $$;

CREATE FUNCTION app.domain_job(p_event_id bigint,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event RECORD; d RECORD;
BEGIN
 PERFORM app.require_worker();
 SELECT * INTO event FROM public.outbox WHERE id=p_event_id FOR UPDATE;
 IF event IS NULL OR event.event_type<>'domain.sync' OR event.status<>'running' OR NOT app.lease_matches(event.lease_token_hash,p_token)
  OR event.leased_until IS NULL OR event.leased_until<statement_timestamp() THEN RAISE EXCEPTION 'domain event is not held by this lease' USING ERRCODE='CMS04'; END IF;
 SELECT * INTO d FROM public.domains WHERE id=(event.payload->>'domain_id')::uuid;
 IF d IS NULL OR d.removed_at IS NOT NULL THEN RETURN NULL; END IF;
 -- A stale connect event is allowed to clean up a now-removing domain. A stale
 -- result can never reactivate it (record_domain_result asks again).
 RETURN jsonb_build_object('id',d.id,'site_id',d.site_id,'hostname',d.hostname_normalized,'status',d.status,'revision',d.revision,'verification_token',d.verify_token);
END $$;

CREATE FUNCTION app.record_domain_result(p_event_id bigint,p_token uuid,p_revision bigint,p_state text,p_ref text,p_records jsonb,p_code text,p_detail text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job jsonb; d RECORD;
BEGIN
 job:=app.domain_job(p_event_id,p_token);
 IF job IS NULL THEN RETURN; END IF;
 SELECT * INTO d FROM public.domains WHERE id=(job->>'id')::uuid FOR UPDATE;
 IF d.revision<>p_revision THEN RETURN; END IF;
 IF p_state IS NULL OR p_state NOT IN ('pending_dns','verifying','issuing_cert','live','error','removed')
  OR (p_state='removed' AND d.status<>'removing') OR (d.status='removing' AND p_state<>'removed') THEN RETURN; END IF;
 IF p_state<>'removed' AND (jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR octet_length(p_records::text)>16000 OR length(COALESCE(p_ref,'')) NOT BETWEEN 1 AND 200) THEN
  RAISE EXCEPTION 'invalid domain provider receipt' USING ERRCODE='CMS04'; END IF;
 IF d.status::text<>p_state OR d.error_code IS DISTINCT FROM p_code OR d.error_detail IS DISTINCT FROM p_detail THEN
  INSERT INTO public.domain_events(domain_id,site_id,status,detail) VALUES(d.id,d.site_id,p_state,left(p_detail,2000));
 END IF;
 UPDATE public.domains SET status=CASE WHEN p_state='removed' THEN 'removing'::domain_status ELSE p_state::domain_status END,
  removed_at=CASE WHEN p_state='removed' THEN now() ELSE NULL END,
  provider_ref=CASE WHEN p_state='removed' THEN NULL ELSE p_ref END,dns_records=p_records,last_checked_at=now(),error_code=left(p_code,120),error_detail=left(p_detail,2000) WHERE id=d.id;
 IF (d.status='live') IS DISTINCT FROM (p_state='live') THEN PERFORM app.rebuild_site_shell(d.site_id); END IF;
 IF d.status::text<>p_state THEN
  PERFORM app.write_audit(d.site_id,'system',NULL,'domain.status','domain',d.id,NULL,NULL,jsonb_build_object('from',d.status,'status',p_state));
 END IF;
END $$;

CREATE FUNCTION app.request_due_domain_checks() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; n integer:=0;
BEGIN
 PERFORM app.require_worker();
 FOR d IN SELECT id FROM public.domains WHERE removed_at IS NULL AND kind<>'staging'
  AND (last_requested_at IS NULL OR last_requested_at<now()-interval '10 minutes') ORDER BY last_requested_at NULLS FIRST LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
  PERFORM app.enqueue_domain(d.id); n:=n+1;
 END LOOP;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION app.enqueue_domain(uuid),app.add_domain(uuid,text,boolean),app.check_domain(uuid),app.remove_domain(uuid,bigint,text),app.set_primary_domain(uuid,bigint),app.domain_job(bigint,uuid),app.record_domain_result(bigint,uuid,bigint,text,text,jsonb,text,text),app.request_due_domain_checks() FROM PUBLIC;
ALTER FUNCTION app.enqueue_domain(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.add_domain(uuid,text,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.check_domain(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.remove_domain(uuid,bigint,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.set_primary_domain(uuid,bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.domain_job(bigint,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.record_domain_result(bigint,uuid,bigint,text,text,jsonb,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.request_due_domain_checks() OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.add_domain(uuid,text,boolean),app.check_domain(uuid),app.remove_domain(uuid,bigint,text),app.set_primary_domain(uuid,bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.domain_job(bigint,uuid),app.record_domain_result(bigint,uuid,bigint,text,text,jsonb,text,text),app.request_due_domain_checks() TO cms_worker;
