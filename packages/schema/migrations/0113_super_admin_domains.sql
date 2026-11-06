-- Domain management belongs exclusively to the active global Super Admin.
-- Replace commands in place so existing reservations, history, worker jobs,
-- function ownership and narrow grants survive the upgrade unchanged.

CREATE OR REPLACE FUNCTION app.add_domain(p_site_id uuid,p_hostname text,p_with_www boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; site RECORD; host text; alias text; target uuid; new_id uuid; existing RECORD;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a Super Admin can manage domains' USING ERRCODE='CMS02'; END IF;
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

CREATE OR REPLACE FUNCTION app.check_domain(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a Super Admin can manage domains' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO d FROM public.domains WHERE id=p_id FOR UPDATE;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
 IF d.removed_at IS NOT NULL OR d.kind='staging' THEN RAISE EXCEPTION 'domain is not available for verification' USING ERRCODE='CMS04'; END IF;
 PERFORM app.enqueue_domain(p_id);
 PERFORM app.write_audit(d.site_id,'user',actor,'domain.check','domain',p_id,NULL,NULL,'{}');
END $$;

CREATE OR REPLACE FUNCTION app.remove_domain(p_id uuid,p_revision bigint,p_confirmation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; row RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a Super Admin can manage domains' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO d FROM public.domains WHERE id=p_id;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
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

CREATE OR REPLACE FUNCTION app.set_primary_domain(p_id uuid,p_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d RECORD; actor uuid;
BEGIN
 actor:=app.require_actor();
 IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a Super Admin can manage domains' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO d FROM public.domains WHERE id=p_id;
 IF d IS NULL THEN RAISE EXCEPTION 'domain not found' USING ERRCODE='CMS03'; END IF;
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

