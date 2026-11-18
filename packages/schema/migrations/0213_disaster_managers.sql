-- Disaster Managers: people who may use the Current Disasters tool and nothing
-- else unless they are also given site access. This is a declared tool grant,
-- not a global_roles value: a global role means super admin throughout the
-- schema, including the "keep at least one super admin" check.
CREATE TABLE public.tool_grants (
  user_id    uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  tool       text NOT NULL CHECK (tool IN ('current_disasters')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tool)
);
ALTER TABLE public.tool_grants OWNER TO cms_migration_owner;
ALTER TABLE public.tool_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_grants FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
-- People read their own grants; super admins read everyone's. Writes go only through the commands below.
CREATE POLICY tool_grants_self ON public.tool_grants FOR SELECT TO cms_authenticated_user
  USING (user_id = app.current_user_id() OR app.is_super_admin());
GRANT SELECT ON public.tool_grants TO cms_authenticated_user;
-- A grant change advances the person's revision, so a stale People form cannot overwrite it.
CREATE TRIGGER tool_grants_advance_person AFTER INSERT OR DELETE OR UPDATE ON public.tool_grants
  FOR EACH ROW EXECUTE FUNCTION app.membership_advances_person();

-- Whether the current person may use a tool. Super admins may use every tool.
CREATE FUNCTION app.can_use_tool(p_tool text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT app.is_super_admin() OR EXISTS(
    SELECT 1 FROM public.tool_grants g JOIN public.app_users u ON u.id=g.user_id
     WHERE g.user_id=app.current_user_id() AND g.tool=p_tool AND u.status='active')
$$;
REVOKE ALL ON FUNCTION app.can_use_tool(text) FROM PUBLIC;
ALTER FUNCTION app.can_use_tool(text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.can_use_tool(text) TO cms_authenticated_user;

-- The tools granted to the current person, for session resolution.
CREATE FUNCTION app.current_tools() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(g.tool ORDER BY g.tool),'{}')
    FROM public.tool_grants g WHERE g.user_id=app.current_user_id()
$$;
REVOKE ALL ON FUNCTION app.current_tools() FROM PUBLIC;
ALTER FUNCTION app.current_tools() OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.current_tools() TO cms_authenticated_user;

-- Grant or remove a tool for an existing person. Returns the person's new revision.
CREATE FUNCTION app.set_tool_grant(p_user_id uuid,p_expected_revision bigint,p_tool text,p_enabled boolean)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; result bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin may manage people' USING ERRCODE='CMS02'; END IF;
  IF COALESCE(p_tool,'') NOT IN ('current_disasters') OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'choose a known tool' USING ERRCODE='CMS04';
  END IF;
  SELECT * INTO head FROM public.app_users WHERE id=p_user_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such user' USING ERRCODE='CMS03'; END IF;
  IF head.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'this account changed; reload its current access before saving' USING ERRCODE='CMS01',DETAIL=head.revision::text;
  END IF;
  IF p_enabled THEN
    INSERT INTO public.tool_grants(user_id,tool) VALUES(p_user_id,p_tool) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.tool_grants WHERE user_id=p_user_id AND tool=p_tool;
  END IF;
  SELECT revision INTO result FROM public.app_users WHERE id=p_user_id;
  PERFORM app.write_audit(NULL,'user',actor,'tool_grant.set','app_user',p_user_id,NULL,NULL,
    jsonb_build_object('tool',p_tool,'enabled',p_enabled));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app.set_tool_grant(uuid,bigint,text,boolean) FROM PUBLIC;
ALTER FUNCTION app.set_tool_grant(uuid,bigint,text,boolean) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.set_tool_grant(uuid,bigint,text,boolean) TO cms_authenticated_user;

-- Add a person whose only access is one tool. Like app.add_person, it sends no
-- email and creates no sign-in identity; the person signs in normally.
CREATE FUNCTION app.add_tool_person(p_email text,p_name text,p_tool text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; target uuid; clean_email text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('cms-people',0));
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may add people' USING ERRCODE='CMS02';
  END IF;
  IF COALESCE(p_tool,'') NOT IN ('current_disasters') THEN
    RAISE EXCEPTION 'choose a known tool' USING ERRCODE='CMS04';
  END IF;
  clean_email:=lower(btrim(COALESCE(p_email,'')));
  IF char_length(clean_email)>254 OR clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR char_length(btrim(COALESCE(p_name,''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'enter a name and valid email address' USING ERRCODE='CMS04';
  END IF;
  IF EXISTS(SELECT 1 FROM public.app_users WHERE email=clean_email) THEN
    RAISE EXCEPTION 'this person already has an account; edit their access' USING ERRCODE='CMS04';
  END IF;
  target:=app.provision_user(clean_email,btrim(p_name));
  INSERT INTO public.tool_grants(user_id,tool) VALUES(target,p_tool);
  PERFORM app.write_audit(NULL,'user',actor,'user.add','app_user',target,NULL,NULL,
    jsonb_build_object('tools',jsonb_build_array(p_tool),'invitation_sent',false));
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION app.add_tool_person(text,text,text) FROM PUBLIC;
ALTER FUNCTION app.add_tool_person(text,text,text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.add_tool_person(text,text,text) TO cms_authenticated_user;

-- A person whose only access is a tool grant may sign in. Unchanged otherwise.
CREATE OR REPLACE FUNCTION app.is_invited_email(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE email=lower(p_email) AND status='active' AND (
  EXISTS(SELECT 1 FROM public.site_memberships WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=u.id)
  OR EXISTS(SELECT 1 FROM public.chapter_division_memberships WHERE user_id=u.id)
  OR EXISTS(SELECT 1 FROM public.page_memberships m WHERE m.user_id=u.id AND app.page_role_as(u.id,m.page_id) IS NOT NULL)
  OR EXISTS(SELECT 1 FROM public.tool_grants WHERE user_id=u.id)))
$$;
