-- A division exists independently of its first chapter. It grants no site role.
CREATE OR REPLACE FUNCTION app.current_division_scopes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;result jsonb;
BEGIN
 actor:=app.require_actor();
 SELECT COALESCE(jsonb_object_agg(d.id,jsonb_build_object('siteId',d.site_id,'name',d.name)),'{}'::jsonb) INTO result
 FROM public.chapter_divisions d JOIN public.chapter_division_memberships m ON m.division_id=d.id JOIN public.sites s ON s.id=d.site_id
 WHERE m.user_id=actor AND s.archived_at IS NULL;
 RETURN result;
END$$;
CREATE OR REPLACE FUNCTION app.has_scoped_site_access(p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u JOIN public.sites s ON s.id=p_site WHERE u.id=app.current_user_id() AND u.status='active' AND s.archived_at IS NULL AND (
 EXISTS(SELECT 1 FROM public.pages p WHERE p.site_id=s.id AND app.page_role_as(u.id,p.id) IS NOT NULL)
 OR EXISTS(SELECT 1 FROM public.chapter_divisions d JOIN public.chapter_division_memberships m ON m.division_id=d.id WHERE d.site_id=s.id AND m.user_id=u.id)))
$$;
CREATE TABLE IF NOT EXISTS public.chapter_site_settings(
 site_id uuid PRIMARY KEY REFERENCES public.sites(id),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 default_update_mode text NOT NULL DEFAULT 'division' CHECK(default_update_mode IN('division','chapter-editors'))
);
ALTER TABLE public.chapter_site_settings OWNER TO cms_migration_owner;
ALTER TABLE public.chapter_site_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chapter_site_settings FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.chapter_site_settings TO cms_authenticated_user;
DROP POLICY IF EXISTS chapter_site_settings_visible ON public.chapter_site_settings;
CREATE POLICY chapter_site_settings_visible ON public.chapter_site_settings FOR SELECT TO cms_authenticated_user USING(app.can_administer_site(site_id) OR app.has_scoped_site_access(site_id));
CREATE OR REPLACE FUNCTION app.save_chapter_defaults(p_site uuid,p_expected bigint,p_mode text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapter_site_settings%ROWTYPE;
BEGIN
 actor:=app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages chapter defaults.' USING ERRCODE='CMS02';END IF;
 PERFORM 1 FROM public.sites WHERE id=p_site AND archived_at IS NULL AND chapters_enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active chapter site.' USING ERRCODE='CMS04';END IF;
 IF p_mode IS NULL OR p_mode NOT IN('division','chapter-editors') THEN RAISE EXCEPTION 'Choose how new chapters get updated.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO head FROM public.chapter_site_settings WHERE site_id=p_site FOR UPDATE;
 IF COALESCE(head.revision,0) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'These settings changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
 INSERT INTO public.chapter_site_settings(site_id,revision,default_update_mode) VALUES(p_site,COALESCE(head.revision,0)+1,p_mode)
 ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,default_update_mode=excluded.default_update_mode;
 PERFORM app.write_audit(p_site,'user',actor,'chapter.defaults.save','site',p_site,NULL,NULL,jsonb_build_object('mode',p_mode));RETURN COALESCE(head.revision,0)+1;
END$$;
CREATE OR REPLACE FUNCTION app.create_division_chapter(p_division uuid,p_slug text,p_config jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site uuid;chapter uuid;page uuid;version uuid;config jsonb;defect text;
BEGIN
 actor:=app.require_actor();SELECT d.site_id INTO site FROM public.chapter_divisions d WHERE d.id=p_division AND (app.can_administer_site(d.site_id) OR EXISTS(SELECT 1 FROM public.chapter_division_memberships m WHERE m.division_id=d.id AND m.user_id=actor));
 IF site IS NULL THEN RAISE EXCEPTION 'Choose a division you work with.' USING ERRCODE='CMS02';END IF;
 PERFORM 1 FROM public.sites WHERE id=site AND archived_at IS NULL AND chapters_enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active chapter site.' USING ERRCODE='CMS04';END IF;
 IF p_slug IS NULL OR length(p_slug)>80 OR p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'Use a short chapter address with letters and numbers.' USING ERRCODE='CMS04';END IF;
 IF p_config->>'pageId' IS NOT NULL THEN RAISE EXCEPTION 'A new chapter gets its own page.' USING ERRCODE='CMS04';END IF;
 defect:=app.chapter_config_defect(p_config);IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 config:=p_config;
 IF config->>'destination'<>'external' THEN
  INSERT INTO public.pages(site_id,slug,title) VALUES(site,'chapters/'||p_slug,config->>'name') RETURNING id INTO page;
  config:=jsonb_set(config,'{pageId}',to_jsonb(page));
  PERFORM app.write_audit(site,'user',actor,'page.create','page',page,NULL,NULL,jsonb_build_object('slug','chapters/'||p_slug));
 END IF;
 INSERT INTO public.chapters(site_id,slug) VALUES(site,p_slug) RETURNING id INTO chapter;
 INSERT INTO public.chapter_division_assignments VALUES(chapter,p_division);
 INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(site,chapter,1,config,actor) RETURNING id INTO version;
 UPDATE public.chapters SET revision=1,draft_version_id=version WHERE id=chapter;
 PERFORM app.write_audit(site,'user',actor,'chapter.create','chapter',chapter,NULL,version,jsonb_build_object('division',p_division));RETURN chapter;
END$$;
CREATE OR REPLACE FUNCTION app.create_chapter_page(p_chapter uuid,p_expected bigint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapters%ROWTYPE;config jsonb;page uuid;version uuid;
BEGIN
 actor:=app.require_actor();PERFORM app.lock_chapter_setup(p_chapter);
 SELECT * INTO head FROM public.chapters WHERE id=p_chapter;
 IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This chapter changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND archived_at IS NULL AND chapters_enabled) THEN RAISE EXCEPTION 'Choose an active chapter site.' USING ERRCODE='CMS04';END IF;
 SELECT v.config INTO config FROM public.chapter_versions v WHERE v.id=head.draft_version_id;
 IF config->>'pageId' IS NOT NULL THEN RETURN (config->>'pageId')::uuid;END IF;
 INSERT INTO public.pages(site_id,slug,title) VALUES(head.site_id,'chapters/'||head.slug,config->>'name') RETURNING id INTO page;
 config:=jsonb_set(config,'{pageId}',to_jsonb(page));
 INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(head.site_id,head.id,head.revision+1,config,actor) RETURNING id INTO version;
 UPDATE public.chapters SET revision=head.revision+1,draft_version_id=version WHERE id=head.id;
 PERFORM app.write_audit(head.site_id,'user',actor,'page.create','page',page,NULL,NULL,jsonb_build_object('slug','chapters/'||head.slug));
 PERFORM app.write_audit(head.site_id,'user',actor,'chapter.save_setup','chapter',head.id,head.draft_version_id,version,'{}');RETURN page;
END$$;
CREATE OR REPLACE FUNCTION app.assign_chapter_division(p_chapter uuid,p_division uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site uuid;
BEGIN
 actor:=app.require_actor();SELECT site_id INTO site FROM public.chapters WHERE id=p_chapter FOR UPDATE;
 IF site IS NULL OR NOT app.can_administer_site(site) THEN RAISE EXCEPTION 'A site administrator assigns chapter teams.' USING ERRCODE='CMS02';END IF;
 IF p_division IS NULL THEN DELETE FROM public.chapter_division_assignments WHERE chapter_id=p_chapter;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.chapter_divisions WHERE id=p_division AND site_id=site) THEN RAISE EXCEPTION 'Choose a team on this site.' USING ERRCODE='CMS04';END IF;
  INSERT INTO public.chapter_division_assignments VALUES(p_chapter,p_division) ON CONFLICT(chapter_id) DO UPDATE SET division_id=excluded.division_id;
 END IF;
 PERFORM app.write_audit(site,'user',actor,'chapter.division.assign','chapter',p_chapter,NULL,NULL,jsonb_build_object('division',p_division));
END$$;
CREATE OR REPLACE FUNCTION app.set_chapter_division_staff(p_division uuid,p_email text,p_name text,p_enabled boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site uuid;person uuid;clean_email text;clean_name text;
BEGIN
 actor:=app.require_actor();SELECT site_id INTO site FROM public.chapter_divisions WHERE id=p_division;
 IF site IS NULL OR NOT app.can_administer_site(site) THEN RAISE EXCEPTION 'A site administrator manages division staff.' USING ERRCODE='CMS02';END IF;
 clean_email:=lower(btrim(p_email));clean_name:=btrim(p_name);
 IF p_enabled IS NULL OR clean_email IS NULL OR length(clean_email)>254 OR clean_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR clean_name IS NULL OR length(clean_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Add a name and valid email address.' USING ERRCODE='CMS04';END IF;
 IF p_enabled THEN INSERT INTO public.app_users(email,display_name) VALUES(clean_email,clean_name) ON CONFLICT(email) DO NOTHING;END IF;
 SELECT id INTO person FROM public.app_users u WHERE u.email=clean_email AND (NOT p_enabled OR u.status='active');
 IF person IS NULL THEN RAISE EXCEPTION 'A site administrator needs to review this person’s access.' USING ERRCODE='CMS04';END IF;
 PERFORM app.set_chapter_division_member(p_division,person,p_enabled);RETURN person;
END$$;
CREATE OR REPLACE FUNCTION app.chapter_team_feed(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages division staff.' USING ERRCODE='CMS02';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'people',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'active',u.status='active') ORDER BY lower(u.display_name),u.id),'[]'::jsonb) FROM public.chapter_division_memberships m JOIN public.app_users u ON u.id=m.user_id WHERE m.division_id=d.id)) ORDER BY lower(d.name),d.id),'[]'::jsonb) INTO result FROM public.chapter_divisions d WHERE d.site_id=p_site;
 RETURN result;
END$$;
DO $$DECLARE target regprocedure;BEGIN
 FOREACH target IN ARRAY ARRAY['app.current_division_scopes()'::regprocedure,'app.create_chapter_page(uuid,bigint)'::regprocedure,'app.save_chapter_defaults(uuid,bigint,text)'::regprocedure,'app.create_division_chapter(uuid,text,jsonb)'::regprocedure,'app.set_chapter_division_staff(uuid,text,text,boolean)'::regprocedure,'app.chapter_team_feed(uuid)'::regprocedure] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',target);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO cms_authenticated_user',target);
 END LOOP;
END$$;
