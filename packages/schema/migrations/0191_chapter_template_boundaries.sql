-- Extend the existing contributor locks; retain every existing page predicate and grant.
ALTER TABLE public.chapter_shared_sections DROP CONSTRAINT chapter_shared_sections_part_check;
ALTER TABLE public.chapter_shared_sections ADD CONSTRAINT chapter_shared_sections_part_check CHECK(part IN('what','join','about','faq'));
CREATE OR REPLACE FUNCTION app.capture_chapter_shared_sections() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT app.can_publish_page(NEW.page_id) THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=NEW.site_id AND v.config->>'pageId'=NEW.page_id::text) THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}' IN('what','join','about','faq') GROUP BY section#>>'{values,__cms_chapter_part}' HAVING count(*)>1) THEN RAISE EXCEPTION 'Keep one copy of each shared section on a chapter page.' USING ERRCODE='CMS04';END IF;
 DELETE FROM public.chapter_shared_sections locked WHERE locked.page_id=NEW.page_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.content) section WHERE section#>>'{values,__cms_chapter_part}'=locked.part);
 INSERT INTO public.chapter_shared_sections(page_id,part,position,instance) SELECT NEW.page_id,value#>>'{values,__cms_chapter_part}',ordinality-1,value FROM jsonb_array_elements(NEW.content) WITH ORDINALITY WHERE value#>>'{values,__cms_chapter_part}' IN('what','join','about','faq') ON CONFLICT(page_id,part) DO UPDATE SET position=excluded.position,instance=excluded.instance;
 RETURN NEW;
END$$;

CREATE FUNCTION app.is_chapter_page(p_page uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT COALESCE(app.has_page_access(p_page),false) AND EXISTS(SELECT 1 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE v.config->>'pageId'=p_page::text)
$$;
CREATE FUNCTION app.guard_chapter_section_availability() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE chapter boolean;composed boolean;previous jsonb;section jsonb;definition record;
BEGIN
 SELECT v.content INTO previous FROM public.pages p LEFT JOIN public.page_versions v ON v.id=p.draft_version_id WHERE p.id=NEW.page_id AND p.site_id=NEW.site_id;
 composed:=EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.content,'[]'::jsonb)||COALESCE(previous,'[]'::jsonb)) i WHERE i#>>'{values,__cms_echelon_template}'='chapter');
 chapter:=composed OR EXISTS(SELECT 1 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=NEW.site_id AND v.config->>'pageId'=NEW.page_id::text);
 IF NOT chapter THEN RETURN NEW;END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
  SELECT d.slug,v.slots INTO definition FROM public.section_defs d JOIN public.section_def_versions v ON v.section_def_id=d.id WHERE d.id::text=section->>'section_def_id' AND v.version=(section->>'section_def_version')::integer;
  IF definition.slug IN('core-stories','core-newsroom','core-story-world','core-story-split','core-story-detail','core-echelon-directory','core-echelon-leadership','core-chapter-directory','core-chapter-search')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(definition.slots,'[]'::jsonb)) f WHERE f#>>'{constraints,echelonAudience}'='national' OR f#>'{constraints,storyFeed}'='true'::jsonb OR f#>>'{constraints,coreList}'='stories' OR f#>>'{constraints,siteWidget}' IN('chapter-directory','chapter-search'))
    OR EXISTS(WITH RECURSIVE nodes(value) AS(SELECT COALESCE(section->'values','{}'::jsonb) UNION ALL SELECT child.value FROM nodes CROSS JOIN LATERAL(SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(nodes.value)='array' THEN nodes.value ELSE '[]'::jsonb END) UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(nodes.value)='object' THEN nodes.value ELSE '{}'::jsonb END)) child) SELECT 1 FROM nodes WHERE jsonb_typeof(value)='object' AND value->>'readerKey'='stories') THEN
   RAISE EXCEPTION 'Stories and national-only sections are not available on chapter pages.' USING ERRCODE='CMS04';
  END IF;
  IF composed AND (NULLIF(btrim(section->>'raw_html'),'') IS NOT NULL OR NULLIF(btrim(section->>'custom_css'),'') IS NOT NULL) THEN
   RAISE EXCEPTION 'This chapter uses shared sections. Change the template instead.' USING ERRCODE='CMS04';
  END IF;
 END LOOP;
 RETURN NEW;
END$$;
ALTER FUNCTION app.is_chapter_page(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.guard_chapter_section_availability() OWNER TO cms_migration_owner;
ALTER FUNCTION app.capture_chapter_shared_sections() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.is_chapter_page(uuid),app.guard_chapter_section_availability() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.is_chapter_page(uuid) TO cms_authenticated_user;
CREATE TRIGGER page_versions_guard_chapter_availability BEFORE INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.guard_chapter_section_availability();
