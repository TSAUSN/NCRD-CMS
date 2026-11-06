-- Site creation requests are retryable without creating a second site. All
-- starter work is performed in the caller's transaction after this command.
ALTER TABLE public.sites ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
  ADD COLUMN creation_request_id uuid UNIQUE, ADD COLUMN creation_fingerprint text,
  ADD CONSTRAINT sites_creation_request_pair CHECK((creation_request_id IS NULL)=(creation_fingerprint IS NULL));

CREATE FUNCTION app.begin_site_setup(
  p_request_id uuid,p_fingerprint text,p_slug text,p_name text,p_kind site_kind,p_host text,p_theme jsonb
) RETURNS TABLE(site_id uuid,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; existing RECORD; target uuid; defect text;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may create sites' USING ERRCODE='CMS02'; END IF;
  IF p_request_id IS NULL OR COALESCE(p_fingerprint,'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'site creation needs a valid request reference' USING ERRCODE='CMS04';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,54));
  SELECT * INTO existing FROM public.sites WHERE creation_request_id=p_request_id;
  IF existing IS NOT NULL THEN
    IF existing.created_by IS DISTINCT FROM actor OR existing.creation_fingerprint IS DISTINCT FROM p_fingerprint THEN
      RAISE EXCEPTION 'this creation request was already used for different settings' USING ERRCODE='CMS04';
    END IF;
    RETURN QUERY SELECT existing.id,false; RETURN;
  END IF;
  IF char_length(COALESCE(p_slug,'')) NOT BETWEEN 1 AND 40 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 120
    OR COALESCE(p_kind::text,'') NOT IN ('resource','event')
    OR char_length(COALESCE(p_host,'')) NOT BETWEEN 1 AND 253
    OR p_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' OR p_host<>lower(p_host) THEN
    RAISE EXCEPTION 'the site name, address or starter type is invalid' USING ERRCODE='CMS04';
  END IF;
  IF EXISTS(SELECT 1 FROM regexp_split_to_table(p_host,'\.') label
    WHERE label !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') THEN
    RAISE EXCEPTION 'the staging hostname is invalid' USING ERRCODE='CMS04';
  END IF;
  defect:=app.theme_tokens_defect(p_theme);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04'; END IF;
  target:=app.create_site(p_slug,btrim(p_name),p_kind,p_host,p_theme,'[]');
  UPDATE public.sites SET creation_request_id=p_request_id,creation_fingerprint=p_fingerprint WHERE id=target;
  RETURN QUERY SELECT target,true;
END $$;

CREATE FUNCTION app.archive_site(p_site_id uuid,p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint; shell_rev bigint;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.sites WHERE id=p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'site not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN RAISE EXCEPTION 'only a site admin may archive this site' USING ERRCODE='CMS02'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'site settings changed; reload before archiving' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
  IF head.status='archived' THEN RAISE EXCEPTION 'site is already archived' USING ERRCODE='CMS04'; END IF;
  next_rev:=head.revision+1;
  UPDATE public.sites SET status='archived',archived_at=clock_timestamp(),revision=next_rev WHERE id=p_site_id;
  shell_rev:=app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id,'user',actor,'site.archive','site',p_site_id,NULL,NULL,jsonb_build_object('revision',next_rev));
  PERFORM app.emit_outbox(p_site_id,'site_shell.published',jsonb_build_object('site_id',p_site_id,'revision',shell_rev,
    'paths',COALESCE((SELECT jsonb_agg(path) FROM public.published_routes WHERE site_id=p_site_id),'[]')));
  RETURN next_rev;
END $$;

CREATE FUNCTION app.update_site_name(p_site_id uuid,p_expected_revision bigint,p_name text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; settings RECORD; next_rev bigint; version_id uuid; shell_rev bigint; published_settings jsonb;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.sites WHERE id=p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'site not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN RAISE EXCEPTION 'only a site admin may change this site' USING ERRCODE='CMS02'; END IF;
  IF head.status='archived' THEN RAISE EXCEPTION 'this site is archived' USING ERRCODE='CMS04'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'site settings changed; reload before saving' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'enter a site name of up to 120 characters' USING ERRCODE='CMS04'; END IF;
  IF head.name=btrim(p_name) THEN RETURN head.revision; END IF;
  SELECT * INTO settings FROM public.site_settings WHERE site_id=p_site_id FOR UPDATE;
  SELECT v.settings INTO published_settings FROM public.site_setting_versions v WHERE v.id=settings.published_version_id;
  INSERT INTO public.site_setting_versions(site_id,site_settings_id,revision,settings,author_id)
    VALUES(p_site_id,settings.id,settings.revision+1,COALESCE(published_settings,'{}')||jsonb_build_object('name',btrim(p_name)),actor) RETURNING id INTO version_id;
  UPDATE public.site_settings SET revision=settings.revision+1,
    draft_version_id=CASE WHEN draft_version_id IS NULL OR draft_version_id IS NOT DISTINCT FROM published_version_id THEN version_id ELSE draft_version_id END,
    published_version_id=version_id WHERE id=settings.id;
  next_rev:=head.revision+1;
  UPDATE public.sites SET name=btrim(p_name),revision=next_rev WHERE id=p_site_id;
  shell_rev:=app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id,'user',actor,'site.settings','site',p_site_id,settings.published_version_id,version_id,
    jsonb_build_object('revision',next_rev,'old_name',head.name,'name',btrim(p_name)));
  PERFORM app.emit_outbox(p_site_id,'site_shell.published',jsonb_build_object('site_id',p_site_id,'revision',shell_rev,
    'paths',COALESCE((SELECT jsonb_agg(path) FROM public.published_routes WHERE site_id=p_site_id),'[]')));
  RETURN next_rev;
END $$;

-- Both a staging host and an already-live custom domain stop resolving when
-- the site is archived. Projections remain available for admin/history reads.
CREATE OR REPLACE FUNCTION public_api.resolve_host(p_host text)
RETURNS TABLE(site_id uuid,canonical_host text,is_staging boolean,redirect_to text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT d.site_id,COALESCE(target.hostname_normalized,d.hostname_normalized),false,
    CASE WHEN d.kind='redirect' THEN target.hostname_normalized END
  FROM public.domains d JOIN public.sites s ON s.id=d.site_id
  LEFT JOIN public.domains target ON target.id=d.redirect_to_domain_id
  WHERE d.hostname_normalized=p_host AND d.status='live' AND s.status<>'archived' AND s.archived_at IS NULL
    AND (d.kind<>'redirect' OR target.status='live')
  UNION ALL
  SELECT s.id,s.staging_hostname,true,NULL FROM public.sites s
  WHERE s.staging_hostname=p_host AND s.status<>'archived' AND s.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.domains d WHERE d.hostname_normalized=p_host AND d.status='live')
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION app.begin_site_setup(uuid,text,text,text,site_kind,text,jsonb),app.archive_site(uuid,bigint),app.update_site_name(uuid,bigint,text) FROM PUBLIC;
ALTER FUNCTION app.begin_site_setup(uuid,text,text,text,site_kind,text,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.archive_site(uuid,bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.update_site_name(uuid,bigint,text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.begin_site_setup(uuid,text,text,text,site_kind,text,jsonb),app.archive_site(uuid,bigint),app.update_site_name(uuid,bigint,text) TO cms_authenticated_user;
