-- Retain every failed delivery and link a governed thumbnail retry separately.
CREATE TABLE app.thumbnail_retry_receipts (
 failed_id bigint PRIMARY KEY REFERENCES public.outbox(id),
 retry_id bigint NOT NULL REFERENCES public.outbox(id),
 requested_by uuid NOT NULL REFERENCES public.app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(retry_id>failed_id)
);
ALTER TABLE app.thumbnail_retry_receipts OWNER TO cms_migration_owner;
REVOKE ALL ON app.thumbnail_retry_receipts FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

CREATE FUNCTION app.outbox_failure_is_active(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.outbox failed WHERE failed.id=p_id AND failed.status='dead'
 AND NOT EXISTS(SELECT 1 FROM app.thumbnail_retry_receipts receipt JOIN public.outbox retry ON retry.id=receipt.retry_id
 WHERE receipt.failed_id=failed.id AND retry.status IN ('delivered','dead')))
$$;
REVOKE ALL ON FUNCTION app.outbox_failure_is_active(bigint) FROM PUBLIC;
ALTER FUNCTION app.outbox_failure_is_active(bigint) OWNER TO cms_migration_owner;

CREATE FUNCTION app.retry_thumbnail_delivery(p_failed_id bigint)
RETURNS TABLE(retry_id bigint,retry_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE actor uuid; failed public.outbox%ROWTYPE; target RECORD; existing RECORD; created bigint;
BEGIN
 actor:=app.require_actor();
 SELECT * INTO failed FROM public.outbox WHERE id=p_failed_id FOR UPDATE;
 IF failed.id IS NULL THEN RAISE EXCEPTION 'delivery not found' USING ERRCODE='CMS03'; END IF;
 IF NOT ((failed.site_id IS NULL AND app.is_super_admin()) OR (failed.site_id IS NOT NULL AND app.can_administer_site(failed.site_id))) THEN
 RAISE EXCEPTION 'only an administrator for this section may retry its preview' USING ERRCODE='CMS02'; END IF;
 IF failed.event_type<>'section_def.thumbnail_requested' OR failed.status<>'dead' THEN
 RAISE EXCEPTION 'only a failed section preview can use this retry' USING ERRCODE='CMS04'; END IF;
 SELECT r.retry_id,o.status INTO existing FROM app.thumbnail_retry_receipts r JOIN public.outbox o ON o.id=r.retry_id WHERE r.failed_id=p_failed_id;
 IF existing.retry_id IS NOT NULL THEN RETURN QUERY SELECT existing.retry_id,existing.status::text; RETURN; END IF;
 SELECT d.id,d.slug,d.site_id,v.version,v.thumbnail_path INTO target FROM public.section_defs d
 JOIN public.section_def_versions v ON v.section_def_id=d.id
 WHERE d.id::text=failed.payload->>'section_def_id' AND v.version::text=failed.payload->>'version'
 AND d.site_id IS NOT DISTINCT FROM failed.site_id AND d.status='active'
 AND (d.site_id IS NULL OR EXISTS(SELECT 1 FROM public.sites s WHERE s.id=d.site_id AND s.archived_at IS NULL AND s.status<>'archived'));
 IF target.id IS NULL THEN RAISE EXCEPTION 'this preview no longer names an active section version; review the section before retrying' USING ERRCODE='CMS04'; END IF;
 -- Reuse later work already requested by the worker sweep rather than creating
 -- a parallel request. A successful result must also have recorded its image.
 SELECT o.id INTO created FROM public.outbox o
 WHERE o.id>failed.id AND o.site_id IS NOT DISTINCT FROM failed.site_id
 AND o.event_type='section_def.thumbnail_requested'
 AND o.payload->>'section_def_id'=target.id::text AND o.payload->>'version'=target.version::text
 AND (o.status IN ('pending','running') OR (o.status='delivered' AND target.thumbnail_path IS NOT NULL))
 ORDER BY CASE WHEN o.status='delivered' THEN 0 ELSE 1 END,o.id LIMIT 1;
 IF created IS NULL THEN
 created:=app.emit_outbox(failed.site_id,'section_def.thumbnail_requested',
 jsonb_build_object('section_def_id',target.id,'version',target.version,'slug',target.slug));
 UPDATE public.outbox SET max_attempts=failed.max_attempts WHERE id=created;
 END IF;
 INSERT INTO app.thumbnail_retry_receipts(failed_id,retry_id,requested_by) VALUES(failed.id,created,actor);
 PERFORM app.write_audit(failed.site_id,'user',actor,'section_def.thumbnail_retry','section_def',target.id,NULL,NULL,
 jsonb_build_object('failed_delivery_id',failed.id,'retry_delivery_id',created,'version',target.version,
 'previous_attempts',failed.attempts,'previous_error',failed.last_error,'failed_at',failed.failed_at));
 RETURN QUERY SELECT o.id,o.status::text FROM public.outbox o WHERE o.id=created;
END $$;
REVOKE ALL ON FUNCTION app.retry_thumbnail_delivery(bigint) FROM PUBLIC;
ALTER FUNCTION app.retry_thumbnail_delivery(bigint) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.retry_thumbnail_delivery(bigint) TO cms_authenticated_user;

CREATE OR REPLACE FUNCTION app.inbox_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_actor();
 WITH problems AS MATERIALIZED (
 SELECT 'domain'::text AS kind,d.id::text AS id,d.site_id,s.name AS site_name,d.hostname_normalized AS title,
 COALESCE(d.error_code,'Domain setup needs attention') AS error,COALESCE(d.last_checked_at,d.created_at) AS occurred_at,
 false AS can_retry_thumbnail,NULL::text AS retry_id,NULL::text AS retry_status
 FROM public.domains d JOIN public.sites s ON s.id=d.site_id WHERE d.status='error' AND app.can_administer_site(d.site_id)
 UNION ALL
 SELECT 'delivery',o.id::text,o.site_id,s.name,
 CASE WHEN o.event_type='section_def.thumbnail_requested' THEN 'Section preview: '||COALESCE(d.name,'unavailable section') ELSE o.event_type END,
 COALESCE(o.last_error,'Background delivery failed'),COALESCE(o.failed_at,o.created_at),
 o.event_type='section_def.thumbnail_requested' AND d.id IS NOT NULL AND v.id IS NOT NULL AND d.status='active'
 AND receipt.failed_id IS NULL AND (s.id IS NULL OR (s.archived_at IS NULL AND s.status<>'archived')),
 retry.id::text,retry.status::text
 FROM public.outbox o LEFT JOIN public.sites s ON s.id=o.site_id
 LEFT JOIN public.section_defs d ON d.id::text=o.payload->>'section_def_id' AND d.site_id IS NOT DISTINCT FROM o.site_id
 LEFT JOIN public.section_def_versions v ON v.section_def_id=d.id AND v.version::text=o.payload->>'version'
 LEFT JOIN app.thumbnail_retry_receipts receipt ON receipt.failed_id=o.id
 LEFT JOIN public.outbox retry ON retry.id=receipt.retry_id
 WHERE o.status='dead' AND app.outbox_failure_is_active(o.id)
 AND ((o.site_id IS NULL AND app.is_super_admin()) OR (o.site_id IS NOT NULL AND app.can_administer_site(o.site_id)))
 UNION ALL
 SELECT 'schedule',j.id::text,j.site_id,s.name,COALESCE(v.page_title,'Scheduled page'),COALESCE(j.last_error,'Scheduled action failed'),COALESCE(j.finished_at,j.run_at),false,NULL::text,NULL::text
 FROM public.scheduled_actions j JOIN public.sites s ON s.id=j.site_id LEFT JOIN public.page_versions v ON v.id=j.version_id
 WHERE j.status='failed' AND app.can_publish(j.site_id)
 ) SELECT jsonb_build_object(
 'reviews',(SELECT count(*) FROM public.submissions r WHERE r.status='open' AND app.has_site_access(r.site_id)),
 'requests',(SELECT count(*) FROM public.section_requests r WHERE r.status IN ('open','in_progress') AND app.has_site_access(r.site_id)),
 'operations',(SELECT count(*) FROM problems),
 'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',id,'siteId',site_id,'siteName',site_name,
 'title',title,'error',app.redact_audit_detail(to_jsonb(error)),'occurredAt',occurred_at,
 'canRetryThumbnail',can_retry_thumbnail,'retryId',retry_id,'retryStatus',retry_status) ORDER BY occurred_at DESC,kind,id)
 FROM(SELECT * FROM problems ORDER BY occurred_at DESC,kind,id LIMIT 100) recent),'[]')) INTO result;
 RETURN result;
END $$;

-- Dashboard and Inbox use the same active-failure rule. Old rows stay dead.
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
    (SELECT count(*) FROM public.outbox WHERE status = 'pending'),
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
    (SELECT EXTRACT(epoch FROM now() - min(created_at))
       FROM public.outbox WHERE status IN ('pending', 'running')),

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
