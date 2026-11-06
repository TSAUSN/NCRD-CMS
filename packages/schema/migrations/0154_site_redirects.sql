CREATE OR REPLACE FUNCTION app.redirect_path(p_path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE path text:=lower(rtrim(btrim(p_path),'/'));
BEGIN
 IF path IS NULL OR length(path) NOT BETWEEN 2 AND 2048 OR path!~'^(/[a-z0-9][a-z0-9._-]*)+$' OR position('..' IN path)>0 OR path~'^/(api|_next|_cms|assets|media|documents|fonts|scripts|styles|images|preview|previews)(/|$)' OR path~'\.(js|css|json|jpe?g|png|gif|webp|svg|ico|woff2?|ttf|otf|eot)$' OR path IN('/robots.txt','/sitemap.xml') THEN RETURN NULL;END IF;
 RETURN path;
END$$;
CREATE TABLE IF NOT EXISTS public.site_redirects(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id),old_path text NOT NULL,
 page_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(site_id,old_path),FOREIGN KEY(site_id,page_id) REFERENCES public.pages(site_id,id),CHECK(app.redirect_path(old_path) IS NOT NULL AND old_path=app.redirect_path(old_path))
);
ALTER TABLE public.site_redirects OWNER TO cms_migration_owner;
ALTER TABLE public.site_redirects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_redirects FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.site_redirects TO cms_authenticated_user;
DROP POLICY IF EXISTS site_redirects_admin ON public.site_redirects;
CREATE POLICY site_redirects_admin ON public.site_redirects FOR SELECT TO cms_authenticated_user USING(app.can_administer_site(site_id));
-- A chapter without a page will insert a new pages row. Take its site FK lock
-- before the chapter lock, matching release/redirect site-first locking.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.lock_chapter_setup(uuid)'::regprocedure);
 IF position('Site FK lock before chapter creation' IN body)=0 THEN
  updated:=replace(body,'DECLARE page uuid;current_page uuid;','DECLARE page uuid;current_page uuid;site uuid;');
  updated:=replace(updated,'-- Match the existing release lock order: page, then chapter.',$lock$-- Site FK lock before chapter creation.
 IF page IS NULL THEN
  SELECT site_id INTO site FROM public.chapters WHERE id=p_chapter;
  PERFORM 1 FROM public.sites WHERE id=site FOR KEY SHARE;
 END IF;
 -- Match the existing release lock order: page, then chapter.$lock$);
  IF updated=body OR position('Site FK lock before chapter creation' IN updated)=0 THEN RAISE EXCEPTION 'Chapter creation lock insertion point changed.';END IF;EXECUTE updated;
 END IF;
END$$;
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.create_page(uuid,text,text)'::regprocedure);
 IF position('Site FK lock before page path reservation' IN body)=0 THEN
  updated:=replace(body,'INSERT INTO public.pages (site_id, slug, title)',$lock$-- Site FK lock before page path reservation.
  PERFORM 1 FROM public.sites WHERE id=p_site_id AND archived_at IS NULL FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This site is unavailable for new pages.' USING ERRCODE='CMS04';END IF;
  INSERT INTO public.pages (site_id, slug, title)$lock$);
  IF updated=body THEN RAISE EXCEPTION 'Page creation lock insertion point changed.';END IF;EXECUTE updated;
 END IF;
END$$;
CREATE OR REPLACE FUNCTION app.save_site_redirect(p_site uuid,p_id uuid,p_expected bigint,p_path text,p_page uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;clean_path text;head public.site_redirects%ROWTYPE;result uuid;
BEGIN
 actor:=app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages redirects.' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(p_site);clean_path:=app.redirect_path(p_path);
 IF clean_path IS NULL THEN RAISE EXCEPTION 'Use an old page address such as /chapter/peoria. Leave out the website name and extra link options.' USING ERRCODE='CMS04';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pages WHERE site_id=p_site AND id=p_page AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an active page on this site.' USING ERRCODE='CMS04';END IF;
 IF EXISTS(SELECT 1 FROM public.pages WHERE site_id=p_site AND archived_at IS NULL AND '/'||slug=clean_path) OR EXISTS(SELECT 1 FROM public.published_routes WHERE site_id=p_site AND published_routes.path=clean_path) THEN RAISE EXCEPTION 'A page already uses this old address. Choose another address.' USING ERRCODE='CMS04';END IF;
 IF p_id IS NULL THEN
  IF p_expected IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'This redirect changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
  IF EXISTS(SELECT 1 FROM public.site_redirects WHERE site_id=p_site AND old_path=clean_path) THEN RAISE EXCEPTION 'This old address already has a redirect. Edit that redirect instead.' USING ERRCODE='CMS04';END IF;
  INSERT INTO public.site_redirects(site_id,old_path,page_id) VALUES(p_site,clean_path,p_page) RETURNING id INTO result;
 ELSE
  SELECT * INTO head FROM public.site_redirects WHERE id=p_id AND site_id=p_site FOR UPDATE;
  IF head.id IS NULL THEN RAISE EXCEPTION 'Redirect not found.' USING ERRCODE='CMS03';END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This redirect changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
  IF EXISTS(SELECT 1 FROM public.site_redirects WHERE site_id=p_site AND old_path=clean_path AND id<>p_id) THEN RAISE EXCEPTION 'This old address already has a redirect.' USING ERRCODE='CMS04';END IF;
  UPDATE public.site_redirects SET old_path=clean_path,page_id=p_page,revision=revision+1,updated_at=now() WHERE id=head.id RETURNING id INTO result;
 END IF;
 PERFORM app.write_audit(p_site,'user',actor,'site.redirect.save','site_redirect',result,NULL,NULL,jsonb_build_object('oldPath',clean_path,'page',p_page));RETURN result;
END$$;
CREATE OR REPLACE FUNCTION app.remove_site_redirect(p_site uuid,p_id uuid,p_expected bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.site_redirects%ROWTYPE;
BEGIN
 actor:=app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages redirects.' USING ERRCODE='CMS02';END IF;
 PERFORM app.lock_release_site(p_site);SELECT * INTO head FROM public.site_redirects WHERE site_id=p_site AND id=p_id FOR UPDATE;
 IF head.id IS NULL THEN RAISE EXCEPTION 'Redirect not found.' USING ERRCODE='CMS03';END IF;
 IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This redirect changed. Reload before removing it.' USING ERRCODE='CMS01';END IF;
 DELETE FROM public.site_redirects WHERE id=head.id;
 PERFORM app.write_audit(p_site,'user',actor,'site.redirect.remove','site_redirect',head.id,NULL,NULL,jsonb_build_object('oldPath',head.old_path));
END$$;
-- Run after FK checks. The redirect command locks the site/pages in the normal
-- release order, so a newly inserted page checks again after a waiting FK lock.
CREATE OR REPLACE FUNCTION app.guard_page_redirect_conflict() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE path text;
BEGIN
 IF TG_TABLE_NAME='pages' THEN
  IF NEW.archived_at IS NOT NULL THEN RETURN NULL;END IF;path:='/'||NEW.slug;
 ELSE path:=NEW.path;END IF;
 IF EXISTS(SELECT 1 FROM public.site_redirects WHERE site_id=NEW.site_id AND old_path=path) THEN RAISE EXCEPTION 'A redirect already uses this page address. Remove or change the redirect first.' USING ERRCODE='CMS04';END IF;
 RETURN NULL;
END$$;
DROP TRIGGER IF EXISTS zz_page_redirect_conflict ON public.pages;
CREATE TRIGGER zz_page_redirect_conflict AFTER INSERT OR UPDATE OF slug,archived_at ON public.pages FOR EACH ROW EXECUTE FUNCTION app.guard_page_redirect_conflict();
DROP TRIGGER IF EXISTS zz_published_redirect_conflict ON public.published_routes;
CREATE TRIGGER zz_published_redirect_conflict AFTER INSERT OR UPDATE OF path ON public.published_routes FOR EACH ROW EXECUTE FUNCTION app.guard_page_redirect_conflict();
CREATE OR REPLACE FUNCTION public_api.resolve_redirect(p_host text,p_path text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN h.redirect_to IS NOT NULL THEN 'https://'||h.redirect_to||target.path ELSE target.path END
 FROM public_api.resolve_host(p_host) h JOIN public.site_redirects redirect ON redirect.site_id=h.site_id AND redirect.old_path=app.redirect_path(p_path)
 JOIN public.pages page ON page.site_id=h.site_id AND page.id=redirect.page_id AND page.archived_at IS NULL
 JOIN public.published_routes target ON target.site_id=h.site_id AND target.page_id=page.id
 WHERE NOT EXISTS(SELECT 1 FROM public.published_routes source WHERE source.site_id=h.site_id AND source.path=redirect.old_path) ORDER BY target.path LIMIT 1
$$;
DO $$DECLARE target regprocedure;BEGIN
 FOREACH target IN ARRAY ARRAY['app.redirect_path(text)'::regprocedure,'app.save_site_redirect(uuid,uuid,bigint,text,uuid)'::regprocedure,'app.remove_site_redirect(uuid,uuid,bigint)'::regprocedure,'app.guard_page_redirect_conflict()'::regprocedure,'public_api.resolve_redirect(text,text)'::regprocedure] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',target);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION app.save_site_redirect(uuid,uuid,bigint,text,uuid),app.remove_site_redirect(uuid,uuid,bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION public_api.resolve_redirect(text,text) TO cms_public_renderer;
