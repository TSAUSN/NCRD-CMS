-- Membership creation is independent of invitation delivery. Authentication still
-- requires the normal verified provider identity; this creates no provider user,
-- password, sign-in token or email event.
CREATE FUNCTION app.add_person(p_email text,p_name text,p_memberships jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; target uuid; item jsonb; clean_email text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may add people' USING ERRCODE='CMS02';
  END IF;
  clean_email:=lower(btrim(COALESCE(p_email,'')));
  IF char_length(clean_email)>254 OR clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'enter a name and valid email address' USING ERRCODE='CMS04';
  END IF;
  PERFORM app.validate_person_memberships(p_memberships);
  IF jsonb_array_length(p_memberships)=0 THEN
    RAISE EXCEPTION 'assign at least one site before adding a person' USING ERRCODE='CMS04';
  END IF;
  IF EXISTS(SELECT 1 FROM public.app_users WHERE email=clean_email) THEN
    RAISE EXCEPTION 'this person already has an account; edit their access' USING ERRCODE='CMS04';
  END IF;
  target:=app.provision_user(clean_email,btrim(p_name));
  FOR item IN SELECT value FROM jsonb_array_elements(p_memberships) LOOP
    PERFORM app.set_site_membership(target,(item->>'siteId')::uuid,(item->>'role')::site_role_name);
  END LOOP;
  PERFORM app.write_audit(NULL,'user',actor,'user.add','app_user',target,NULL,NULL,
    jsonb_build_object('sites',p_memberships,'invitation_sent',false));
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION app.add_person(text,text,jsonb) FROM PUBLIC;
ALTER FUNCTION app.add_person(text,text,jsonb) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.add_person(text,text,jsonb) TO cms_authenticated_user;
