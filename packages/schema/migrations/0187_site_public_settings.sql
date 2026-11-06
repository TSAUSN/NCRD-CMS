-- Site-wide authored settings use the existing immutable versions and release path.
-- No backfill: frozen sites and sites that have not adopted settings keep their output.
CREATE FUNCTION app.site_public_settings_defect(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE block jsonb;row jsonb;k text;v jsonb;seen text[]:='{}';
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>16384 THEN RETURN 'Check the site settings.';END IF;
 IF p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(p->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p->>'name')) NOT BETWEEN 1 AND 120 THEN RETURN 'Enter a site name of up to 120 characters.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) key WHERE key NOT IN ('schemaVersion','name','general','search','social')) THEN RETURN 'These site settings contain an unsupported field.';END IF;
 IF p ? 'general' THEN
  block:=p->'general';IF jsonb_typeof(block) IS DISTINCT FROM 'object' THEN RETURN 'Check General settings.';END IF;
  IF NOT block ?& ARRAY['description','country','language','email','phone','address'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(block) key WHERE key NOT IN ('description','country','language','email','phone','address')) THEN RETURN 'Check General settings.';END IF;
  FOR k,v IN SELECT * FROM jsonb_each(block) LOOP
   IF jsonb_typeof(v)<>'string' OR char_length(v #>> '{}')>(CASE k WHEN 'description' THEN 155 WHEN 'country' THEN 100 WHEN 'language' THEN 35 WHEN 'email' THEN 254 WHEN 'phone' THEN 80 ELSE 1000 END) THEN RETURN 'A General settings field is too long or invalid.';END IF;
  END LOOP;
  IF block->>'language' !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$' OR (block->>'email'<>'' AND block->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RETURN 'Check the language and contact email.';END IF;
 END IF;
 IF p ? 'search' THEN
  block:=p->'search';IF jsonb_typeof(block) IS DISTINCT FROM 'object' OR NOT block ?& ARRAY['verification','hints'] THEN RETURN 'Check Search & sharing.';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(block) key WHERE key NOT IN ('verification','hints')) OR jsonb_typeof(block->'hints') IS DISTINCT FROM 'string' OR char_length(block->>'hints')>500 OR jsonb_typeof(block->'verification') IS DISTINCT FROM 'array' THEN RETURN 'Check Search & sharing.';END IF;
  IF jsonb_array_length(block->'verification')>4 THEN RETURN 'Use each verification service once.';END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(block->'verification') LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR NOT row ?& ARRAY['name','content'] THEN RETURN 'Use a supported verification tag.';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) key WHERE key NOT IN ('name','content')) OR jsonb_typeof(row->'name') IS DISTINCT FROM 'string' OR jsonb_typeof(row->'content') IS DISTINCT FROM 'string' OR row->>'name' NOT IN ('google-site-verification','msvalidate.01','yandex-verification','p:domain_verify') OR char_length(row->>'content') NOT BETWEEN 1 AND 512 OR row->>'content' !~ '^[A-Za-z0-9+_:.=/~\-]+$' OR row->>'name'=ANY(seen) THEN RETURN 'Use a supported verification tag once per service.';END IF;
   seen:=array_append(seen,row->>'name');
  END LOOP;
 END IF;
 IF p ? 'social' THEN
  IF jsonb_typeof(p->'social') IS DISTINCT FROM 'array' THEN RETURN 'Check the social accounts.';END IF;
  IF jsonb_array_length(p->'social')>6 THEN RETURN 'Use each social account once.';END IF;seen:='{}';
  FOR row IN SELECT value FROM jsonb_array_elements(p->'social') LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR NOT row ?& ARRAY['service','url','handle','inFooter'] THEN RETURN 'Check the social account fields.';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(row) key WHERE key NOT IN ('service','url','handle','inFooter')) OR jsonb_typeof(row->'service') IS DISTINCT FROM 'string' OR jsonb_typeof(row->'url') IS DISTINCT FROM 'string' OR jsonb_typeof(row->'handle') IS DISTINCT FROM 'string' OR jsonb_typeof(row->'inFooter') IS DISTINCT FROM 'boolean' THEN RETURN 'Check the social account fields.';END IF;
   IF row->>'service' NOT IN ('facebook','instagram','x','linkedin','youtube','tiktok') OR row->>'service'=ANY(seen) THEN RETURN 'Use each social account once.';END IF;
   IF char_length(row->>'url')>2048 OR char_length(row->>'handle')>100 OR (row->>'handle'<>'' AND row->>'handle' !~ '^@?[[:alnum:]_.-]+$') OR (row->>'url'='' AND (row->>'handle'<>'' OR (row->>'inFooter')::boolean)) OR (row->>'url'<>'' AND row->>'url' !~ '^https://[^/?#@:\\[:space:]]+(:[0-9]+)?([/?#][^\\[:space:]]*)?$') THEN RETURN 'Use an https account address without sign-in details, and a handle without spaces.';END IF;
   seen:=array_append(seen,row->>'service');
  END LOOP;
 END IF;
 RETURN NULL;
END$$;

CREATE FUNCTION app.save_site_settings_draft(p_site uuid,p_expected_revision bigint,p_settings jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site public.sites;head public.site_settings;rev bigint;version uuid;baseline uuid;defect text;
BEGIN
 actor:=app.require_actor();SELECT * INTO site FROM public.sites WHERE id=p_site FOR UPDATE;
 IF site.id IS NULL THEN RAISE EXCEPTION 'Site not found.' USING ERRCODE='CMS03';END IF;
 IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'Only an Admin can change site settings.' USING ERRCODE='CMS02';END IF;
 IF site.status='archived' OR site.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This site is archived.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO head FROM public.site_settings WHERE site_id=p_site FOR UPDATE;
 IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Site settings changed. Reload before saving.' USING ERRCODE='CMS01';END IF;
 defect:=app.site_public_settings_defect(p_settings);IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 IF p_settings IS NOT DISTINCT FROM (SELECT settings FROM public.site_setting_versions WHERE id=head.draft_version_id) THEN RETURN head.revision;END IF;
 rev:=head.revision;
 IF head.published_version_id IS NULL THEN
  rev:=rev+1;
  -- Retain only the name already public, so the first change is recoverable.
  INSERT INTO public.site_setting_versions(site_id,site_settings_id,revision,settings,author_id) VALUES(p_site,head.id,rev,jsonb_build_object('name',site.name),actor) RETURNING id INTO baseline;
 END IF;
 rev:=rev+1;
 INSERT INTO public.site_setting_versions(site_id,site_settings_id,revision,settings,author_id) VALUES(p_site,head.id,rev,p_settings,actor) RETURNING id INTO version;
 UPDATE public.site_settings SET revision=rev,draft_version_id=version,published_version_id=COALESCE(head.published_version_id,baseline) WHERE id=head.id;
 PERFORM app.write_audit(p_site,'user',actor,'site.settings.save','site_settings',head.id,head.draft_version_id,version,'{}');
 RETURN rev;
END$$;

ALTER FUNCTION app.rebuild_site_shell(uuid) RENAME TO rebuild_site_shell_before_public_settings;
CREATE FUNCTION app.rebuild_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE rev bigint;config jsonb;
BEGIN
 rev:=app.rebuild_site_shell_before_public_settings(p_site_id);
 SELECT v.settings INTO config FROM public.site_settings h JOIN public.site_setting_versions v ON v.id=h.published_version_id WHERE h.site_id=p_site_id;
 IF config->'schemaVersion'='1'::jsonb AND app.site_public_settings_defect(config) IS NULL THEN UPDATE public.published_site_shells SET payload=payload||jsonb_build_object('settings',config) WHERE site_id=p_site_id;END IF;
 RETURN rev;
END$$;

CREATE FUNCTION app.publish_site_settings(p_site uuid,p_expected_revision bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;site public.sites;head public.site_settings;config jsonb;defect text;shell_rev bigint;
BEGIN
 actor:=app.require_actor();SELECT * INTO site FROM public.sites WHERE id=p_site FOR UPDATE;
 IF site.id IS NULL THEN RAISE EXCEPTION 'Site not found.' USING ERRCODE='CMS03';END IF;
 IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'Only an Admin can publish site settings.' USING ERRCODE='CMS02';END IF;
 IF site.status='archived' OR site.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This site is archived.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO head FROM public.site_settings WHERE site_id=p_site FOR UPDATE;
 IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Site settings changed. Review them again.' USING ERRCODE='CMS01';END IF;
 SELECT settings INTO config FROM public.site_setting_versions WHERE id=head.draft_version_id AND site_id=p_site AND site_settings_id=head.id;
 defect:=app.site_public_settings_defect(config);IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 IF head.draft_version_id IS NOT DISTINCT FROM head.published_version_id THEN RETURN head.revision;END IF;
 UPDATE public.site_settings SET published_version_id=head.draft_version_id,revision=head.revision+1 WHERE id=head.id;
 UPDATE public.sites SET name=config->>'name',revision=revision+1 WHERE id=p_site AND name IS DISTINCT FROM config->>'name';
 shell_rev:=app.rebuild_site_shell(p_site);
 PERFORM app.write_audit(p_site,'user',actor,'site.settings.publish','site_settings',head.id,head.published_version_id,head.draft_version_id,'{}');
 PERFORM app.emit_outbox(p_site,'site_shell.published',jsonb_build_object('site_id',p_site,'revision',shell_rev,'paths',COALESCE((SELECT jsonb_agg(path) FROM public.published_routes WHERE site_id=p_site),'[]')));
 RETURN head.revision+1;
END$$;

ALTER FUNCTION app.release_fingerprint(uuid) RENAME TO release_fingerprint_before_public_settings;
CREATE FUNCTION app.release_fingerprint(p_site_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE previous text;state jsonb;
BEGIN
 previous:=app.release_fingerprint_before_public_settings(p_site_id);
 SELECT jsonb_build_object('id',id,'revision',revision,'draft',draft_version_id,'published',published_version_id) INTO state FROM public.site_settings WHERE site_id=p_site_id;
 RETURN encode(sha256(convert_to(previous||':settings:'||COALESCE(state::text,'null'),'UTF8')),'hex');
END$$;

ALTER FUNCTION app.capture_release_recovery_items(uuid,jsonb) RENAME TO capture_release_recovery_items_before_public_settings;
CREATE FUNCTION app.capture_release_recovery_items(p_site uuid,p_targets jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;target jsonb;head public.site_settings;
BEGIN
 result:=app.capture_release_recovery_items_before_public_settings(p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_targets) WHERE value->>'type'<>'site_settings'));
 FOR target IN SELECT value FROM jsonb_array_elements(p_targets) WHERE value->>'type'='site_settings' LOOP
  SELECT * INTO head FROM public.site_settings WHERE site_id=p_site AND id=(target->>'id')::uuid;
  IF head.id IS NULL THEN RAISE EXCEPTION 'Site settings are missing or belong to another site.' USING ERRCODE='CMS04';END IF;
  result:=result||jsonb_build_array(jsonb_build_object('key',target->>'key','type','site_settings','id',head.id,'label','Site settings','revision',head.revision::text,'draft',head.draft_version_id,'published',head.published_version_id));
 END LOOP;RETURN result;
END$$;

CREATE TABLE public.site_release_settings_pins(
 release_id uuid NOT NULL REFERENCES public.site_releases(id),site_id uuid NOT NULL,site_settings_id uuid NOT NULL,version_id uuid NOT NULL,
 PRIMARY KEY(release_id,version_id),FOREIGN KEY(site_id,site_settings_id) REFERENCES public.site_settings(site_id,id),FOREIGN KEY(site_settings_id,version_id) REFERENCES public.site_setting_versions(site_settings_id,id)
);
ALTER TABLE public.site_release_settings_pins OWNER TO cms_migration_owner;
ALTER TABLE public.site_release_settings_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_release_settings_pins FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON public.site_release_settings_pins TO cms_authenticated_user;
CREATE POLICY site_release_settings_pins_visible ON public.site_release_settings_pins FOR SELECT TO cms_authenticated_user USING(app.can_administer_site(site_id));
ALTER FUNCTION app.pin_release_recovery_items(uuid,uuid,jsonb) RENAME TO pin_release_recovery_items_before_public_settings;
CREATE FUNCTION app.pin_release_recovery_items(p_release uuid,p_site uuid,p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb;pin uuid;head uuid;
BEGIN
 PERFORM app.pin_release_recovery_items_before_public_settings(p_release,p_site,(SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) FROM jsonb_array_elements(p_items) WHERE value->>'type'<>'site_settings'));
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) WHERE value->>'type'='site_settings' LOOP
  FOR pin IN SELECT DISTINCT value::uuid FROM jsonb_array_elements_text(jsonb_build_array(item->'draft',item->'published')) WHERE value IS NOT NULL LOOP
   SELECT site_settings_id INTO head FROM public.site_setting_versions WHERE id=pin AND site_id=p_site AND site_settings_id=(item->>'id')::uuid;
   IF head IS NULL THEN RAISE EXCEPTION 'A settings recovery version belongs to another site.' USING ERRCODE='CMS04';END IF;
   INSERT INTO public.site_release_settings_pins(release_id,site_id,site_settings_id,version_id) VALUES(p_release,p_site,head,pin) ON CONFLICT DO NOTHING;
  END LOOP;
 END LOOP;
END$$;
ALTER FUNCTION app.release_recovery_payload(jsonb,boolean) RENAME TO release_recovery_payload_before_public_settings;
CREATE FUNCTION app.release_recovery_payload(p_item jsonb,p_draft boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_item->>'type'='site_settings' THEN RETURN (SELECT jsonb_build_object('schemaVersion',1)||settings FROM public.site_setting_versions WHERE id=(p_item->>CASE WHEN p_draft THEN 'draft' ELSE 'published' END)::uuid AND site_settings_id=(p_item->>'id')::uuid);END IF;
 RETURN app.release_recovery_payload_before_public_settings(p_item,p_draft);
END$$;
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.prepare_site_release_recovery(uuid,uuid,jsonb)'::regprocedure);
 updated:=replace(body,'WHEN ''site_files'' THEN',$case$WHEN 'site_settings' THEN
        IF NOT app.can_administer_site(receipt.site_id) THEN RAISE EXCEPTION 'An Admin must recover site settings.' USING ERRCODE='CMS02';END IF;
        IF was_unpublished THEN RAISE EXCEPTION 'The previous site settings are unavailable.' USING ERRCODE='CMS04';END IF;
        SELECT jsonb_build_object('schemaVersion',1)||settings AS config INTO src FROM public.site_setting_versions WHERE id=(before_item->>'published')::uuid AND site_id=receipt.site_id AND site_settings_id=(before_item->>'id')::uuid;
        IF src.config IS NULL THEN RAISE EXCEPTION 'The retained site settings are unavailable.' USING ERRCODE='CMS04';END IF;
        PERFORM app.save_site_settings_draft(receipt.site_id,(current_item->>'revision')::bigint,src.config);
      WHEN 'site_files' THEN$case$);
 IF updated=body THEN RAISE EXCEPTION 'Settings recovery insertion point changed.';END IF;
 updated:=replace(updated,'WHEN ''collection_schema'' THEN 0','WHEN ''site_settings'' THEN -2 WHEN ''collection_schema'' THEN 0');
 updated:=replace(updated,'IN (''theme'',''collection_schema''','IN (''site_settings'',''theme'',''collection_schema''');EXECUTE updated;
END$$;
-- A copied site's settings must never rename it to the source site on first Publish.
DO $$DECLARE body text;updated text;BEGIN
 body:=pg_get_functiondef('app.import_site_content_before_recipes(uuid,jsonb,jsonb)'::regprocedure);
 updated:=replace(body,'row_value:=item||jsonb_build_object(''site_id'',p_request_id,''author_id'',actor);'||chr(10)||' INSERT INTO public.site_setting_versions',
 'row_value:=item||jsonb_build_object(''site_id'',p_request_id,''author_id'',actor,''settings'',(item->''settings'')||jsonb_build_object(''name'',p_bundle->''site''->>''name''));'||chr(10)||' INSERT INTO public.site_setting_versions');
 IF updated=body THEN RAISE EXCEPTION 'Settings copy insertion point changed.';END IF;EXECUTE updated;
END$$;
DO $$DECLARE signature text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
 'app.site_public_settings_defect(jsonb)','app.save_site_settings_draft(uuid,bigint,jsonb)','app.publish_site_settings(uuid,bigint)',
 'app.rebuild_site_shell(uuid)','app.rebuild_site_shell_before_public_settings(uuid)',
 'app.release_fingerprint(uuid)','app.release_fingerprint_before_public_settings(uuid)',
 'app.capture_release_recovery_items(uuid,jsonb)','app.capture_release_recovery_items_before_public_settings(uuid,jsonb)',
 'app.pin_release_recovery_items(uuid,uuid,jsonb)','app.pin_release_recovery_items_before_public_settings(uuid,uuid,jsonb)',
 'app.release_recovery_payload(jsonb,boolean)','app.release_recovery_payload_before_public_settings(jsonb,boolean)'
 ] LOOP
  EXECUTE 'ALTER FUNCTION '||signature||' OWNER TO cms_migration_owner';
  EXECUTE 'REVOKE ALL ON FUNCTION '||signature||' FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker';
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION app.save_site_settings_draft(uuid,bigint,jsonb),app.publish_site_settings(uuid,bigint),app.release_fingerprint(uuid) TO cms_authenticated_user;
