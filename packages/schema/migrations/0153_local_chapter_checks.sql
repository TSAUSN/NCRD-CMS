-- Recording only: none of these messages enter the delivery worker's outbox.
ALTER TABLE public.chapter_site_settings ADD COLUMN IF NOT EXISTS checks_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.chapter_site_settings ADD COLUMN IF NOT EXISTS review_reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.local_chapter_outbox ADD COLUMN IF NOT EXISTS related_chapters uuid[];
CREATE OR REPLACE FUNCTION app.can_view_local_chapter_mail(p_chapter uuid,p_related uuid[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT app.can_manage_chapter(p_chapter) AND NOT EXISTS(SELECT 1 FROM unnest(COALESCE(p_related,ARRAY[p_chapter])) chapter WHERE NOT app.can_manage_chapter(chapter))
$$;
DROP POLICY IF EXISTS local_chapter_outbox_visible ON public.local_chapter_outbox;
CREATE POLICY local_chapter_outbox_visible ON public.local_chapter_outbox FOR SELECT TO cms_authenticated_user USING(app.can_view_local_chapter_mail(chapter_id,related_chapters));
CREATE OR REPLACE FUNCTION app.save_chapter_check_settings(p_site uuid,p_expected bigint,p_checks boolean,p_reminders boolean) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;head public.chapter_site_settings%ROWTYPE;
BEGIN
 actor:=app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator manages chapter checks.' USING ERRCODE='CMS02';END IF;
 PERFORM 1 FROM public.sites WHERE id=p_site AND archived_at IS NULL AND chapters_enabled FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active chapter site.' USING ERRCODE='CMS04';END IF;
 IF p_checks IS NULL OR p_reminders IS NULL THEN RAISE EXCEPTION 'Choose the checks and reminder options.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO head FROM public.chapter_site_settings WHERE site_id=p_site FOR UPDATE;
 IF COALESCE(head.revision,0) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'These settings changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
 INSERT INTO public.chapter_site_settings(site_id,revision,checks_enabled,review_reminders_enabled) VALUES(p_site,COALESCE(head.revision,0)+1,p_checks,p_reminders)
 ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,checks_enabled=excluded.checks_enabled,review_reminders_enabled=excluded.review_reminders_enabled;
 PERFORM app.write_audit(p_site,'user',actor,'chapter.check_settings.save','site',p_site,NULL,NULL,jsonb_build_object('checks',p_checks,'reminders',p_reminders));RETURN COALESCE(head.revision,0)+1;
END$$;
CREATE OR REPLACE FUNCTION app.chapter_review_due_at(p_created timestamptz) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE local_time timestamp;working_days integer:=0;
BEGIN
 IF p_created IS NULL THEN RETURN NULL;END IF;
 local_time:=p_created AT TIME ZONE 'America/New_York';
 WHILE working_days<5 LOOP local_time:=local_time+interval '1 day';IF extract(isodow FROM local_time)<6 THEN working_days:=working_days+1;END IF;END LOOP;
 RETURN local_time AT TIME ZONE 'America/New_York';
END$$;
CREATE OR REPLACE FUNCTION app.record_chapter_checks_internal(p_site uuid,p_cycle date,p_origin text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
   IF chapter.config->>'updateMode'='chapter-editors' THEN
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
END$$;
CREATE OR REPLACE FUNCTION app.record_chapter_reviews_internal(p_site uuid,p_now timestamptz) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE submission record;person record;remind boolean;kind text;body text;count integer:=0;added integer;
BEGIN
 FOR submission IN SELECT sub.id,sub.item_id,sub.created_at,c.id AS chapter_id,c.site_id,p.title,a.division_id,COALESCE(settings.review_reminders_enabled,true) AS reminders
 FROM public.submissions sub JOIN public.pages p ON sub.item_type='page' AND p.id=sub.item_id AND p.draft_version_id=sub.version_id JOIN public.chapters c ON c.site_id=p.site_id JOIN public.chapter_versions v ON v.id=c.draft_version_id AND v.config->>'pageId'=p.id::text JOIN public.sites s ON s.id=c.site_id LEFT JOIN public.chapter_division_assignments a ON a.chapter_id=c.id LEFT JOIN public.chapter_site_settings settings ON settings.site_id=s.id
 WHERE c.site_id=p_site AND sub.status='open' AND p.archived_at IS NULL AND s.archived_at IS NULL AND s.chapters_enabled LOOP
  remind:=submission.reminders AND p_now>=app.chapter_review_due_at(submission.created_at);
  FOR person IN SELECT u.id,u.email FROM public.app_users u WHERE u.status='active' AND app.can_publish_page_as(u.id,submission.item_id) AND (
   EXISTS(SELECT 1 FROM public.chapter_division_memberships m WHERE m.division_id=submission.division_id AND m.user_id=u.id)
   OR app.site_role_of(u.id,p_site)='site_admin' AND (remind OR NOT EXISTS(SELECT 1 FROM public.chapter_division_memberships m JOIN public.app_users staff ON staff.id=m.user_id AND staff.status='active' WHERE m.division_id=submission.division_id))) LOOP
   kind:=CASE WHEN remind THEN 'reminder' ELSE 'review' END;
   body:=CASE WHEN remind THEN 'This chapter page has been waiting for approval for five working days. The division web team and the national team can review it. Nothing is published automatically.' ELSE 'A chapter editor has sent this page for approval. Review the submitted page in Inbox before approving it.' END;
   body:=submission.title||E'\n\n'||body;
   INSERT INTO public.local_chapter_outbox(site_id,chapter_id,kind,recipient,subject,body,dedupe_key) VALUES(p_site,submission.chapter_id,kind,person.email,CASE WHEN remind THEN 'Chapter approval reminder' ELSE 'Chapter ready for approval' END,body,kind||':'||submission.id||':'||person.id) ON CONFLICT(dedupe_key) DO NOTHING;
   GET DIAGNOSTICS added=ROW_COUNT;count:=count+added;
  END LOOP;
 END LOOP;RETURN count;
END$$;
CREATE OR REPLACE FUNCTION app.record_chapter_check(p_site uuid,p_cycle date,p_origin text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator records chapter checks.' USING ERRCODE='CMS02';END IF;
 RETURN app.record_chapter_checks_internal(p_site,p_cycle,p_origin);
END$$;
CREATE OR REPLACE FUNCTION app.record_chapter_review_mail(p_site uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM app.require_actor();IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'A site administrator records review reminders.' USING ERRCODE='CMS02';END IF;
 RETURN app.record_chapter_reviews_internal(p_site,now());
END$$;
CREATE OR REPLACE FUNCTION app.record_due_local_chapter_mail(p_origin text,p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE site record;count integer:=0;cycle date;
BEGIN
 PERFORM app.require_worker();
 IF p_origin IS NULL OR p_origin!~'^http://(localhost|127\.0\.0\.1)(:[0-9]{2,5})?$' OR p_now IS NULL THEN RAISE EXCEPTION 'Use the local CMS address.' USING ERRCODE='CMS04';END IF;
 cycle:=date_trunc('month',p_now AT TIME ZONE 'America/New_York')::date;
 FOR site IN SELECT id FROM public.sites WHERE chapters_enabled AND archived_at IS NULL LOOP
  IF extract(month FROM cycle) IN(1,7) THEN count:=count+app.record_chapter_checks_internal(site.id,cycle,p_origin);END IF;
  count:=count+app.record_chapter_reviews_internal(site.id,p_now);
 END LOOP;RETURN count;
END$$;
CREATE OR REPLACE FUNCTION app.local_chapter_mail_feed(p_site uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM app.require_actor();
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',mail.id,'kind',mail.kind,'recipient',mail.recipient,'subject',mail.subject,'body',mail.body,'link',CASE WHEN mail.kind='sign-in' AND token.used_at IS NULL AND token.expires_at>now() THEN mail.link END,'createdAt',mail.created_at,'expired',mail.kind='sign-in' AND (token.used_at IS NOT NULL OR token.expires_at<=now())) ORDER BY mail.created_at DESC,mail.id),'[]'::jsonb) INTO result
 FROM (SELECT * FROM public.local_chapter_outbox o WHERE o.site_id=p_site AND app.can_view_local_chapter_mail(o.chapter_id,o.related_chapters) ORDER BY o.created_at DESC,o.id LIMIT 100) mail
 LEFT JOIN public.local_chapter_sign_in_links token ON mail.kind='sign-in' AND token.digest=split_part(mail.dedupe_key,':',2);
 RETURN result;
END$$;
DO $$DECLARE target regprocedure;BEGIN
 FOREACH target IN ARRAY ARRAY['app.can_view_local_chapter_mail(uuid,uuid[])'::regprocedure,'app.save_chapter_check_settings(uuid,bigint,boolean,boolean)'::regprocedure,'app.chapter_review_due_at(timestamptz)'::regprocedure,'app.record_chapter_checks_internal(uuid,date,text)'::regprocedure,'app.record_chapter_reviews_internal(uuid,timestamptz)'::regprocedure,'app.record_chapter_check(uuid,date,text)'::regprocedure,'app.record_chapter_review_mail(uuid)'::regprocedure,'app.record_due_local_chapter_mail(text,timestamptz)'::regprocedure] LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',target);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker',target);
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION app.can_view_local_chapter_mail(uuid,uuid[]),app.save_chapter_check_settings(uuid,bigint,boolean,boolean),app.record_chapter_check(uuid,date,text),app.record_chapter_review_mail(uuid) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.record_due_local_chapter_mail(text,timestamptz) TO cms_worker;
