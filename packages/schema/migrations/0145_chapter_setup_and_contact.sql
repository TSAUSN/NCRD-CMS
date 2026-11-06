-- Immutable chapter setup and a redacted, publication-aware directory.
CREATE TABLE IF NOT EXISTS public.chapters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id),
 slug text NOT NULL CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
 revision bigint NOT NULL DEFAULT 0,draft_version_id uuid,published_version_id uuid,
 UNIQUE(site_id,slug),UNIQUE(site_id,id)
);
CREATE TABLE IF NOT EXISTS public.chapter_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL,chapter_id uuid NOT NULL,revision bigint NOT NULL,
 config jsonb NOT NULL CHECK(app.json_within(config,32768)),author_id uuid REFERENCES public.app_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,chapter_id) REFERENCES public.chapters(site_id,id),UNIQUE(chapter_id,id),UNIQUE(chapter_id,revision)
);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='chapters_draft_owned' AND conrelid='public.chapters'::regclass) THEN
  ALTER TABLE public.chapters ADD CONSTRAINT chapters_draft_owned FOREIGN KEY(id,draft_version_id) REFERENCES public.chapter_versions(chapter_id,id);
  ALTER TABLE public.chapters ADD CONSTRAINT chapters_published_owned FOREIGN KEY(id,published_version_id) REFERENCES public.chapter_versions(chapter_id,id);
 END IF;
END$$;
CREATE TABLE IF NOT EXISTS public.contact_messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),site_id uuid NOT NULL REFERENCES public.sites(id),page_id uuid NOT NULL,
 message jsonb NOT NULL CHECK(app.json_within(message,32768)),dedupe_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,page_id) REFERENCES public.pages(site_id,id),UNIQUE(site_id,dedupe_key)
);
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters OWNER TO cms_migration_owner;
ALTER TABLE public.chapter_versions OWNER TO cms_migration_owner;
ALTER TABLE public.contact_messages OWNER TO cms_migration_owner;
ALTER TABLE public.chapter_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chapters_visible ON public.chapters;
CREATE POLICY chapters_visible ON public.chapters FOR SELECT TO cms_authenticated_user USING(app.site_role(site_id)='site_admin');
DROP POLICY IF EXISTS chapter_versions_visible ON public.chapter_versions;
CREATE POLICY chapter_versions_visible ON public.chapter_versions FOR SELECT TO cms_authenticated_user USING(app.site_role(site_id)='site_admin');
DROP POLICY IF EXISTS contact_messages_visible ON public.contact_messages;
CREATE POLICY contact_messages_visible ON public.contact_messages FOR SELECT TO cms_authenticated_user USING(app.can_publish(site_id));
REVOKE ALL ON public.chapters,public.chapter_versions,public.contact_messages FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.chapters,public.chapter_versions,public.contact_messages TO cms_authenticated_user;
CREATE OR REPLACE FUNCTION app.chapter_config_defect(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE field text; contact jsonb; sections jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (value-ARRAY['name','destination','pageId','externalUrl','updateMode','contact','sections','boardDisplay'])<>'{}'::jsonb
 OR NOT(value?&ARRAY['name','destination','pageId','externalUrl','updateMode','contact','sections','boardDisplay']) THEN RETURN 'Chapter setup has unsupported or missing fields.';END IF;
 IF jsonb_typeof(value->'name') IS DISTINCT FROM 'string' OR length(btrim(value->>'name')) NOT BETWEEN 1 AND 160 THEN RETURN 'Add a chapter name.';END IF;
 IF value->>'destination' NOT IN('page','external','unlisted') OR jsonb_typeof(value->'destination') IS DISTINCT FROM 'string'
 OR value->>'updateMode' NOT IN('division','chapter-editors') OR jsonb_typeof(value->'updateMode') IS DISTINCT FROM 'string'
 OR value->>'boardDisplay' NOT IN('all','first-eight') OR jsonb_typeof(value->'boardDisplay') IS DISTINCT FROM 'string' THEN RETURN 'Choose supported chapter options.';END IF;
 IF value->'pageId'<>'null'::jsonb AND (jsonb_typeof(value->'pageId') IS DISTINCT FROM 'string' OR value->>'pageId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN RETURN 'Choose a chapter page.';END IF;
 IF value->'externalUrl'<>'null'::jsonb AND (jsonb_typeof(value->'externalUrl') IS DISTINCT FROM 'string' OR length(value->>'externalUrl')>2048 OR value->>'externalUrl' !~ '^https://[^/?#[:space:]@\\]+([/?#][^[:space:]\\]*)?$') THEN RETURN 'Use an https chapter website.';END IF;
 IF value->>'destination'='external' AND value->'externalUrl'='null'::jsonb THEN RETURN 'Add the chapter website address.';END IF;
 contact:=value->'contact';sections:=value->'sections';
 IF jsonb_typeof(contact) IS DISTINCT FROM 'object' OR contact-ARRAY['name','role','email']<>'{}'::jsonb OR NOT(contact?&ARRAY['name','role','email']) THEN RETURN 'Add one point of contact.';END IF;
 FOREACH field IN ARRAY ARRAY['name','role'] LOOP
 IF jsonb_typeof(contact->field) IS DISTINCT FROM 'string' OR length(btrim(contact->>field)) NOT BETWEEN 1 AND 120 THEN RETURN 'Add the contact name and role.';END IF;END LOOP;
 IF jsonb_typeof(contact->'email') IS DISTINCT FROM 'string' OR length(contact->>'email')>254 OR contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN 'Add a contact email address.';END IF;
 IF jsonb_typeof(sections) IS DISTINCT FROM 'object' OR sections-ARRAY['paragraph','social','socialFirst','events','board','photos','memberLogin']<>'{}'::jsonb OR NOT(sections?&ARRAY['paragraph','social','socialFirst','events','board','photos','memberLogin']) THEN RETURN 'Choose the chapter sections.';END IF;
 FOR field IN SELECT jsonb_object_keys(sections) LOOP IF jsonb_typeof(sections->field) IS DISTINCT FROM 'boolean' THEN RETURN 'Chapter sections must be on or off.';END IF;END LOOP;
 RETURN NULL;
END$$;
CREATE OR REPLACE FUNCTION app.save_chapter_setup(p_site uuid,p_chapter uuid,p_expected bigint,p_slug text,p_config jsonb)
RETURNS TABLE(chapter_id uuid,version_id uuid,revision bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapters%ROWTYPE;defect text;version uuid;next_revision bigint;
BEGIN
 actor:=app.require_actor();IF app.site_role(p_site) IS DISTINCT FROM 'site_admin'::site_role_name THEN RAISE EXCEPTION 'Only a site administrator can change chapter setup.' USING ERRCODE='CMS02';END IF;
 defect:=app.chapter_config_defect(p_config);IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 IF p_config->>'pageId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pages WHERE id=(p_config->>'pageId')::uuid AND site_id=p_site AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose a page on this site.' USING ERRCODE='CMS04';END IF;
 IF p_chapter IS NULL THEN
  IF p_expected IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'Stale chapter setup.' USING ERRCODE='CMS01';END IF;
  INSERT INTO public.chapters(site_id,slug) VALUES(p_site,p_slug) RETURNING * INTO head;
 ELSE
  SELECT * INTO head FROM public.chapters WHERE id=p_chapter AND site_id=p_site FOR UPDATE;
  IF head.id IS NULL THEN RAISE EXCEPTION 'No such chapter.' USING ERRCODE='CMS03';END IF;
  IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Stale chapter setup.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
  IF head.slug IS DISTINCT FROM p_slug THEN RAISE EXCEPTION 'The chapter address cannot change here.' USING ERRCODE='CMS04';END IF;
 END IF;
 next_revision:=head.revision+1;
 INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(p_site,head.id,next_revision,p_config,actor) RETURNING id INTO version;
 UPDATE public.chapters SET draft_version_id=version,revision=next_revision WHERE id=head.id;
 PERFORM app.write_audit(p_site,'user',actor,'chapter.save_setup','chapter',head.id,head.draft_version_id,version,'{}');
 RETURN QUERY SELECT head.id,version,next_revision;
END$$;
CREATE OR REPLACE FUNCTION app.publish_chapter_setup(p_chapter uuid,p_expected bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapters%ROWTYPE;
BEGIN
 actor:=app.require_actor();SELECT * INTO head FROM public.chapters WHERE id=p_chapter FOR UPDATE;
 IF head.id IS NULL THEN RAISE EXCEPTION 'No such chapter.' USING ERRCODE='CMS03';END IF;
 IF app.site_role(head.site_id) IS DISTINCT FROM 'site_admin'::site_role_name THEN RAISE EXCEPTION 'Only a site administrator can publish chapter setup.' USING ERRCODE='CMS02';END IF;
 IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Stale chapter setup.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 UPDATE public.chapters SET published_version_id=draft_version_id,revision=revision+1 WHERE id=head.id;
 PERFORM app.write_audit(head.site_id,'user',actor,'chapter.publish_setup','chapter',head.id,head.published_version_id,head.draft_version_id,'{}');
 PERFORM app.emit_outbox(head.site_id,'page.published',jsonb_build_object('site_id',head.site_id,'paths',(SELECT COALESCE(jsonb_agg(path),'[]'::jsonb) FROM public.published_routes WHERE site_id=head.site_id),'revision',head.revision+1));
 RETURN head.revision+1;
END$$;
CREATE OR REPLACE FUNCTION app.chapter_directory_for_site(p_site uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('name',v.config->>'name','path',CASE WHEN v.config->>'destination'='page' THEN r.path END,'externalUrl',CASE WHEN v.config->>'destination'='external' THEN v.config->>'externalUrl' END) ORDER BY lower(v.config->>'name'),c.id),'[]'::jsonb)
 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.published_version_id
 LEFT JOIN public.published_routes r ON r.site_id=c.site_id AND r.page_id=(v.config->>'pageId')::uuid
 WHERE c.site_id=p_site AND (v.config->>'destination'='external' OR (v.config->>'destination'='page' AND r.page_id IS NOT NULL))
$$;
CREATE OR REPLACE FUNCTION public_api.chapter_directory(p_host text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE((SELECT app.chapter_directory_for_site(h.site_id) FROM public_api.resolve_host(p_host) h),'[]'::jsonb)
$$;
CREATE OR REPLACE FUNCTION app.preview_chapter_directory(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN IF NOT app.has_site_access(p_site) THEN RAISE EXCEPTION 'No access to this site.' USING ERRCODE='CMS02';END IF;RETURN app.chapter_directory_for_site(p_site);END$$;
CREATE OR REPLACE FUNCTION public_api.submit_contact(p_host text,p_path text,p_message jsonb,p_dedupe text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE route record;field text;message_limit integer;
BEGIN
 SELECT * INTO route FROM public_api.resolve_route(p_host,p_path);
 IF route.page_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(route.render_manifest->'sections') s,jsonb_array_elements(s#>'{def,slots}') slot WHERE slot#>>'{constraints,siteWidget}'='contact-form') THEN RAISE EXCEPTION 'This form is not available.' USING ERRCODE='CMS03';END IF;
 IF jsonb_typeof(p_message) IS DISTINCT FROM 'object' OR p_message-ARRAY['first_name','last_name','email','phone','comments']<>'{}'::jsonb OR NOT(p_message?&ARRAY['first_name','last_name','email','phone','comments']) THEN RAISE EXCEPTION 'Complete the required fields.' USING ERRCODE='CMS04';END IF;
 FOREACH field IN ARRAY ARRAY['first_name','last_name','email','phone','comments'] LOOP
  message_limit:=CASE field WHEN 'comments' THEN 5000 WHEN 'email' THEN 254 WHEN 'phone' THEN 60 ELSE 80 END;
  IF jsonb_typeof(p_message->field) IS DISTINCT FROM 'string' OR length(btrim(p_message->>field)) NOT BETWEEN 1 AND message_limit THEN RAISE EXCEPTION 'Complete the required fields.' USING ERRCODE='CMS04';END IF;
 END LOOP;
 IF p_message->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR p_dedupe !~ '^[a-f0-9]{64}$' OR p_dedupe IS NULL THEN RAISE EXCEPTION 'Check the message details.' USING ERRCODE='CMS04';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('contact:'||route.site_id::text,8));
 IF EXISTS(SELECT 1 FROM public.contact_messages WHERE site_id=route.site_id AND dedupe_key=p_dedupe) THEN RETURN;END IF;
 IF (SELECT count(*) FROM public.contact_messages WHERE site_id=route.site_id AND created_at>now()-interval '1 hour')>=50 THEN RAISE EXCEPTION 'Please try again later.' USING ERRCODE='CMS04';END IF;
 INSERT INTO public.contact_messages(site_id,page_id,message,dedupe_key) VALUES(route.site_id,route.page_id,p_message,p_dedupe) ON CONFLICT(site_id,dedupe_key) DO NOTHING;
END$$;
REVOKE ALL ON FUNCTION app.chapter_config_defect(jsonb),app.save_chapter_setup(uuid,uuid,bigint,text,jsonb),app.publish_chapter_setup(uuid,bigint),app.chapter_directory_for_site(uuid),app.preview_chapter_directory(uuid),public_api.chapter_directory(text),public_api.submit_contact(text,text,jsonb,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
ALTER FUNCTION app.chapter_config_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_chapter_setup(uuid,uuid,bigint,text,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_chapter_setup(uuid,bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.chapter_directory_for_site(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.preview_chapter_directory(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.chapter_directory(text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.submit_contact(text,text,jsonb,text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.save_chapter_setup(uuid,uuid,bigint,text,jsonb),app.publish_chapter_setup(uuid,bigint),app.preview_chapter_directory(uuid) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION public_api.chapter_directory(text),public_api.submit_contact(text,text,jsonb,text) TO cms_public_renderer;
