-- People and invitation commands. Application sessions never use a provider
-- service key; every edit is audited and echoes the version the operator saw.
ALTER TABLE public.app_users ADD COLUMN revision bigint NOT NULL DEFAULT 0;
-- Names now belong to versioned page edits; the old direct grant skipped CAS.
REVOKE UPDATE (title) ON public.pages FROM cms_authenticated_user;

CREATE FUNCTION app.advance_person_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF (NEW.display_name,NEW.status,NEW.auth_subject) IS DISTINCT FROM
     (OLD.display_name,OLD.status,OLD.auth_subject) THEN NEW.revision := OLD.revision + 1; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_users_advance_revision BEFORE UPDATE OF display_name,status,auth_subject ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION app.advance_person_revision();

CREATE FUNCTION app.membership_advances_person() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN
    UPDATE public.app_users SET revision=revision+1 WHERE id=OLD.user_id;
    RETURN OLD;
  END IF;
  UPDATE public.app_users SET revision=revision+1 WHERE id=NEW.user_id;
  RETURN NEW;
END $$;
CREATE TRIGGER site_memberships_advance_person AFTER INSERT OR UPDATE OR DELETE ON public.site_memberships
  FOR EACH ROW EXECUTE FUNCTION app.membership_advances_person();
CREATE TRIGGER global_roles_advance_person AFTER INSERT OR UPDATE OR DELETE ON public.global_roles
  FOR EACH ROW EXECUTE FUNCTION app.membership_advances_person();

CREATE OR REPLACE FUNCTION app.set_user_status(p_user_id uuid,p_status user_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may change user status' USING ERRCODE='CMS02'; END IF;
  IF p_status IS NULL THEN RAISE EXCEPTION 'choose an account status' USING ERRCODE='CMS04'; END IF;
  IF p_user_id=actor AND p_status='disabled' THEN
    RAISE EXCEPTION 'you cannot deactivate your own account' USING ERRCODE='CMS04';
  END IF;
  IF p_status='disabled' AND EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=p_user_id)
     AND NOT EXISTS(SELECT 1 FROM public.global_roles g JOIN public.app_users u ON u.id=g.user_id
       WHERE u.status='active' AND u.id<>p_user_id) THEN
    RAISE EXCEPTION 'keep at least one active super admin' USING ERRCODE='CMS04';
  END IF;
  UPDATE public.app_users SET status=p_status WHERE id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such user' USING ERRCODE='CMS03'; END IF;
  PERFORM app.write_audit(NULL,'user',actor,'user.set_status','app_user',p_user_id,NULL,NULL,
    jsonb_build_object('status',p_status));
END $$;

CREATE OR REPLACE FUNCTION app.set_global_role(p_user_id uuid,p_role global_role_name) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may change global roles' USING ERRCODE='CMS02'; END IF;
  IF p_role IS NULL AND EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=p_user_id)
     AND NOT EXISTS(SELECT 1 FROM public.global_roles g JOIN public.app_users u ON u.id=g.user_id
       WHERE u.status='active' AND u.id<>p_user_id) THEN
    RAISE EXCEPTION 'keep at least one active super admin' USING ERRCODE='CMS04';
  END IF;
  IF p_role IS NULL THEN DELETE FROM public.global_roles WHERE user_id=p_user_id;
  ELSE INSERT INTO public.global_roles(user_id,role) VALUES(p_user_id,p_role)
    ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role; END IF;
  PERFORM app.write_audit(NULL,'user',actor,'global_role.set','app_user',p_user_id,NULL,NULL,jsonb_build_object('role',p_role));
END $$;

CREATE FUNCTION app.validate_person_memberships(p_memberships jsonb,p_user_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE item jsonb; target uuid; seen uuid[] := '{}';
BEGIN
  IF jsonb_typeof(p_memberships) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'site assignments must be a list' USING ERRCODE='CMS04';
  END IF;
  IF jsonb_array_length(p_memberships)>100 THEN
    RAISE EXCEPTION 'choose up to 100 site assignments' USING ERRCODE='CMS04';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_memberships) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR (item-ARRAY['siteId','role'])<>'{}'::jsonb
       OR COALESCE(item->>'role','') NOT IN ('site_admin','editor','contributor')
       OR COALESCE(item->>'siteId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'a site assignment is invalid' USING ERRCODE='CMS04';
    END IF;
    target:=(item->>'siteId')::uuid;
    IF target=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.sites s WHERE id=target
      AND (s.status<>'archived' OR EXISTS(SELECT 1 FROM public.site_memberships WHERE user_id=p_user_id AND site_id=target))) THEN
      RAISE EXCEPTION 'choose each active site at most once' USING ERRCODE='CMS04';
    END IF;
    seen:=array_append(seen,target);
  END LOOP;
END $$;

CREATE FUNCTION app.invite_user(p_email text,p_name text,p_memberships jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; target uuid; item jsonb; clean_email text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may invite users' USING ERRCODE='CMS02'; END IF;
  clean_email:=lower(btrim(COALESCE(p_email,'')));
  IF char_length(clean_email)>254 OR clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'enter a name and valid email address' USING ERRCODE='CMS04';
  END IF;
  PERFORM app.validate_person_memberships(p_memberships);
  IF jsonb_array_length(p_memberships)=0 THEN RAISE EXCEPTION 'assign at least one site to an invitation' USING ERRCODE='CMS04'; END IF;
  IF EXISTS(SELECT 1 FROM public.app_users WHERE email=clean_email) THEN
    RAISE EXCEPTION 'this person already has an account; edit their access or resend their invitation' USING ERRCODE='CMS04';
  END IF;
  target:=app.provision_user(clean_email,btrim(p_name));
  FOR item IN SELECT value FROM jsonb_array_elements(p_memberships) LOOP
    PERFORM app.set_site_membership(target,(item->>'siteId')::uuid,(item->>'role')::site_role_name);
  END LOOP;
  PERFORM app.emit_outbox(NULL,'user.invited',jsonb_build_object('user_id',target,'email',clean_email));
  PERFORM app.write_audit(NULL,'user',actor,'user.invite','app_user',target,NULL,NULL,jsonb_build_object('sites',p_memberships));
  RETURN target;
END $$;

CREATE FUNCTION app.update_person(p_user_id uuid,p_expected_revision bigint,p_name text,p_status text,p_memberships jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; item jsonb; old_site uuid; result bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may manage people' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO head FROM public.app_users WHERE id=p_user_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such user' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'this account changed; reload its current access before saving' USING ERRCODE='CMS01',DETAIL=head.revision::text;
  END IF;
  IF char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 200 OR COALESCE(p_status,'') NOT IN ('active','disabled') THEN
    RAISE EXCEPTION 'enter a name and choose an account status' USING ERRCODE='CMS04';
  END IF;
  PERFORM app.validate_person_memberships(p_memberships,p_user_id);
  PERFORM app.set_user_status(p_user_id,p_status::user_status);
  UPDATE public.app_users SET display_name=btrim(p_name) WHERE id=p_user_id;
  FOR old_site IN SELECT site_id FROM public.site_memberships WHERE user_id=p_user_id LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_memberships) x WHERE (x->>'siteId')::uuid=old_site) THEN
      PERFORM app.set_site_membership(p_user_id,old_site,NULL);
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_memberships) LOOP
    PERFORM app.set_site_membership(p_user_id,(item->>'siteId')::uuid,(item->>'role')::site_role_name);
  END LOOP;
  SELECT revision INTO result FROM public.app_users WHERE id=p_user_id;
  PERFORM app.write_audit(NULL,'user',actor,'user.update','app_user',p_user_id,NULL,NULL,jsonb_build_object('revision',result));
  RETURN result;
END $$;

CREATE FUNCTION app.resend_invitation(p_user_id uuid,p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; event_id bigint;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may resend invitations' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO head FROM public.app_users WHERE id=p_user_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such user' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'this account changed; reload it' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
  IF head.status<>'active' THEN RAISE EXCEPTION 'reactivate this account before sending an invitation' USING ERRCODE='CMS04'; END IF;
  IF EXISTS(SELECT 1 FROM public.outbox WHERE event_type='user.invited' AND payload->>'user_id'=p_user_id::text
    AND created_at>now()-interval '1 minute') THEN RAISE EXCEPTION 'wait a minute before sending another invitation' USING ERRCODE='CMS04'; END IF;
  event_id:=app.emit_outbox(NULL,'user.invited',jsonb_build_object('user_id',p_user_id,'email',head.email));
  PERFORM app.write_audit(NULL,'user',actor,'user.invite_resend','app_user',p_user_id,NULL,NULL,jsonb_build_object('event_id',event_id));
  RETURN event_id;
END $$;

-- A narrow pre-auth check, never exposed as a public endpoint. The sign-in
-- action returns the same receipt whether the address is invited or unknown.
CREATE FUNCTION app.is_invited_email(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE email=lower(p_email) AND status='active'
    AND (EXISTS(SELECT 1 FROM public.site_memberships WHERE user_id=u.id)
      OR EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=u.id)))
$$;

CREATE OR REPLACE FUNCTION app.attach_auth_subject(p_email text,p_auth_subject text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE person RECORD;
BEGIN
  IF COALESCE(p_auth_subject,'')='' THEN RAISE EXCEPTION 'verified identity is required' USING ERRCODE='CMS04'; END IF;
  SELECT id,auth_subject INTO person FROM public.app_users WHERE email=lower(p_email) AND status='active' FOR UPDATE;
  IF person IS NULL THEN RAISE EXCEPTION 'no active product account' USING ERRCODE='CMS03'; END IF;
  IF person.auth_subject=p_auth_subject THEN RETURN person.id; END IF;
  IF person.auth_subject IS NOT NULL THEN RAISE EXCEPTION 'this account has a different verified identity' USING ERRCODE='CMS04'; END IF;
  UPDATE public.app_users SET auth_subject=p_auth_subject WHERE id=person.id;
  PERFORM app.write_audit(NULL,'user',person.id,'user.attach_auth_subject','app_user',person.id,NULL,NULL,'{}');
  RETURN person.id;
END $$;

DO $$ DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'app.advance_person_revision()'::regprocedure,'app.membership_advances_person()'::regprocedure,
    'app.validate_person_memberships(jsonb,uuid)'::regprocedure,'app.invite_user(text,text,jsonb)'::regprocedure,
    'app.update_person(uuid,bigint,text,text,jsonb)'::regprocedure,'app.resend_invitation(uuid,bigint)'::regprocedure,
    'app.is_invited_email(text)'::regprocedure
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',f);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.invite_user(text,text,jsonb),app.update_person(uuid,bigint,text,text,jsonb),
  app.resend_invitation(uuid,bigint),app.is_invited_email(text) TO cms_authenticated_user;
