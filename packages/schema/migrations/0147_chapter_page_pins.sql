-- Chapter configuration travels with the immutable page sent for approval.
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS chapters_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.chapter_page_versions(
 page_version_id uuid PRIMARY KEY REFERENCES public.page_versions(id),
 chapter_version_id uuid NOT NULL REFERENCES public.chapter_versions(id),
 site_id uuid NOT NULL REFERENCES public.sites(id),chapter_id uuid NOT NULL REFERENCES public.chapters(id)
);
ALTER TABLE public.chapter_page_versions OWNER TO cms_migration_owner;
ALTER TABLE public.chapter_page_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chapter_page_versions FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.chapter_page_versions TO cms_authenticated_user;
DROP POLICY IF EXISTS chapter_page_versions_visible ON public.chapter_page_versions;
CREATE POLICY chapter_page_versions_visible ON public.chapter_page_versions FOR SELECT TO cms_authenticated_user USING(app.site_role(site_id)='site_admin');
CREATE OR REPLACE FUNCTION app.enable_chapters(p_site uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'Only a Super Admin can enable chapters.' USING ERRCODE='CMS02';END IF;
 UPDATE public.sites SET chapters_enabled=true WHERE id=p_site AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'No such site.' USING ERRCODE='CMS03';END IF;
END$$;
CREATE OR REPLACE FUNCTION app.pin_chapter_page_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.chapter_page_versions(page_version_id,chapter_version_id,site_id,chapter_id)
 SELECT NEW.id,c.draft_version_id,c.site_id,c.id FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id
 WHERE c.site_id=NEW.site_id AND v.config->>'pageId'=NEW.page_id::text;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS page_versions_pin_chapter ON public.page_versions;
CREATE TRIGGER page_versions_pin_chapter AFTER INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.pin_chapter_page_setup();
CREATE OR REPLACE FUNCTION app.publish_pinned_chapter_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE pin public.chapter_page_versions%ROWTYPE;head public.chapters%ROWTYPE;
BEGIN
 IF NEW.published_version_id IS NULL OR NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id THEN RETURN NEW;END IF;
 SELECT * INTO pin FROM public.chapter_page_versions WHERE page_version_id=NEW.published_version_id AND site_id=NEW.site_id;
 IF pin.page_version_id IS NULL THEN RETURN NEW;END IF;
 SELECT * INTO head FROM public.chapters WHERE id=pin.chapter_id FOR UPDATE;
 IF head.published_version_id IS DISTINCT FROM pin.chapter_version_id THEN
  UPDATE public.chapters SET published_version_id=pin.chapter_version_id,revision=revision+1 WHERE id=head.id;
  PERFORM app.write_audit(head.site_id,CASE WHEN app.current_user_id() IS NULL THEN 'system'::public.actor_type ELSE 'user'::public.actor_type END,app.current_user_id(),'chapter.publish_setup','chapter',head.id,head.published_version_id,pin.chapter_version_id,jsonb_build_object('page_version_id',pin.page_version_id));
  PERFORM app.emit_outbox(head.site_id,'page.published',jsonb_build_object('site_id',head.site_id,'paths',(SELECT COALESCE(jsonb_agg(path),'[]'::jsonb) FROM public.published_routes WHERE site_id=head.site_id),'revision',head.revision+1));
 END IF;
 RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS pages_publish_chapter_setup ON public.pages;
CREATE TRIGGER pages_publish_chapter_setup AFTER UPDATE OF published_version_id ON public.pages FOR EACH ROW EXECUTE FUNCTION app.publish_pinned_chapter_setup();
ALTER FUNCTION app.enable_chapters(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.pin_chapter_page_setup() OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_pinned_chapter_setup() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.enable_chapters(uuid),app.pin_chapter_page_setup(),app.publish_pinned_chapter_setup() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.enable_chapters(uuid) TO cms_authenticated_user;
