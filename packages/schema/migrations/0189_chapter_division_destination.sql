-- Distinct division-hosted chapter destinations; existing grants, ownership and RLS remain.
-- No chapter heads, pages, contacts or published versions are rewritten.
CREATE OR REPLACE FUNCTION app.chapter_config_defect(value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE field text; contact jsonb; sections jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR (value-ARRAY['name','destination','pageId','externalUrl','updateMode','contact','sections','boardDisplay'])<>'{}'::jsonb
 OR NOT(value?&ARRAY['name','destination','pageId','externalUrl','updateMode','contact','sections','boardDisplay']) THEN RETURN 'Chapter setup has unsupported or missing fields.';END IF;
 IF jsonb_typeof(value->'name') IS DISTINCT FROM 'string' OR length(btrim(value->>'name')) NOT BETWEEN 1 AND 160 THEN RETURN 'Add a chapter name.';END IF;
 IF value->>'destination' NOT IN('page','division','external','unlisted') OR jsonb_typeof(value->'destination') IS DISTINCT FROM 'string'
 OR value->>'updateMode' NOT IN('division','chapter-editors') OR jsonb_typeof(value->'updateMode') IS DISTINCT FROM 'string'
 OR value->>'boardDisplay' NOT IN('all','first-eight') OR jsonb_typeof(value->'boardDisplay') IS DISTINCT FROM 'string' THEN RETURN 'Choose supported chapter options.';END IF;
 IF value->'pageId'<>'null'::jsonb AND (jsonb_typeof(value->'pageId') IS DISTINCT FROM 'string' OR value->>'pageId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN RETURN 'Choose a chapter page.';END IF;
 IF value->'externalUrl'<>'null'::jsonb AND (jsonb_typeof(value->'externalUrl') IS DISTINCT FROM 'string' OR length(value->>'externalUrl')>2048 OR value->>'externalUrl' !~ '^https://[^/?#[:space:]@\\]+([/?#][^[:space:]\\]*)?$') THEN RETURN 'Use an https chapter website.';END IF;
 IF value->>'destination'='division' AND value->'externalUrl'='null'::jsonb THEN RETURN 'Add the division page address.';END IF;
 IF value->>'destination'='external' AND value->'externalUrl'='null'::jsonb THEN RETURN 'Add the chapter website address.';END IF;
 contact:=value->'contact';sections:=value->'sections';
 IF jsonb_typeof(contact) IS DISTINCT FROM 'object' OR contact-ARRAY['name','role','email']<>'{}'::jsonb OR NOT(contact?&ARRAY['name','role','email']) THEN RETURN 'Add one point of contact.';END IF;
 FOREACH field IN ARRAY ARRAY['name','role'] LOOP
 IF jsonb_typeof(contact->field) IS DISTINCT FROM 'string' OR length(btrim(contact->>field)) NOT BETWEEN 1 AND 120 THEN RETURN 'Add the contact name and role.';END IF;END LOOP;
 IF jsonb_typeof(contact->'email') IS DISTINCT FROM 'string' OR length(contact->>'email')>254 OR contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN 'Add a contact email address.';END IF;
 IF jsonb_typeof(sections) IS DISTINCT FROM 'object' OR sections-ARRAY['paragraph','social','socialFirst','events','board','photos','memberLogin']<>'{}'::jsonb OR NOT(sections?&ARRAY['paragraph','social','socialFirst','events','board','photos','memberLogin']) THEN RETURN 'Choose the chapter sections.';END IF;
 FOR field IN SELECT jsonb_object_keys(sections) LOOP IF jsonb_typeof(sections->field) IS DISTINCT FROM 'boolean' THEN RETURN 'Chapter sections must be on or off.';END IF;END LOOP;
 RETURN NULL;
END$function$;

CREATE OR REPLACE FUNCTION app.chapter_directory_for_site(p_site uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('name',v.config->>'name','path',CASE WHEN v.config->>'destination'='page' THEN r.path END,'externalUrl',CASE WHEN v.config->>'destination' IN('external','division') THEN v.config->>'externalUrl' END)||CASE WHEN v.config->>'destination'='division' THEN jsonb_build_object('destination','division') ELSE '{}'::jsonb END ORDER BY lower(v.config->>'name'),c.id),'[]'::jsonb)
 FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.published_version_id
 LEFT JOIN public.published_routes r ON r.site_id=c.site_id AND r.page_id=(v.config->>'pageId')::uuid
 WHERE c.site_id=p_site AND (v.config->>'destination' IN('external','division') OR (v.config->>'destination'='page' AND r.page_id IS NOT NULL))
$function$;

CREATE OR REPLACE FUNCTION app.create_division_chapter(p_division uuid, p_slug text, p_config jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
 IF config->>'destination' NOT IN('external','division') THEN
  INSERT INTO public.pages(site_id,slug,title) VALUES(site,'chapters/'||p_slug,config->>'name') RETURNING id INTO page;
  config:=jsonb_set(config,'{pageId}',to_jsonb(page));
  PERFORM app.write_audit(site,'user',actor,'page.create','page',page,NULL,NULL,jsonb_build_object('slug','chapters/'||p_slug));
 END IF;
 INSERT INTO public.chapters(site_id,slug) VALUES(site,p_slug) RETURNING id INTO chapter;
 INSERT INTO public.chapter_division_assignments VALUES(chapter,p_division);
 INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(site,chapter,1,config,actor) RETURNING id INTO version;
 UPDATE public.chapters SET revision=1,draft_version_id=version WHERE id=chapter;
 PERFORM app.write_audit(site,'user',actor,'chapter.create','chapter',chapter,NULL,version,jsonb_build_object('division',p_division));RETURN chapter;
END$function$;

CREATE OR REPLACE FUNCTION app.create_chapter_page(p_chapter uuid, p_expected bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE actor uuid;head public.chapters%ROWTYPE;config jsonb;page uuid;version uuid;
BEGIN
 actor:=app.require_actor();PERFORM app.lock_chapter_setup(p_chapter);
 SELECT * INTO head FROM public.chapters WHERE id=p_chapter;
 IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'This chapter changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND archived_at IS NULL AND chapters_enabled) THEN RAISE EXCEPTION 'Choose an active chapter site.' USING ERRCODE='CMS04';END IF;
 SELECT v.config INTO config FROM public.chapter_versions v WHERE v.id=head.draft_version_id;
 IF config->>'destination'='division' THEN RAISE EXCEPTION 'This chapter uses its division’s page. No chapter page is edited here.' USING ERRCODE='CMS04';END IF;
 IF config->>'pageId' IS NOT NULL THEN RETURN (config->>'pageId')::uuid;END IF;
 INSERT INTO public.pages(site_id,slug,title) VALUES(head.site_id,'chapters/'||head.slug,config->>'name') RETURNING id INTO page;
 config:=jsonb_set(config,'{pageId}',to_jsonb(page));
 INSERT INTO public.chapter_versions(site_id,chapter_id,revision,config,author_id) VALUES(head.site_id,head.id,head.revision+1,config,actor) RETURNING id INTO version;
 UPDATE public.chapters SET revision=head.revision+1,draft_version_id=version WHERE id=head.id;
 PERFORM app.write_audit(head.site_id,'user',actor,'page.create','page',page,NULL,NULL,jsonb_build_object('slug','chapters/'||head.slug));
 PERFORM app.write_audit(head.site_id,'user',actor,'chapter.save_setup','chapter',head.id,head.draft_version_id,version,'{}');RETURN page;
END$function$;

CREATE OR REPLACE FUNCTION app.record_chapter_checks_internal(p_site uuid, p_cycle date, p_origin text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE contact record;chapter record;body text;month_name text;deadline text;division text;count integer:=0;added integer;ids uuid[];
BEGIN
 IF p_cycle IS NULL OR extract(month FROM p_cycle) NOT IN(1,7) OR extract(day FROM p_cycle)<>1 OR extract(year FROM p_cycle) NOT BETWEEN 2020 AND 2200 OR p_origin IS NULL OR p_origin!~'^http://(localhost|127\.0\.0\.1)(:[0-9]{2,5})?$' THEN RAISE EXCEPTION 'Choose January or July and the local CMS address.' USING ERRCODE='CMS04';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites s LEFT JOIN public.chapter_site_settings settings ON settings.site_id=s.id WHERE s.id=p_site AND s.chapters_enabled AND s.archived_at IS NULL AND COALESCE(settings.checks_enabled,true)) THEN RETURN 0;END IF;
 month_name:=CASE WHEN extract(month FROM p_cycle)=1 THEN 'January' ELSE 'July' END;deadline:=month_name||' 31';
 FOR contact IN SELECT lower(btrim(v.config#>>'{contact,email}')) AS email FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id WHERE c.site_id=p_site GROUP BY lower(btrim(v.config#>>'{contact,email}')) LOOP
  body:='';ids:=ARRAY[]::uuid[];
  FOR chapter IN SELECT c.id,v.config,d.name AS division_name FROM public.chapters c JOIN public.chapter_versions v ON v.id=c.draft_version_id LEFT JOIN public.chapter_division_assignments a ON a.chapter_id=c.id LEFT JOIN public.chapter_divisions d ON d.id=a.division_id WHERE c.site_id=p_site AND lower(btrim(v.config#>>'{contact,email}'))=contact.email ORDER BY lower(v.config->>'name'),c.id LOOP
   ids:=array_append(ids,chapter.id);IF body<>'' THEN body:=body||E'\n\n';END IF;
   body:=body||(chapter.config->>'name')||E'\n\nHi '||(chapter.config#>>'{contact,name}')||', it’s '||month_name;
   IF chapter.config->>'destination'='division' THEN
    body:=body||'. Please check that your division’s page address still works and the chapter information is current by '||deadline||'. Send any changes to the division web team. Nothing to change? Just reply “all good”.'||E'\n\nDivision page: '||(chapter.config->>'externalUrl');
   ELSIF chapter.config->>'updateMode'='chapter-editors' THEN
    body:=body||', so please take a few minutes to check your chapter page: contact, board, this year’s events, photos and social links. Done by '||deadline||'? Thank you!';
    IF chapter.config->>'pageId' IS NOT NULL THEN body:=body||E'\n\nCheck my page: '||p_origin||'/pages/'||(chapter.config->>'pageId');END IF;
   ELSE
    division:=COALESCE(chapter.division_name,'[Division]');
    body:=body||'. Please look over your chapter page and send any changes (board, this year’s events, photos, contact or social links) in one email to the '||division||' web team by '||deadline||'. Nothing to change? Just reply “all good”.';
   END IF;
  END LOOP;
  INSERT INTO public.local_chapter_outbox(site_id,chapter_id,related_chapters,kind,recipient,subject,body,dedupe_key) VALUES(p_site,ids[1],ids,'check',contact.email,month_name||' chapter page check',body,'check:'||p_site||':'||to_char(p_cycle,'YYYY-MM')||':'||encode(sha256(convert_to(contact.email,'UTF8')),'hex')) ON CONFLICT(dedupe_key) DO NOTHING;
  GET DIAGNOSTICS added=ROW_COUNT;count:=count+added;
 END LOOP;
 IF count>0 THEN PERFORM app.write_audit(p_site,'system',NULL,'chapter.checks.recorded','site',p_site,NULL,NULL,jsonb_build_object('cycle',p_cycle,'count',count));END IF;RETURN count;
END$function$;

