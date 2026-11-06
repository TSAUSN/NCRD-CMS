-- Local-demo mail is recorded separately; the delivery worker never sends it.
CREATE TABLE IF NOT EXISTS public.local_chapter_outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id),chapter_id uuid NOT NULL REFERENCES public.chapters(id),
 kind text NOT NULL CHECK(kind IN('sign-in','check','review','reminder')),recipient text NOT NULL CHECK(length(recipient)<=254),subject text NOT NULL CHECK(length(subject)<=240),
 body text NOT NULL CHECK(octet_length(body)<=65536),link text CHECK(length(link)<=2048),dedupe_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(site_id,chapter_id) REFERENCES public.chapters(site_id,id)
);
CREATE TABLE IF NOT EXISTS public.local_chapter_sign_in_links(
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'),user_id uuid NOT NULL REFERENCES public.app_users(id),page_id uuid NOT NULL REFERENCES public.pages(id),
 expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.local_chapter_outbox OWNER TO cms_migration_owner;
ALTER TABLE public.local_chapter_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_chapter_sign_in_links OWNER TO cms_migration_owner;
ALTER TABLE public.local_chapter_sign_in_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.local_chapter_outbox,public.local_chapter_sign_in_links FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.local_chapter_outbox TO cms_authenticated_user;
DROP POLICY IF EXISTS local_chapter_outbox_visible ON public.local_chapter_outbox;
CREATE POLICY local_chapter_outbox_visible ON public.local_chapter_outbox FOR SELECT TO cms_authenticated_user USING(app.can_manage_chapter(chapter_id));
CREATE OR REPLACE FUNCTION app.lock_chapter_setup(p_chapter uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE page uuid;current_page uuid;
BEGIN
 PERFORM app.require_actor();IF NOT app.can_manage_chapter(p_chapter) THEN RAISE EXCEPTION 'This chapter is not available to your team.' USING ERRCODE='CMS02';END IF;
 SELECT (v.config->>'pageId')::uuid INTO page FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.id=p_chapter;
 -- Match the existing release lock order: page, then chapter.
 IF page IS NOT NULL THEN PERFORM 1 FROM public.pages WHERE id=page FOR UPDATE;END IF;
 PERFORM 1 FROM public.chapters WHERE id=p_chapter FOR UPDATE;
 SELECT (v.config->>'pageId')::uuid INTO current_page FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.id=p_chapter;
 IF current_page IS DISTINCT FROM page THEN RAISE EXCEPTION 'This chapter changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
END$$;
-- Division staff may update an assigned setup, but cannot reassign its page or
-- create arbitrary pages through the ordinary whole-site command.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.save_chapter_setup(uuid,uuid,bigint,text,jsonb)'::regprocedure);
 IF position('app.can_manage_chapter(p_chapter)' IN body)=0 THEN
  updated:=replace(body,$old$IF app.site_role(p_site) IS DISTINCT FROM 'site_admin'::site_role_name THEN RAISE EXCEPTION 'Only a site administrator can change chapter setup.' USING ERRCODE='CMS02';END IF;$old$,$new$IF app.site_role(p_site) IS DISTINCT FROM 'site_admin'::site_role_name THEN
   IF p_chapter IS NULL OR NOT app.can_manage_chapter(p_chapter) THEN RAISE EXCEPTION 'This chapter is not available to your team.' USING ERRCODE='CMS02';END IF;
   IF p_config->>'pageId' IS DISTINCT FROM (SELECT v.config->>'pageId' FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.id=p_chapter) THEN RAISE EXCEPTION 'Keep the assigned chapter page. A site administrator can move it.' USING ERRCODE='CMS02';END IF;
  END IF;$new$);
  IF updated=body THEN RAISE EXCEPTION 'Chapter setup scope insertion point changed.';END IF;EXECUTE updated;
 END IF;
END$$;
CREATE OR REPLACE FUNCTION app.invite_chapter_editor(p_chapter uuid,p_expected bigint,p_email text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapters%ROWTYPE;person uuid;clean_email text;clean_name text;
BEGIN
 actor:=app.require_actor();PERFORM app.lock_chapter_setup(p_chapter);
 SELECT * INTO head FROM public.chapters WHERE id=p_chapter;
 IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This chapter changed. Reload before inviting someone.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 clean_email:=lower(btrim(p_email));clean_name:=btrim(p_name);
 IF clean_email IS NULL OR length(clean_email)>254 OR clean_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR clean_name IS NULL OR length(clean_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Add a name and a valid email address.' USING ERRCODE='CMS04';END IF;
 INSERT INTO public.app_users(email,display_name) VALUES(clean_email,clean_name) ON CONFLICT(email) DO NOTHING;
 SELECT id INTO person FROM public.app_users WHERE app_users.email=clean_email AND status='active';
 IF person IS NULL THEN RAISE EXCEPTION 'A site administrator needs to review this person’s access.' USING ERRCODE='CMS02';END IF;
 PERFORM app.assign_chapter_editor(p_chapter,person,true);
 PERFORM app.write_audit(head.site_id,'user',actor,'chapter.editor.invite','chapter',head.id,NULL,NULL,jsonb_build_object('person',person));
 RETURN person;
END$$;
CREATE OR REPLACE FUNCTION app.chapter_editor_feed(p_chapter uuid) RETURNS TABLE(id uuid,name text,email text,enabled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();IF NOT app.can_manage_chapter(p_chapter) THEN RAISE EXCEPTION 'This chapter is not available to your team.' USING ERRCODE='CMS02';END IF;
 RETURN QUERY SELECT u.id,u.display_name,u.email,u.status='active' AND v.config->>'updateMode'='chapter-editors'
 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id JOIN public.page_memberships m ON m.page_id=(v.config->>'pageId')::uuid JOIN public.app_users u ON u.id=m.user_id WHERE c.id=p_chapter ORDER BY lower(u.display_name),u.id;
END$$;
-- These three functions are server sign-in boundaries, like resolve_session.
-- Only the explicit loopback/recording adapter calls them. Public/worker roles
-- cannot execute them; no browser request can select its own actor or cookie.
CREATE OR REPLACE FUNCTION app.is_invited_email(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE email=lower(p_email) AND status='active' AND (
  EXISTS(SELECT 1 FROM public.site_memberships WHERE user_id=u.id) OR EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=u.id)
  OR EXISTS(SELECT 1 FROM public.chapter_division_memberships WHERE user_id=u.id)
  OR EXISTS(SELECT 1 FROM public.page_memberships m WHERE m.user_id=u.id AND app.page_role_as(u.id,m.page_id) IS NOT NULL)))
$$;
CREATE OR REPLACE FUNCTION app.is_scoped_chapter_email(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u JOIN public.page_memberships m ON m.user_id=u.id JOIN public.pages p ON p.id=m.page_id WHERE u.email=lower(btrim(p_email)) AND u.status='active' AND app.site_role_of(u.id,p.site_id) IS NULL AND app.page_role_as(u.id,p.id)='contributor')
$$;
CREATE OR REPLACE FUNCTION app.queue_local_chapter_sign_in(p_email text,p_token text,p_origin text,p_chapter uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE person record;digest text;link text;
BEGIN
 IF p_token IS NULL OR p_token!~'^[A-Za-z0-9_-]{43}$' OR p_origin IS NULL OR p_origin!~'^http://(localhost|127\.0\.0\.1)(:[0-9]{2,5})?$' THEN RAISE EXCEPTION 'Local sign-in is unavailable.' USING ERRCODE='CMS04';END IF;
 SELECT u.id,u.email,p.id AS page_id,c.id AS chapter_id,c.site_id,v.config->>'name' AS chapter_name INTO person FROM public.app_users u JOIN public.page_memberships m ON m.user_id=u.id JOIN public.pages p ON p.id=m.page_id JOIN public.chapters c ON c.site_id=p.site_id JOIN public.chapter_versions v ON v.id=c.draft_version_id AND v.config->>'pageId'=p.id::text WHERE u.email=lower(btrim(p_email)) AND u.status='active' AND (u.auth_subject IS NULL OR u.auth_subject='local|'||u.email) AND app.site_role_of(u.id,p.site_id) IS NULL AND app.page_role_as(u.id,p.id)='contributor' AND (p_chapter IS NULL OR c.id=p_chapter) ORDER BY c.id LIMIT 1;
 IF person.id IS NULL THEN RETURN;END IF;
 digest:=encode(sha256(convert_to(p_token,'UTF8')),'hex');link:=p_origin||'/auth/local-chapter?code='||p_token;
 UPDATE public.local_chapter_sign_in_links SET used_at=now() WHERE user_id=person.id AND used_at IS NULL;
 INSERT INTO public.local_chapter_sign_in_links(digest,user_id,page_id,expires_at) VALUES(digest,person.id,person.page_id,now()+interval '20 minutes');
 INSERT INTO public.local_chapter_outbox(site_id,chapter_id,kind,recipient,subject,body,link,dedupe_key) VALUES(person.site_id,person.chapter_id,'sign-in',person.email,'Sign in to edit '||left(person.chapter_name,200),'Open this link to edit your chapter page. It works once and expires in 20 minutes. Your changes stay in draft until your division approves them.',link,'sign-in:'||digest);
 PERFORM app.write_audit(person.site_id,'system',NULL,'chapter.sign_in_link_requested','page',person.page_id,NULL,NULL,'{}');
END$$;
CREATE OR REPLACE FUNCTION app.consume_local_chapter_sign_in(p_token text) RETURNS TABLE(user_id uuid,email text,page_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE token public.local_chapter_sign_in_links%ROWTYPE;person record;
BEGIN
 IF p_token IS NULL OR p_token!~'^[A-Za-z0-9_-]{43}$' THEN RETURN;END IF;
 SELECT * INTO token FROM public.local_chapter_sign_in_links l WHERE l.digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
 IF token.digest IS NULL OR token.used_at IS NOT NULL OR token.expires_at<=now() OR app.page_role_as(token.user_id,token.page_id) IS DISTINCT FROM 'contributor'::public.site_role_name THEN RETURN;END IF;
 SELECT u.id,u.email INTO person FROM public.app_users u WHERE u.id=token.user_id AND u.status='active' AND (u.auth_subject IS NULL OR u.auth_subject='local|'||u.email);
 IF person.id IS NULL THEN RETURN;END IF;
 UPDATE public.local_chapter_sign_in_links SET used_at=now() WHERE digest=token.digest;
 RETURN QUERY SELECT person.id,person.email,token.page_id;
END$$;
CREATE OR REPLACE FUNCTION app.local_chapter_mail_feed(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_actor();
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',mail.id,'kind',mail.kind,'recipient',mail.recipient,'subject',mail.subject,'body',mail.body,'link',CASE WHEN token.used_at IS NULL AND token.expires_at>now() THEN mail.link END,'createdAt',mail.created_at,'expired',token.used_at IS NOT NULL OR token.expires_at<=now()) ORDER BY mail.created_at DESC,mail.id),'[]'::jsonb) INTO result
 FROM (SELECT * FROM public.local_chapter_outbox o WHERE o.site_id=p_site AND app.can_manage_chapter(o.chapter_id) ORDER BY o.created_at DESC,o.id LIMIT 100) mail
 LEFT JOIN public.local_chapter_sign_in_links token ON token.digest=split_part(mail.dedupe_key,':',2);
 RETURN result;
END$$;
DO $$DECLARE target regprocedure;BEGIN
 FOREACH target IN ARRAY ARRAY['app.local_chapter_mail_feed(uuid)'::regprocedure,'app.lock_chapter_setup(uuid)'::regprocedure,'app.invite_chapter_editor(uuid,bigint,text,text)'::regprocedure,'app.chapter_editor_feed(uuid)'::regprocedure,'app.is_scoped_chapter_email(text)'::regprocedure,'app.queue_local_chapter_sign_in(text,text,text,uuid)'::regprocedure,'app.consume_local_chapter_sign_in(text)'::regprocedure] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',target);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION app.local_chapter_mail_feed(uuid),app.lock_chapter_setup(uuid),app.invite_chapter_editor(uuid,bigint,text,text),app.chapter_editor_feed(uuid),app.is_scoped_chapter_email(text),app.queue_local_chapter_sign_in(text,text,text,uuid),app.consume_local_chapter_sign_in(text) TO cms_authenticated_user;
