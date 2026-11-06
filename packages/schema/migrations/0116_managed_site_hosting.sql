-- Hosting is an asynchronous transport concern. Site creation/import remains
-- atomic and private, and its provider request commits with the site address.
CREATE FUNCTION app.queue_site_hosting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.staging_hostname LIKE '%.web.app' AND NEW.archived_at IS NULL
  AND (TG_OP='INSERT' OR NEW.staging_hostname IS DISTINCT FROM OLD.staging_hostname) THEN
  INSERT INTO public.outbox(site_id,event_type,payload)
  VALUES(NEW.id,'site.hosting_requested',jsonb_build_object('site_id',NEW.id));
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION app.queue_site_hosting() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.queue_site_hosting() FROM PUBLIC;
CREATE TRIGGER site_hosting_request AFTER INSERT OR UPDATE OF staging_hostname ON public.sites
FOR EACH ROW EXECUTE FUNCTION app.queue_site_hosting();

CREATE FUNCTION app.site_hosting_job(p_event_id bigint,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 IF site IS NULL OR site.archived_at IS NOT NULL OR site.status='archived' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('site_id',site.id,'staging_hostname',site.staging_hostname);
END $$;
ALTER FUNCTION app.site_hosting_job(bigint,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_hosting_job(bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.site_hosting_job(bigint,uuid) TO cms_worker;

-- Provider routing context comes from the leased row and its owning site,
-- never from an HTTP caller, event payload override or hostname search.
CREATE OR REPLACE FUNCTION app.domain_job(p_event_id bigint,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event RECORD; d RECORD; staging text;
BEGIN
 PERFORM app.require_worker();
 SELECT * INTO event FROM public.outbox WHERE id=p_event_id FOR UPDATE;
 IF event IS NULL OR event.event_type<>'domain.sync' OR event.status<>'running'
  OR NOT app.lease_matches(event.lease_token_hash,p_token)
  OR event.leased_until IS NULL OR event.leased_until<statement_timestamp() THEN
  RAISE EXCEPTION 'domain event is not held by this lease' USING ERRCODE='CMS04';
 END IF;
 SELECT * INTO d FROM public.domains WHERE id=(event.payload->>'domain_id')::uuid;
 IF d IS NULL OR d.removed_at IS NOT NULL THEN RETURN NULL; END IF;
 SELECT staging_hostname INTO staging FROM public.sites WHERE id=d.site_id;
 RETURN jsonb_build_object('id',d.id,'site_id',d.site_id,'hostname',d.hostname_normalized,'status',d.status,
  'revision',d.revision,'verification_token',d.verify_token,'provider_ref',d.provider_ref,'staging_hostname',staging);
END $$;

CREATE FUNCTION app.site_hosting_status(p_site uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN NOT app.has_site_access(p_site) THEN NULL
  WHEN NOT EXISTS(SELECT 1 FROM public.sites WHERE id=p_site AND staging_hostname LIKE '%.web.app') THEN 'ready'
  ELSE COALESCE((SELECT CASE WHEN status='delivered' THEN 'ready' WHEN status='dead' THEN 'error' ELSE 'preparing' END
   FROM public.outbox WHERE site_id=p_site AND event_type='site.hosting_requested' ORDER BY id DESC LIMIT 1),'preparing') END
$$;
ALTER FUNCTION app.site_hosting_status(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.site_hosting_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.site_hosting_status(uuid) TO cms_authenticated_user;

INSERT INTO public.outbox(site_id,event_type,payload)
SELECT s.id,'site.hosting_requested',jsonb_build_object('site_id',s.id) FROM public.sites s
WHERE s.staging_hostname LIKE '%.web.app' AND s.archived_at IS NULL AND s.status<>'archived'
AND NOT EXISTS(SELECT 1 FROM public.outbox o WHERE o.site_id=s.id AND o.event_type='site.hosting_requested');
