CREATE TABLE public.section_requests (
  id uuid PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK(length(btrim(body)) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','declined')),
  revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  requested_by uuid NOT NULL REFERENCES public.app_users(id),
  response text NOT NULL DEFAULT '' CHECK(length(response)<=5000),
  responded_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status NOT IN ('completed','declined') OR length(btrim(response))>0)
);
CREATE INDEX section_requests_site_status ON public.section_requests(site_id,status,created_at DESC);
ALTER TABLE public.section_requests OWNER TO cms_migration_owner;
ALTER TABLE public.section_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY section_requests_read ON public.section_requests FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
GRANT SELECT ON public.section_requests TO cms_authenticated_user;

CREATE FUNCTION app.request_custom_section(p_id uuid,p_site_id uuid,p_title text,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; old RECORD; site_status text;
BEGIN
  actor:=app.require_actor();
  IF NOT app.has_site_access(p_site_id) THEN RAISE EXCEPTION 'site not available' USING ERRCODE='CMS02'; END IF;
  SELECT status::text INTO site_status FROM public.sites WHERE id=p_site_id FOR SHARE;
  IF site_status IS NULL OR site_status='archived' THEN RAISE EXCEPTION 'new requests are not available for an archived site' USING ERRCODE='CMS04'; END IF;
  p_title:=btrim(p_title); p_body:=btrim(p_body);
  IF p_id IS NULL OR p_title IS NULL OR length(p_title) NOT BETWEEN 1 AND 160 OR p_body IS NULL OR length(p_body) NOT BETWEEN 10 AND 5000 THEN
    RAISE EXCEPTION 'add a short title and describe the section in 10 to 5000 characters' USING ERRCODE='CMS04';
  END IF;
  -- Serialize an idempotency key without requiring access to a foreign row.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,60));
  SELECT * INTO old FROM public.section_requests WHERE id=p_id;
  IF old IS NOT NULL THEN
    IF old.site_id<>p_site_id OR old.requested_by<>actor OR old.title<>p_title OR old.body<>p_body THEN
      RAISE EXCEPTION 'this request reference was used for different content' USING ERRCODE='CMS04';
    END IF;
    RETURN old.id;
  END IF;
  INSERT INTO public.section_requests(id,site_id,title,body,requested_by) VALUES(p_id,p_site_id,p_title,p_body,actor);
  PERFORM app.write_audit(p_site_id,'user',actor,'section_request.create','section_request',p_id,NULL,NULL,jsonb_build_object('title',p_title));
  RETURN p_id;
END $$;

CREATE FUNCTION app.respond_section_request(p_id uuid,p_expected_revision bigint,p_status text,p_response text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; item RECORD; next_revision bigint;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO item FROM public.section_requests WHERE id=p_id FOR UPDATE;
  IF item IS NULL THEN RAISE EXCEPTION 'request not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(item.site_id) THEN RAISE EXCEPTION 'a site administrator handles custom-section requests' USING ERRCODE='CMS02'; END IF;
  p_response:=btrim(COALESCE(p_response,''));
  IF p_status IS NULL OR p_status NOT IN ('open','in_progress','completed','declined') OR length(p_response)>5000
    OR (p_status IN ('completed','declined') AND length(p_response)=0) THEN
    RAISE EXCEPTION 'choose a status and include a reply when completing or declining a request' USING ERRCODE='CMS04';
  END IF;
  IF item.status=p_status AND item.response=p_response AND item.revision=p_expected_revision+1 AND item.responded_by=actor THEN RETURN item.revision; END IF;
  IF item.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'this request changed; reload before replying' USING ERRCODE='CMS01',DETAIL=item.revision::text; END IF;
  next_revision:=item.revision+1;
  UPDATE public.section_requests SET status=p_status,response=p_response,responded_by=actor,revision=next_revision,updated_at=now() WHERE id=p_id;
  PERFORM app.write_audit(item.site_id,'user',actor,'section_request.respond','section_request',p_id,NULL,NULL,
    jsonb_build_object('from_status',item.status,'status',p_status,'previous_response',item.response,'response',p_response,'revision',next_revision));
  RETURN next_revision;
END $$;

CREATE FUNCTION app.section_request_feed(p_site_id uuid) RETURNS TABLE(
  id uuid,site_id uuid,site_name text,title text,body text,status text,revision text,
  requested_by_name text,response text,responded_by_name text,created_at timestamptz,updated_at timestamptz,can_manage boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  RETURN QUERY SELECT r.id,r.site_id,s.name,r.title,r.body,r.status,r.revision::text,
    COALESCE(NULLIF(u.display_name,''),'Member'),r.response,NULLIF(responder.display_name,''),r.created_at,r.updated_at,app.can_administer_site(r.site_id)
  FROM public.section_requests r JOIN public.sites s ON s.id=r.site_id JOIN public.app_users u ON u.id=r.requested_by
  LEFT JOIN public.app_users responder ON responder.id=r.responded_by
  WHERE app.has_site_access(r.site_id) AND (p_site_id IS NULL OR r.site_id=p_site_id)
  ORDER BY (r.status IN ('open','in_progress')) DESC,r.updated_at DESC,r.id LIMIT 100;
END $$;

CREATE FUNCTION app.inbox_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.require_actor();
  WITH problems AS MATERIALIZED (
    SELECT 'domain'::text AS kind,d.id::text AS id,d.site_id,s.name AS site_name,d.hostname_normalized AS title,
      COALESCE(d.error_code,'Domain setup needs attention') AS error,COALESCE(d.last_checked_at,d.created_at) AS occurred_at
    FROM public.domains d JOIN public.sites s ON s.id=d.site_id WHERE d.status='error' AND app.can_administer_site(d.site_id)
    UNION ALL
    SELECT 'delivery',o.id::text,o.site_id,s.name,o.event_type,COALESCE(o.last_error,'Background delivery failed'),COALESCE(o.failed_at,o.created_at)
    FROM public.outbox o LEFT JOIN public.sites s ON s.id=o.site_id WHERE o.status='dead'
      AND ((o.site_id IS NULL AND app.is_super_admin()) OR (o.site_id IS NOT NULL AND app.can_administer_site(o.site_id)))
    UNION ALL
    SELECT 'schedule',j.id::text,j.site_id,s.name,COALESCE(v.page_title,'Scheduled page'),COALESCE(j.last_error,'Scheduled action failed'),COALESCE(j.finished_at,j.run_at)
    FROM public.scheduled_actions j JOIN public.sites s ON s.id=j.site_id LEFT JOIN public.page_versions v ON v.id=j.version_id
    WHERE j.status='failed' AND app.can_publish(j.site_id)
  ) SELECT jsonb_build_object(
    'reviews',(SELECT count(*) FROM public.submissions r WHERE r.status='open' AND app.has_site_access(r.site_id)),
    'requests',(SELECT count(*) FROM public.section_requests r WHERE r.status IN ('open','in_progress') AND app.has_site_access(r.site_id)),
    'operations',(SELECT count(*) FROM problems),
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'id',id,'siteId',site_id,'siteName',site_name,
      'title',title,'error',app.redact_audit_detail(to_jsonb(error)),'occurredAt',occurred_at) ORDER BY occurred_at DESC,kind,id)
      FROM(SELECT * FROM problems ORDER BY occurred_at DESC,kind,id LIMIT 100) recent),'[]')
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app.request_custom_section(uuid,uuid,text,text),app.respond_section_request(uuid,bigint,text,text),app.section_request_feed(uuid),app.inbox_snapshot() FROM PUBLIC;
ALTER FUNCTION app.request_custom_section(uuid,uuid,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.respond_section_request(uuid,bigint,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.section_request_feed(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.inbox_snapshot() OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.request_custom_section(uuid,uuid,text,text),app.respond_section_request(uuid,bigint,text,text),app.section_request_feed(uuid),app.inbox_snapshot() TO cms_authenticated_user;
