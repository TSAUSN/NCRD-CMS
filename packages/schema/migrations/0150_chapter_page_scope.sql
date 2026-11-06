-- Whole-site access stays unchanged. Chapter access has page-specific predicates.
CREATE TABLE IF NOT EXISTS public.chapter_divisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),UNIQUE(site_id,id),UNIQUE(site_id,name));
CREATE TABLE IF NOT EXISTS public.chapter_division_memberships(division_id uuid NOT NULL REFERENCES public.chapter_divisions(id),user_id uuid NOT NULL REFERENCES public.app_users(id),PRIMARY KEY(division_id,user_id));
CREATE TABLE IF NOT EXISTS public.chapter_division_assignments(chapter_id uuid PRIMARY KEY REFERENCES public.chapters(id),division_id uuid NOT NULL REFERENCES public.chapter_divisions(id));
CREATE TABLE IF NOT EXISTS public.page_memberships(page_id uuid NOT NULL REFERENCES public.pages(id),user_id uuid NOT NULL REFERENCES public.app_users(id),PRIMARY KEY(page_id,user_id));
CREATE TABLE IF NOT EXISTS public.chapter_shared_sections(page_id uuid NOT NULL REFERENCES public.pages(id),part text NOT NULL CHECK(part IN('what','join')),position integer NOT NULL CHECK(position>=0),instance jsonb NOT NULL CHECK(app.json_within(instance,524288)),PRIMARY KEY(page_id,part));
CREATE OR REPLACE FUNCTION app.page_role_as(p_user uuid,p_page uuid) RETURNS public.site_role_name
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN app.site_role_of(p_user,p.site_id) IS NOT NULL THEN app.site_role_of(p_user,p.site_id)
 WHEN NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_user AND status='active') OR p.archived_at IS NOT NULL OR s.archived_at IS NOT NULL THEN NULL
 WHEN EXISTS(SELECT 1 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id JOIN public.chapter_division_assignments a ON a.chapter_id=c.id JOIN public.chapter_division_memberships m ON m.division_id=a.division_id WHERE c.site_id=p.site_id AND v.config->>'pageId'=p.id::text AND m.user_id=p_user) THEN 'editor'::public.site_role_name
 WHEN EXISTS(SELECT 1 FROM public.page_memberships m JOIN public.chapters c ON c.site_id=p.site_id JOIN public.chapter_versions v ON v.id=c.draft_version_id AND v.config->>'pageId'=p.id::text AND v.config->>'updateMode'='chapter-editors' WHERE m.page_id=p.id AND m.user_id=p_user) THEN 'contributor'::public.site_role_name END
 FROM public.pages p JOIN public.sites s ON s.id=p.site_id WHERE p.id=p_page
$$;
CREATE OR REPLACE FUNCTION app.has_page_access(p_page uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT app.page_role_as(app.current_user_id(),p_page) IS NOT NULL$$;
CREATE OR REPLACE FUNCTION app.can_publish_page_as(p_user uuid,p_page uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT COALESCE(app.page_role_as(p_user,p_page) IN('editor','site_admin'),false)$$;
CREATE OR REPLACE FUNCTION app.can_publish_page(p_page uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT app.can_publish_page_as(app.current_user_id(),p_page)$$;
CREATE OR REPLACE FUNCTION app.has_scoped_site_access(p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.current_user_id() IS NOT NULL AND EXISTS(SELECT 1 FROM public.pages p WHERE p.site_id=p_site AND app.page_role_as(app.current_user_id(),p.id) IS NOT NULL)
$$;
CREATE OR REPLACE FUNCTION app.can_manage_chapter(p_chapter uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.current_user_id() IS NOT NULL AND EXISTS(SELECT 1 FROM public.chapters c WHERE c.id=p_chapter AND (app.site_role(c.site_id)='site_admin' OR EXISTS(SELECT 1 FROM public.chapter_division_assignments a JOIN public.chapter_division_memberships m ON m.division_id=a.division_id WHERE a.chapter_id=c.id AND m.user_id=app.current_user_id())))
$$;
CREATE OR REPLACE FUNCTION app.can_view_chapter_division(p_division uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.current_user_id() IS NOT NULL AND EXISTS(SELECT 1 FROM public.chapter_divisions d WHERE d.id=p_division AND (app.can_administer_site(d.site_id) OR EXISTS(SELECT 1 FROM public.chapter_division_memberships m WHERE m.division_id=d.id AND m.user_id=app.current_user_id())))
$$;
CREATE OR REPLACE FUNCTION app.can_administer_chapter_division(p_division uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.chapter_divisions d WHERE d.id=p_division AND app.can_administer_site(d.site_id))
$$;
CREATE OR REPLACE FUNCTION app.current_page_scopes() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;result jsonb;
BEGIN
 actor:=app.require_actor();
 SELECT COALESCE(jsonb_object_agg(p.id,jsonb_build_object('siteId',p.site_id,'role',app.page_role_as(actor,p.id))),'{}'::jsonb) INTO result FROM public.pages p WHERE app.site_role_of(actor,p.site_id) IS NULL AND app.page_role_as(actor,p.id) IS NOT NULL;
 RETURN result;
END$$;
CREATE OR REPLACE FUNCTION app.create_chapter_division(p_site uuid,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;result uuid;
BEGIN
 actor:=app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages chapter teams.' USING ERRCODE='CMS02';END IF;
 INSERT INTO public.chapter_divisions(site_id,name) VALUES(p_site,btrim(p_name)) ON CONFLICT(site_id,name) DO UPDATE SET name=excluded.name RETURNING id INTO result;
 PERFORM app.write_audit(p_site,'user',actor,'chapter.division.create','chapter_division',result,NULL,NULL,'{}');RETURN result;
END$$;
CREATE OR REPLACE FUNCTION app.set_chapter_division_member(p_division uuid,p_user uuid,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site uuid;
BEGIN
 actor:=app.require_actor();SELECT site_id INTO site FROM public.chapter_divisions WHERE id=p_division;
 IF site IS NULL OR NOT app.can_administer_site(site) THEN RAISE EXCEPTION 'A site administrator manages chapter teams.' USING ERRCODE='CMS02';END IF;
 IF p_enabled IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_user) THEN RAISE EXCEPTION 'Choose a person and an access option.' USING ERRCODE='CMS04';END IF;
 IF p_enabled THEN INSERT INTO public.chapter_division_memberships VALUES(p_division,p_user) ON CONFLICT DO NOTHING;ELSE DELETE FROM public.chapter_division_memberships WHERE division_id=p_division AND user_id=p_user;END IF;
 PERFORM app.write_audit(site,'user',actor,'chapter.division.access','chapter_division',p_division,NULL,NULL,jsonb_build_object('person',p_user,'enabled',p_enabled));
END$$;
CREATE OR REPLACE FUNCTION app.assign_chapter_division(p_chapter uuid,p_division uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site uuid;
BEGIN
 actor:=app.require_actor();SELECT site_id INTO site FROM public.chapters WHERE id=p_chapter;
 IF site IS NULL OR NOT app.can_administer_site(site) THEN RAISE EXCEPTION 'A site administrator assigns chapter teams.' USING ERRCODE='CMS02';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chapter_divisions WHERE id=p_division AND site_id=site) THEN RAISE EXCEPTION 'Choose a team on this site.' USING ERRCODE='CMS04';END IF;
 INSERT INTO public.chapter_division_assignments VALUES(p_chapter,p_division) ON CONFLICT(chapter_id) DO UPDATE SET division_id=excluded.division_id;
 PERFORM app.write_audit(site,'user',actor,'chapter.division.assign','chapter',p_chapter,NULL,NULL,jsonb_build_object('division',p_division));
END$$;
CREATE OR REPLACE FUNCTION app.assign_chapter_editor(p_chapter uuid,p_user uuid,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head record;page uuid;
BEGIN
 actor:=app.require_actor();IF NOT app.can_manage_chapter(p_chapter) THEN RAISE EXCEPTION 'A chapter team administrator can invite editors.' USING ERRCODE='CMS02';END IF;
 SELECT c.site_id,v.config INTO head FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.id=p_chapter;
 IF p_enabled IS NULL OR NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_user) THEN RAISE EXCEPTION 'Choose a person and an access option.' USING ERRCODE='CMS04';END IF;
 page:=(head.config->>'pageId')::uuid;
 IF page IS NULL OR (p_enabled AND head.config->>'updateMode'<>'chapter-editors') THEN RAISE EXCEPTION 'Choose chapter editors and create the chapter page first.' USING ERRCODE='CMS04';END IF;
 IF p_enabled AND app.site_role_of(p_user,head.site_id) IS NOT NULL THEN RAISE EXCEPTION 'This person already has whole-site access. Review that access before assigning one page.' USING ERRCODE='CMS04';END IF;
 IF p_enabled THEN INSERT INTO public.page_memberships VALUES(page,p_user) ON CONFLICT DO NOTHING;ELSE DELETE FROM public.page_memberships WHERE page_id=page AND user_id=p_user;END IF;
 PERFORM app.write_audit(head.site_id,'user',actor,'chapter.editor.access','page',page,NULL,NULL,jsonb_build_object('person',p_user,'enabled',p_enabled));
END$$;
-- Apply row visibility without changing the whole-site predicate used by all
-- list, design, people, import/export and global configuration commands.
DROP POLICY IF EXISTS sites_member ON public.sites;
CREATE POLICY sites_member ON public.sites FOR SELECT TO cms_authenticated_user USING(app.has_site_access(id) OR app.has_scoped_site_access(id));
DROP POLICY IF EXISTS pages_member ON public.pages;
CREATE POLICY pages_member ON public.pages FOR SELECT TO cms_authenticated_user USING(app.has_page_access(id));
DROP POLICY IF EXISTS page_versions_member ON public.page_versions;
CREATE POLICY page_versions_member ON public.page_versions FOR SELECT TO cms_authenticated_user USING(app.has_page_access(page_id));
DROP POLICY IF EXISTS published_routes_member ON public.published_routes;
CREATE POLICY published_routes_member ON public.published_routes FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id) OR app.has_scoped_site_access(site_id));
DROP POLICY IF EXISTS published_site_shells_member ON public.published_site_shells;
CREATE POLICY published_site_shells_member ON public.published_site_shells FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id) OR app.has_scoped_site_access(site_id));
DROP POLICY IF EXISTS submissions_member ON public.submissions;
CREATE POLICY submissions_member ON public.submissions FOR SELECT TO cms_authenticated_user USING((app.has_site_access(site_id) AND (submitted_by=app.current_user_id() OR app.can_review(site_id))) OR (item_type='page' AND app.has_page_access(item_id) AND (submitted_by=app.current_user_id() OR app.can_publish_page(item_id))));
-- New private tables expose only the caller's access or its administrators.
DO $$DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['chapter_divisions','chapter_division_memberships','chapter_division_assignments','page_memberships','chapter_shared_sections'] LOOP
  EXECUTE format('ALTER TABLE public.%I OWNER TO cms_migration_owner',name);EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',name);EXECUTE format('GRANT SELECT ON public.%I TO cms_authenticated_user',name);
 END LOOP;
END$$;
DROP POLICY IF EXISTS chapter_divisions_visible ON public.chapter_divisions;
CREATE POLICY chapter_divisions_visible ON public.chapter_divisions FOR SELECT TO cms_authenticated_user USING(app.can_view_chapter_division(id));
DROP POLICY IF EXISTS chapter_division_memberships_visible ON public.chapter_division_memberships;
CREATE POLICY chapter_division_memberships_visible ON public.chapter_division_memberships FOR SELECT TO cms_authenticated_user USING(user_id=app.current_user_id() OR app.can_administer_chapter_division(division_id));
DROP POLICY IF EXISTS chapter_division_assignments_visible ON public.chapter_division_assignments;
CREATE POLICY chapter_division_assignments_visible ON public.chapter_division_assignments FOR SELECT TO cms_authenticated_user USING(app.can_manage_chapter(chapter_id));
DROP POLICY IF EXISTS page_memberships_visible ON public.page_memberships;
CREATE POLICY page_memberships_visible ON public.page_memberships FOR SELECT TO cms_authenticated_user USING(user_id=app.current_user_id() OR app.can_publish_page(page_id));
DROP POLICY IF EXISTS chapter_shared_sections_visible ON public.chapter_shared_sections;
CREATE POLICY chapter_shared_sections_visible ON public.chapter_shared_sections FOR SELECT TO cms_authenticated_user USING(app.has_page_access(page_id));
DROP POLICY IF EXISTS chapters_visible ON public.chapters;
CREATE POLICY chapters_visible ON public.chapters FOR SELECT TO cms_authenticated_user USING(app.can_manage_chapter(id));
DROP POLICY IF EXISTS chapter_versions_visible ON public.chapter_versions;
CREATE POLICY chapter_versions_visible ON public.chapter_versions FOR SELECT TO cms_authenticated_user USING(app.can_manage_chapter(chapter_id));
-- Reuse existing commands, substituting only their relevant page capability.
DO $$DECLARE target regprocedure;body text;updated text;BEGIN
 FOREACH target IN ARRAY ARRAY['app.save_page_draft(uuid,bigint,jsonb,jsonb,version_kind,text)'::regprocedure,'app.restore_version_as_draft(uuid,bigint,uuid,text)'::regprocedure,'app.submit_page_for_review(uuid,bigint,text)'::regprocedure] LOOP
  body:=pg_get_functiondef(target);updated:=replace(body,'app.has_site_access(head.site_id)','app.has_page_access(head.id)');
  IF updated=body AND position('app.has_page_access(head.id)' IN body)=0 THEN RAISE EXCEPTION 'Page scope insertion point changed: %',target;END IF;EXECUTE updated;
 END LOOP;
 FOREACH target IN ARRAY ARRAY['app.approve_page_submission(uuid,integer,text,jsonb)'::regprocedure,'app.reject_page_submission(uuid,text)'::regprocedure] LOOP
  body:=pg_get_functiondef(target);updated:=replace(replace(body,'app.has_site_access(s.site_id)','app.has_page_access(s.item_id)'),'app.can_review(head.site_id)','app.can_publish_page(head.id)');
  IF updated=body AND position('app.can_publish_page(head.id)' IN body)=0 THEN RAISE EXCEPTION 'Review scope insertion point changed: %',target;END IF;EXECUTE updated;
 END LOOP;
 FOREACH target IN ARRAY ARRAY['app.publish_page(uuid,bigint,integer,text,jsonb)'::regprocedure,'app.publish_page_version(uuid,bigint,uuid,actor_type,uuid,integer,text,jsonb,jsonb)'::regprocedure] LOOP
  body:=pg_get_functiondef(target);updated:=replace(replace(body,'app.can_publish_as(actor, head.site_id)','app.can_publish_page_as(actor, head.id)'),'app.can_publish_as(p_authorizing_user, head.site_id)','app.can_publish_page_as(p_authorizing_user, head.id)');
  IF updated=body AND position('app.can_publish_page_as(' IN body)=0 THEN RAISE EXCEPTION 'Publication scope insertion point changed: %',target;END IF;EXECUTE updated;
 END LOOP;
 body:=pg_get_functiondef('app.build_initial_preview_manifest(uuid)'::regprocedure);updated:=replace(body,'app.has_site_access(version.site_id)','app.has_page_access(version.page_id)');IF updated=body AND position('app.has_page_access(version.page_id)' IN body)=0 THEN RAISE EXCEPTION 'Preview scope insertion point changed.';END IF;EXECUTE updated;
 body:=pg_get_functiondef('app.build_render_manifest(uuid)'::regprocedure);updated:=replace(body,'app.has_site_access(owner_site)','app.has_page_access((SELECT page_id FROM public.page_versions WHERE id=p_page_version_id))');IF updated=body AND position('app.has_page_access(' IN body)=0 THEN RAISE EXCEPTION 'Manifest scope insertion point changed.';END IF;EXECUTE updated;
END$$;
-- Review read models and discussion retain their exact-version audience.
DO $$DECLARE target regprocedure;body text;updated text;BEGIN
 body:=pg_get_functiondef('app.review_queue(uuid,boolean,integer,uuid,uuid)'::regprocedure);
 updated:=replace(replace(body,'app.has_site_access(sub.site_id)','app.has_page_access(sub.item_id)'),'app.can_review(sub.site_id)','app.can_publish_page(sub.item_id)');
 IF updated=body AND position('app.has_page_access(sub.item_id)' IN body)=0 THEN RAISE EXCEPTION 'Review queue scope insertion point changed.';END IF;EXECUTE updated;
 FOREACH target IN ARRAY ARRAY['app.review_comments(uuid)'::regprocedure,'app.add_page_comment(uuid,uuid,text,jsonb)'::regprocedure,'app.resolve_page_comment(uuid,boolean)'::regprocedure] LOOP
  body:=pg_get_functiondef(target);updated:=replace(replace(replace(replace(replace(replace(body,'app.has_site_access(s.site_id)','app.has_page_access(s.item_id)'),'app.has_site_access(p.site_id)','app.has_page_access(p.id)'),'app.has_site_access(c.site_id)','app.has_page_access(c.item_id)'),'app.can_review(s.site_id)','app.can_publish_page(s.item_id)'),'app.can_review(request.site_id)','app.can_publish_page(request.item_id)'),'app.can_review(comment.site_id)','app.can_publish_page(comment.item_id)');
  IF target='app.add_page_comment(uuid,uuid,text,jsonb)'::regprocedure THEN
   updated:=replace(updated,E'EXISTS (SELECT 1 FROM public.site_memberships m\n                       WHERE m.user_id = u.id AND m.site_id = page.site_id)','app.page_role_as(u.id,page.id) IS NOT NULL');
   IF position('app.page_role_as(u.id,page.id)' IN updated)=0 THEN RAISE EXCEPTION 'Review mention scope insertion point changed.';END IF;
  END IF;
  IF updated=body AND position('app.has_page_access(' IN body)=0 THEN RAISE EXCEPTION 'Review discussion scope insertion point changed: %',target;END IF;EXECUTE updated;
 END LOOP;
 body:=pg_get_functiondef('app.review_people(uuid)'::regprocedure);
 IF position('app.has_scoped_site_access(p_site_id)' IN body)=0 THEN
  updated:=replace(body,'IF NOT app.has_site_access(p_site_id) THEN',$scope$IF NOT app.has_site_access(p_site_id) AND app.has_scoped_site_access(p_site_id) THEN
    RETURN QUERY SELECT DISTINCT u.id,COALESCE(NULLIF(u.display_name,''),u.email) FROM public.app_users u WHERE u.status='active' AND EXISTS(SELECT 1 FROM public.pages p WHERE p.site_id=p_site_id AND app.has_page_access(p.id) AND app.page_role_as(u.id,p.id) IS NOT NULL) ORDER BY 2;
    RETURN;
  END IF;
  IF NOT app.has_site_access(p_site_id) THEN$scope$);
  IF updated=body THEN RAISE EXCEPTION 'Review people scope insertion point changed.';END IF;EXECUTE updated;
 END IF;
 body:=pg_get_functiondef('app.inbox_snapshot_without_collection_reviews()'::regprocedure);
 updated:=replace(body,$count$r.status='open' AND app.has_site_access(r.site_id)$count$,$count$r.status='open' AND ((r.item_type='page' AND app.has_page_access(r.item_id) AND (r.submitted_by=app.current_user_id() OR app.can_publish_page(r.item_id))) OR (r.item_type<>'page' AND app.has_site_access(r.site_id)))$count$);
 IF updated=body AND position('app.has_page_access(r.item_id)' IN body)=0 THEN RAISE EXCEPTION 'Inbox count scope insertion point changed.';END IF;EXECUTE updated;
 body:=pg_get_functiondef('app.preview_chapter_directory(uuid)'::regprocedure);updated:=replace(body,'NOT app.has_site_access(p_site)','NOT (app.has_site_access(p_site) OR app.has_scoped_site_access(p_site))');IF updated<>body THEN EXECUTE updated;END IF;
END$$;
DROP POLICY IF EXISTS comments_member_read ON public.comments;
CREATE POLICY comments_member_read ON public.comments FOR SELECT TO cms_authenticated_user USING(
 (app.has_site_access(site_id) OR (item_type='page' AND app.has_page_access(item_id))) AND
 (author_id=app.current_user_id() OR (item_type='page' AND app.can_publish_page(item_id)) OR app.can_review(site_id) OR EXISTS(SELECT 1 FROM public.submissions s WHERE s.site_id=comments.site_id AND s.item_type=comments.item_type AND s.item_id=comments.item_id AND s.version_id IS NOT DISTINCT FROM comments.version_id AND s.submitted_by=app.current_user_id())));
-- The exact submitted page also captures its optional chapter parts. A page
-- editor changes only these flags; private contact and destination stay intact.
CREATE OR REPLACE FUNCTION app.pin_chapter_page_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.chapters%ROWTYPE;config jsonb;next_config jsonb;part text;shown boolean;created uuid;social_position integer;paragraph_position integer;display text;
BEGIN
 SELECT c.* INTO head FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=NEW.site_id AND v.config->>'pageId'=NEW.page_id::text FOR UPDATE OF c;
 IF head.id IS NULL THEN RETURN NEW;END IF;
 SELECT v.config INTO config FROM public.chapter_versions v WHERE v.id=head.draft_version_id;
 next_config:=config;
 FOREACH part IN ARRAY ARRAY['paragraph','social','events','board','photos','memberLogin'] LOOP
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}'=part AND NOT COALESCE((section->>'hidden')::boolean,false)) INTO shown;
  next_config:=jsonb_set(next_config,ARRAY['sections',part],to_jsonb(shown));
 END LOOP;
 SELECT min(ordinality) FILTER(WHERE value#>>'{values,__cms_chapter_part}'='social'),min(ordinality) FILTER(WHERE value#>>'{values,__cms_chapter_part}'='paragraph') INTO social_position,paragraph_position FROM jsonb_array_elements(NEW.content) WITH ORDINALITY;
 IF social_position IS NOT NULL AND paragraph_position IS NOT NULL THEN next_config:=jsonb_set(next_config,'{sections,socialFirst}',to_jsonb(social_position<paragraph_position));END IF;
 SELECT value#>>'{values,__cms_board_display}' INTO display FROM jsonb_array_elements(NEW.content) WHERE value#>>'{values,__cms_chapter_part}'='board' LIMIT 1;
 IF display IN('all','first-eight') THEN next_config:=jsonb_set(next_config,'{boardDisplay}',to_jsonb(display));END IF;
 IF next_config IS DISTINCT FROM config THEN
  INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(head.site_id,head.id,head.revision+1,next_config,NEW.author_id) RETURNING id INTO created;
  UPDATE public.chapters SET revision=head.revision+1,draft_version_id=created WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,CASE WHEN NEW.author_id IS NULL THEN 'system'::public.actor_type ELSE 'user'::public.actor_type END,NEW.author_id,'chapter.page_options','chapter',head.id,head.draft_version_id,created,'{}');
 ELSE created:=head.draft_version_id;END IF;
 INSERT INTO public.chapter_page_versions(page_version_id,chapter_version_id,site_id,chapter_id) VALUES(NEW.id,created,head.site_id,head.id);
 RETURN NEW;
END$$;
ALTER FUNCTION app.pin_chapter_page_setup() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.pin_chapter_page_setup() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
-- Canonical shared instances are maintained only by editors. The insertion
-- trigger covers save, restore and any future command creating a page version.
CREATE OR REPLACE FUNCTION app.guard_chapter_shared_sections() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE locked record;matches integer;
BEGIN
 IF app.page_role_as(app.current_user_id(),NEW.page_id) IS DISTINCT FROM 'contributor'::public.site_role_name THEN RETURN NEW;END IF;
 FOR locked IN SELECT * FROM public.chapter_shared_sections WHERE page_id=NEW.page_id LOOP
  SELECT count(*) INTO matches FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}'=locked.part;
  IF matches<>1 OR NEW.content->locked.position IS DISTINCT FROM locked.instance THEN RAISE EXCEPTION 'This shared section is kept by site editors. Your other changes have not been saved.' USING ERRCODE='CMS02';END IF;
 END LOOP;
 RETURN NEW;
END$$;
CREATE OR REPLACE FUNCTION app.capture_chapter_shared_sections() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT app.can_publish_page(NEW.page_id) THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=NEW.site_id AND v.config->>'pageId'=NEW.page_id::text) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}' IN('what','join') GROUP BY section#>>'{values,__cms_chapter_part}' HAVING count(*)>1) THEN RAISE EXCEPTION 'Keep one copy of each shared section on a chapter page.' USING ERRCODE='CMS04';END IF;
 DELETE FROM public.chapter_shared_sections locked WHERE locked.page_id=NEW.page_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}'=locked.part);
 INSERT INTO public.chapter_shared_sections(page_id,part,position,instance) SELECT NEW.page_id,value#>>'{values,__cms_chapter_part}',ordinality-1,value FROM jsonb_array_elements(NEW.content) WITH ORDINALITY WHERE value#>>'{values,__cms_chapter_part}' IN('what','join') ON CONFLICT(page_id,part) DO UPDATE SET position=excluded.position,instance=excluded.instance;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS page_versions_guard_chapter_shared ON public.page_versions;
CREATE TRIGGER page_versions_guard_chapter_shared BEFORE INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.guard_chapter_shared_sections();
DROP TRIGGER IF EXISTS page_versions_capture_chapter_shared ON public.page_versions;
CREATE TRIGGER page_versions_capture_chapter_shared AFTER INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.capture_chapter_shared_sections();
-- Backfill existing canonical drafts once without rewriting any page version.
INSERT INTO public.chapter_shared_sections(page_id,part,position,instance) SELECT p.id,section.value#>>'{values,__cms_chapter_part}',section.ordinality-1,section.value FROM public.pages p JOIN public.page_versions v ON v.id=p.draft_version_id JOIN public.chapters c ON c.site_id=p.site_id JOIN public.chapter_versions config ON config.id=c.draft_version_id AND config.config->>'pageId'=p.id::text CROSS JOIN LATERAL jsonb_array_elements(v.content) WITH ORDINALITY section WHERE section.value#>>'{values,__cms_chapter_part}' IN('what','join') ON CONFLICT DO NOTHING;
DO $$DECLARE target regprocedure;BEGIN
 FOREACH target IN ARRAY ARRAY['app.page_role_as(uuid,uuid)'::regprocedure,'app.can_view_chapter_division(uuid)'::regprocedure,'app.can_administer_chapter_division(uuid)'::regprocedure,'app.has_page_access(uuid)'::regprocedure,'app.can_publish_page_as(uuid,uuid)'::regprocedure,'app.can_publish_page(uuid)'::regprocedure,'app.has_scoped_site_access(uuid)'::regprocedure,'app.can_manage_chapter(uuid)'::regprocedure,'app.current_page_scopes()'::regprocedure,'app.create_chapter_division(uuid,text)'::regprocedure,'app.set_chapter_division_member(uuid,uuid,boolean)'::regprocedure,'app.assign_chapter_division(uuid,uuid)'::regprocedure,'app.assign_chapter_editor(uuid,uuid,boolean)'::regprocedure,'app.guard_chapter_shared_sections()'::regprocedure,'app.capture_chapter_shared_sections()'::regprocedure] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',target);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION app.can_view_chapter_division(uuid),app.can_administer_chapter_division(uuid),app.has_page_access(uuid),app.can_publish_page(uuid),app.has_scoped_site_access(uuid),app.can_manage_chapter(uuid),app.current_page_scopes(),app.create_chapter_division(uuid,text),app.set_chapter_division_member(uuid,uuid,boolean),app.assign_chapter_division(uuid,uuid),app.assign_chapter_editor(uuid,uuid,boolean) TO cms_authenticated_user;
