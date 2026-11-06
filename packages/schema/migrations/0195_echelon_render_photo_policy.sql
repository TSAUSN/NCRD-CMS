-- Project the fixed chapter-template photo policy. No backfill and no new callers.
ALTER FUNCTION app.rebuild_site_shell(uuid) RENAME TO rebuild_site_shell_before_echelon_photo_policy;
CREATE FUNCTION app.rebuild_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE revision bigint;
BEGIN
 revision:=app.rebuild_site_shell_before_echelon_photo_policy(p_site_id);
 IF EXISTS(SELECT 1 FROM public.sites WHERE id=p_site_id AND chapters_enabled) THEN
  UPDATE public.published_site_shells SET payload=jsonb_set(payload,'{site,chaptersEnabled}','true'::jsonb,true) WHERE site_id=p_site_id;
 END IF;
 RETURN revision;
END$$;
ALTER FUNCTION app.rebuild_site_shell(uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.rebuild_site_shell(uuid),app.rebuild_site_shell_before_echelon_photo_policy(uuid) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

-- Keep the national section map enforced on every saved version, including direct commands.
CREATE FUNCTION app.guard_echelon_national_sections() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous jsonb; section jsonb; definition record;
BEGIN
 SELECT v.content INTO previous FROM public.pages p LEFT JOIN public.page_versions v ON v.id=p.draft_version_id WHERE p.id=NEW.page_id AND p.site_id=NEW.site_id;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.content,'[]'::jsonb)||COALESCE(previous,'[]'::jsonb)) i WHERE i#>>'{values,__cms_echelon_template}'='national') THEN RETURN NEW;END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(NEW.content) LOOP
  SELECT d.slug,v.slots,d.category INTO definition FROM public.section_defs d JOIN public.section_def_versions v ON v.section_def_id=d.id WHERE d.id::text=section->>'section_def_id' AND v.version=(section->>'section_def_version')::integer;
  IF definition.slug IN('core-echelon-events','core-schedule') OR lower(definition.category)='events' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(definition.slots,'[]'::jsonb)) f WHERE f#>>'{constraints,echelonAudience}'='chapter') THEN
   RAISE EXCEPTION 'Chapter events and chapter-only sections are not available on the national page.' USING ERRCODE='CMS04';
  END IF;
  IF NULLIF(btrim(section->>'raw_html'),'') IS NOT NULL OR NULLIF(btrim(section->>'custom_css'),'') IS NOT NULL THEN
   RAISE EXCEPTION 'This national page uses shared sections. Change the template instead.' USING ERRCODE='CMS04';
  END IF;
 END LOOP;
 RETURN NEW;
END$$;
ALTER FUNCTION app.guard_echelon_national_sections() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.guard_echelon_national_sections() FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
CREATE TRIGGER page_versions_guard_echelon_national BEFORE INSERT ON public.page_versions FOR EACH ROW EXECUTE FUNCTION app.guard_echelon_national_sections();
