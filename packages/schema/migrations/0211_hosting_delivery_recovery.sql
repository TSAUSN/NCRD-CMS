-- Explicit, audited recovery for Hosting setup only. Applying this migration
-- does not enqueue work or alter any existing content, delivery or audit row.
CREATE TABLE app.hosting_retry_receipts (
 failed_id bigint NOT NULL REFERENCES public.outbox(id),
 retry_id bigint NOT NULL REFERENCES public.outbox(id),
 requested_by uuid NOT NULL REFERENCES public.app_users(id),
 target jsonb NOT NULL CHECK(jsonb_typeof(target)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(failed_id,retry_id),
 CHECK(retry_id>failed_id)
);
CREATE INDEX hosting_retry_receipts_retry ON app.hosting_retry_receipts(retry_id);
ALTER TABLE app.hosting_retry_receipts OWNER TO cms_migration_owner;
REVOKE ALL ON app.hosting_retry_receipts FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

CREATE FUNCTION app.hosting_retry_receipt_is_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 RAISE EXCEPTION 'hosting retry receipts are append-only' USING ERRCODE='42501';
END $$;
ALTER FUNCTION app.hosting_retry_receipt_is_append_only() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.hosting_retry_receipt_is_append_only() FROM PUBLIC;
CREATE TRIGGER hosting_retry_receipts_append_only BEFORE UPDATE OR DELETE
 ON app.hosting_retry_receipts FOR EACH ROW EXECUTE FUNCTION app.hosting_retry_receipt_is_append_only();
CREATE TRIGGER hosting_retry_receipts_no_truncate BEFORE TRUNCATE
 ON app.hosting_retry_receipts FOR EACH STATEMENT EXECUTE FUNCTION app.hosting_retry_receipt_is_append_only();

-- A delivered no-op or a receipt for an obsolete target is not recovery proof.
CREATE FUNCTION app.hosting_delivery_succeeded(p_id bigint,p_target jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.outbox o JOIN public.sites s ON s.id=o.site_id
  LEFT JOIN public.domains d ON d.id::text=o.payload->>'domain_id' AND d.site_id=o.site_id
  WHERE o.id=p_id AND o.status='delivered' AND o.processed_at IS NOT NULL
  AND s.archived_at IS NULL AND s.status<>'archived' AND s.staging_hostname LIKE '%.web.app'
  AND o.payload->'hosting_recovery_target'=p_target
  AND ((o.event_type='site.hosting_requested' AND o.payload->>'site_id'=s.id::text
    AND p_target=jsonb_build_object('staging_hostname',s.staging_hostname))
   OR (o.event_type='domain.sync' AND d.removed_at IS NULL AND d.kind<>'staging'
    AND d.status IN ('pending_dns','verifying','issuing_cert','live')
    AND o.payload->>'revision'=d.revision::text
    AND p_target=jsonb_build_object('staging_hostname',s.staging_hostname,
      'domain_id',d.id,'hostname',d.hostname_normalized,'revision',d.revision)
    AND d.provider_ref IS NOT NULL AND d.last_checked_at>=o.created_at
    AND CASE WHEN jsonb_typeof(d.dns_records)='array' THEN jsonb_array_length(d.dns_records)>0 ELSE false END))
 )
$$;
ALTER FUNCTION app.hosting_delivery_succeeded(bigint,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.hosting_delivery_succeeded(bigint,jsonb) FROM PUBLIC;

-- Recovery jobs fail safely if their pinned target changes before delivery.
CREATE OR REPLACE FUNCTION app.site_hosting_job(p_event_id bigint, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE event RECORD; site RECORD;
BEGIN
 PERFORM app.require_worker();
 SELECT * INTO event FROM public.outbox WHERE id=p_event_id FOR UPDATE;
 IF event IS NULL OR event.event_type<>'site.hosting_requested' OR event.status<>'running'
  OR NOT app.lease_matches(event.lease_token_hash,p_token)
  OR event.leased_until IS NULL OR event.leased_until<statement_timestamp() THEN
  RAISE EXCEPTION 'hosting event is not held by this lease' USING ERRCODE='CMS04';
 END IF;
 SELECT * INTO site FROM public.sites WHERE id=event.site_id;
 IF event.payload ? 'hosting_recovery_target' AND (
  site.id IS NULL OR site.archived_at IS NOT NULL OR site.status='archived'
  OR event.payload->>'site_id' IS DISTINCT FROM site.id::text
  OR event.payload->'hosting_recovery_target' IS DISTINCT FROM jsonb_build_object('staging_hostname',site.staging_hostname)
 ) THEN RAISE EXCEPTION 'hosting recovery target changed; inspect this delivery before retrying' USING ERRCODE='CMS04'; END IF;
 IF site IS NULL OR site.archived_at IS NOT NULL OR site.status='archived' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('site_id',site.id,'staging_hostname',site.staging_hostname);
END $$;

CREATE OR REPLACE FUNCTION app.domain_job(p_event_id bigint, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE event RECORD; d RECORD; site RECORD; staging text;
BEGIN
 PERFORM app.require_worker();
 SELECT * INTO event FROM public.outbox WHERE id=p_event_id FOR UPDATE;
 IF event IS NULL OR event.event_type<>'domain.sync' OR event.status<>'running'
  OR NOT app.lease_matches(event.lease_token_hash,p_token)
  OR event.leased_until IS NULL OR event.leased_until<statement_timestamp() THEN
  RAISE EXCEPTION 'domain event is not held by this lease' USING ERRCODE='CMS04';
 END IF;
 SELECT * INTO d FROM public.domains WHERE id=(event.payload->>'domain_id')::uuid AND site_id=event.site_id;
 SELECT * INTO site FROM public.sites WHERE id=event.site_id;
 IF event.payload ? 'hosting_recovery_target' AND (
  d.id IS NULL OR d.removed_at IS NOT NULL OR d.kind='staging' OR d.status='removing'
  OR site.id IS NULL OR site.archived_at IS NOT NULL OR site.status='archived'
  OR event.payload->>'revision' IS DISTINCT FROM d.revision::text
  OR event.payload->'hosting_recovery_target' IS DISTINCT FROM jsonb_build_object(
   'staging_hostname',site.staging_hostname,'domain_id',d.id,'hostname',d.hostname_normalized,'revision',d.revision)
 ) THEN RAISE EXCEPTION 'domain recovery target changed; inspect this delivery before retrying' USING ERRCODE='CMS04'; END IF;
 IF d IS NULL OR d.removed_at IS NOT NULL THEN RETURN NULL; END IF;
 staging:=site.staging_hostname;
 RETURN jsonb_build_object('id',d.id,'site_id',d.site_id,'hostname',d.hostname_normalized,'status',d.status,
  'revision',d.revision,'verification_token',d.verify_token,'provider_ref',d.provider_ref,'staging_hostname',staging);
END $$;

-- Site locking serializes retries for different failed rows on the same site.
-- Only recovery-tagged jobs are reused, so legacy work cannot bypass the pins.
CREATE FUNCTION app.retry_hosting_delivery(p_failed_id bigint)
RETURNS TABLE(retry_id bigint,retry_status text,linked_failures bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE actor uuid; failed public.outbox%ROWTYPE; site public.sites%ROWTYPE;
 domain public.domains%ROWTYPE; pinned jsonb; created bigint; newest bigint;
 failures bigint; latest_failure timestamptz; added bigint;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a Super admin can recover Hosting deliveries' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO failed FROM public.outbox WHERE id=p_failed_id;
 IF failed.id IS NULL THEN RAISE EXCEPTION 'delivery not found' USING ERRCODE='CMS03'; END IF;
 IF failed.status<>'dead' OR failed.event_type NOT IN ('domain.sync','site.hosting_requested') OR failed.site_id IS NULL THEN
  RAISE EXCEPTION 'choose a failed domain or site Hosting delivery' USING ERRCODE='CMS04'; END IF;
 SELECT * INTO site FROM public.sites WHERE id=failed.site_id FOR UPDATE;
 IF site.id IS NULL OR site.archived_at IS NOT NULL OR site.status='archived' OR site.staging_hostname NOT LIKE '%.web.app' THEN
  RAISE EXCEPTION 'this delivery no longer names an active managed site' USING ERRCODE='CMS04'; END IF;
 IF failed.event_type='domain.sync' THEN
  SELECT * INTO domain FROM public.domains WHERE id::text=failed.payload->>'domain_id' AND site_id=site.id FOR UPDATE;
  IF domain.id IS NULL OR domain.removed_at IS NOT NULL OR domain.kind='staging' OR domain.status='removing'
   OR failed.payload->>'revision' IS DISTINCT FROM domain.revision::text THEN
   RAISE EXCEPTION 'this delivery no longer names the current domain revision' USING ERRCODE='CMS04'; END IF;
  pinned:=jsonb_build_object('staging_hostname',site.staging_hostname,'domain_id',domain.id,
   'hostname',domain.hostname_normalized,'revision',domain.revision);
 ELSE
  IF failed.payload->>'site_id' IS DISTINCT FROM site.id::text THEN
   RAISE EXCEPTION 'the Hosting payload does not match its site' USING ERRCODE='CMS04'; END IF;
  pinned:=jsonb_build_object('staging_hostname',site.staging_hostname);
 END IF;
 IF failed.payload ? 'hosting_recovery_target' AND failed.payload->'hosting_recovery_target' IS DISTINCT FROM pinned THEN
  RAISE EXCEPTION 'the saved recovery target changed; inspect it before retrying' USING ERRCODE='CMS04'; END IF;
 SELECT count(*),max(o.id),max(o.failed_at) INTO failures,newest,latest_failure
 FROM public.outbox o WHERE o.status='dead' AND o.site_id=site.id AND o.event_type=failed.event_type
  AND (NOT (o.payload ? 'hosting_recovery_target') OR o.payload->'hosting_recovery_target'=pinned)
  AND CASE WHEN failed.event_type='domain.sync' THEN
   o.payload->>'domain_id'=domain.id::text AND o.payload->>'revision'=domain.revision::text
   ELSE o.payload->>'site_id'=site.id::text END;
 IF failures>500 THEN RAISE EXCEPTION 'more than 500 matching failures need a separate operator review' USING ERRCODE='CMS04'; END IF;
 SELECT o.id INTO created FROM public.outbox o WHERE o.id>newest AND o.site_id=site.id AND o.event_type=failed.event_type
  AND o.payload->'hosting_recovery_target'=pinned
  AND (o.status IN ('pending','running') OR (o.processed_at>=latest_failure AND app.hosting_delivery_succeeded(o.id,pinned)))
 ORDER BY CASE WHEN o.status='delivered' THEN 0 ELSE 1 END,o.id DESC LIMIT 1;
 IF created IS NULL THEN
  created:=app.emit_outbox(site.id,failed.event_type,
   CASE WHEN failed.event_type='domain.sync' THEN jsonb_build_object('domain_id',domain.id,'revision',domain.revision)
   ELSE jsonb_build_object('site_id',site.id) END || jsonb_build_object('hosting_recovery_target',pinned));
 END IF;
 INSERT INTO app.hosting_retry_receipts(failed_id,retry_id,requested_by,target)
 SELECT o.id,created,actor,pinned FROM public.outbox o WHERE o.status='dead' AND o.site_id=site.id AND o.event_type=failed.event_type
  AND (NOT (o.payload ? 'hosting_recovery_target') OR o.payload->'hosting_recovery_target'=pinned)
  AND CASE WHEN failed.event_type='domain.sync' THEN
   o.payload->>'domain_id'=domain.id::text AND o.payload->>'revision'=domain.revision::text
   ELSE o.payload->>'site_id'=site.id::text END
  AND o.id<created ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 IF added>0 THEN
  PERFORM app.write_audit(site.id,'user',actor,'hosting.retry_requested',
   CASE WHEN failed.event_type='domain.sync' THEN 'domain' ELSE 'site' END,
   CASE WHEN failed.event_type='domain.sync' THEN domain.id ELSE site.id END,NULL,NULL,
   jsonb_build_object('retry_delivery_id',created,'target',pinned,'linked_failures',added,
    'failed_delivery_ids',(SELECT jsonb_agg(r.failed_id ORDER BY r.failed_id) FROM app.hosting_retry_receipts r WHERE r.retry_id=created)));
 END IF;
 RETURN QUERY SELECT o.id,o.status::text,(SELECT count(*) FROM app.hosting_retry_receipts r WHERE r.retry_id=o.id)
  FROM public.outbox o WHERE o.id=created;
END $$;
ALTER FUNCTION app.retry_hosting_delivery(bigint) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.retry_hosting_delivery(bigint) FROM PUBLIC,cms_worker,cms_public_renderer;
GRANT EXECUTE ON FUNCTION app.retry_hosting_delivery(bigint) TO cms_authenticated_user;

CREATE OR REPLACE FUNCTION app.outbox_failure_is_active(p_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $$
 SELECT EXISTS(SELECT 1 FROM public.outbox failed WHERE failed.id=p_id AND failed.status='dead'
 AND NOT (failed.event_type='section_def.thumbnail_requested' AND EXISTS(SELECT 1 FROM public.sites s WHERE s.id=failed.site_id AND (s.archived_at IS NOT NULL OR s.status='archived')))
 AND NOT EXISTS(SELECT 1 FROM app.thumbnail_retry_receipts receipt JOIN public.outbox retry ON retry.id=receipt.retry_id
 WHERE receipt.failed_id=failed.id AND retry.status IN ('delivered','dead'))
 AND NOT EXISTS(SELECT 1 FROM app.hosting_retry_receipts receipt JOIN public.outbox retry ON retry.id=receipt.retry_id
 WHERE receipt.failed_id=failed.id AND retry.site_id=failed.site_id AND retry.event_type=failed.event_type
 AND retry.processed_at>=failed.failed_at
 AND (NOT (failed.payload ? 'hosting_recovery_target') OR failed.payload->'hosting_recovery_target'=receipt.target)
 AND CASE WHEN failed.event_type='domain.sync' THEN
  failed.payload->>'domain_id'=retry.payload->>'domain_id' AND failed.payload->>'revision'=retry.payload->>'revision'
  ELSE failed.payload->>'site_id'=retry.payload->>'site_id' END
 AND app.hosting_delivery_succeeded(retry.id,receipt.target)))
$$;
