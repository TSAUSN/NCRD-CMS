-- A script-enabled preview runs on the public origin, with no admin session.
-- Only an authenticated actor may issue a short-lived, read-only snapshot.
CREATE TABLE public.canvas_preview_tickets (
 id uuid PRIMARY KEY,site_id uuid NOT NULL REFERENCES public.sites(id),page_id uuid NOT NULL REFERENCES public.pages(id),
 version_id uuid NOT NULL REFERENCES public.page_versions(id),actor_id uuid NOT NULL REFERENCES public.app_users(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),asset_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(app.json_within(asset_refs,262144)),snapshot jsonb NOT NULL CHECK(app.json_within(snapshot,4194304)),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes')
);
CREATE INDEX canvas_tickets_expiry ON public.canvas_preview_tickets(expires_at);
CREATE INDEX canvas_tickets_actor ON public.canvas_preview_tickets(actor_id,created_at);
ALTER TABLE public.canvas_preview_tickets OWNER TO cms_migration_owner;
ALTER TABLE public.canvas_preview_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canvas_preview_tickets FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;

-- Rebuild a private list envelope from real draft rows. Only bindings already
-- on this saved page can be supplied; caller HTML, ASTs and script metadata
-- never enter the snapshot. Selection/order are preview-only, never writes.
CREATE FUNCTION app.canvas_draft_list(p_site uuid,p_binding jsonb,p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE list RECORD;entries jsonb;schemas jsonb;schema_ids uuid[];total integer;
BEGIN
 IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
  OR p_value->>'kind'<>'collection' OR p_value->>'readerKey' IS DISTINCT FROM p_binding->>'readerKey'
  OR jsonb_typeof(p_value->'entries') IS DISTINCT FROM 'array' OR jsonb_array_length(p_value->'entries')>2000 THEN
  RAISE EXCEPTION 'The draft list preview is invalid.' USING ERRCODE='CMS04';END IF;
 SELECT c.*,v.id AS schema_id,v.fields,v.revision AS schema_revision INTO list FROM public.collections c
 JOIN public.collection_schema_versions v ON v.id=COALESCE(c.published_schema_version_id,c.draft_schema_version_id) AND v.collection_id=c.id
 WHERE c.site_id=p_site AND c.reader_key=p_binding->>'readerKey';
 IF list.id IS NULL OR p_value->>'collectionId' IS DISTINCT FROM list.id::text THEN RAISE EXCEPTION 'The draft list belongs to another site or binding.' USING ERRCODE='CMS04';END IF;
 SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'stableKey',e.stable_key,'schemaVersionId',v.schema_version_id,'values',v.values) ORDER BY chosen.ordinality),'[]'::jsonb),array_agg(DISTINCT v.schema_version_id)
 INTO total,entries,schema_ids FROM jsonb_array_elements(p_value->'entries') WITH ORDINALITY chosen
 JOIN public.collection_entries e ON e.id=(chosen.value->>'id')::uuid AND e.collection_id=list.id AND e.site_id=p_site AND e.archived_at IS NULL
 JOIN public.collection_entry_versions v ON v.id=e.draft_version_id AND v.entry_id=e.id AND v.collection_id=e.collection_id
 WHERE chosen.value->>'stableKey'=e.stable_key AND chosen.value->>'schemaVersionId'=v.schema_version_id::text AND chosen.value->'values'=v.values;
 IF total<>jsonb_array_length(p_value->'entries') OR total<>(SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_value->'entries')) THEN
  RAISE EXCEPTION 'A draft list item changed, is missing or belongs to another list.' USING ERRCODE='CMS01';END IF;
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision::text,'fields',v.fields) ORDER BY v.id) INTO schemas
 FROM public.collection_schema_versions v WHERE v.collection_id=list.id AND (v.id=list.schema_id OR v.id=ANY(schema_ids));
 RETURN jsonb_build_object('kind','collection','collectionId',list.id,'readerKey',list.reader_key,'publishedSchemaVersionId',list.schema_id,
  'publishedSchemaRevision',list.schema_revision::text,'publishedEntryRevision',list.entry_revision::text,'schemas',schemas,'entries',entries);
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'The draft list preview has an invalid item identity.' USING ERRCODE='CMS04';
END $$;

-- Scan the authoritative snapshot once. Public resolvers then read only this
-- exact bounded reference list, never all assets owned by the preview actor.
CREATE FUNCTION app.canvas_snapshot_asset_references(p_snapshot jsonb)
RETURNS TABLE(kind text,id uuid,variant text) LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE node jsonb;key text;candidate text;match text[];rendition text;
BEGIN
 FOR match IN SELECT regexp_matches(p_snapshot::text,'/media/([0-9a-f-]{36})/(original|thumbnail|card|wide)([^a-z]|$)','gi') LOOP
  kind:='media';id:=match[1]::uuid;variant:=match[2];RETURN NEXT;
 END LOOP;
 FOR match IN SELECT regexp_matches(p_snapshot::text,'/assets/([0-9a-f-]{36})([^0-9a-f-]|$)','gi') LOOP
  kind:='asset';id:=match[1]::uuid;variant:=NULL;RETURN NEXT;
 END LOOP;
 FOR node IN WITH RECURSIVE walk(value) AS (
  SELECT p_snapshot UNION ALL SELECT child.value FROM walk CROSS JOIN LATERAL (
   SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(walk.value)='array' THEN walk.value ELSE '[]'::jsonb END)
   UNION ALL SELECT value FROM jsonb_each(CASE WHEN jsonb_typeof(walk.value)='object' THEN walk.value ELSE '{}'::jsonb END)
  ) child
 ) SELECT value FROM walk WHERE jsonb_typeof(value)='object' LOOP
  FOREACH key IN ARRAY ARRAY['media_id','mediaId','logoMediaId','compactLogoMediaId','asset_id','assetId'] LOOP
   candidate:=node->>key;
   IF candidate IS NULL OR candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN CONTINUE;END IF;
   kind:=CASE WHEN key IN ('asset_id','assetId') THEN 'asset' ELSE 'media' END;
   id:=candidate::uuid;
   rendition:=CASE WHEN kind='asset' THEN NULL WHEN key='compactLogoMediaId' THEN 'thumbnail' WHEN key='logoMediaId' THEN 'wide' ELSE COALESCE(node->>'variant','wide') END;
   IF kind='asset' OR rendition IN ('original','thumbnail','card','wide') THEN variant:=rendition;RETURN NEXT;END IF;
  END LOOP;
 END LOOP;
END $$;

CREATE FUNCTION app.create_canvas_ticket(p_version uuid,p_site_drafts boolean,p_parent_origin text,p_channel text,p_show_hidden boolean,p_lists jsonb)
RETURNS TABLE(token text,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;version RECORD;site RECORD;manifest jsonb;shell jsonb;paths jsonb;header jsonb;footer jsonb;item jsonb;index integer;slot text;binding jsonb;resolved jsonb;
 snapshot jsonb;refs jsonb;created uuid:=gen_random_uuid();secret text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');expiry timestamptz:=now()+interval '10 minutes';draft boolean;
BEGIN
 actor:=app.require_actor();
 SELECT v.*,p.archived_at INTO version FROM public.page_versions v JOIN public.pages p ON p.id=v.page_id AND p.site_id=v.site_id WHERE v.id=p_version;
 IF version.id IS NULL OR version.archived_at IS NOT NULL OR NOT app.has_site_access(version.site_id) THEN RAISE EXCEPTION 'This editing preview is unavailable.' USING ERRCODE='CMS03';END IF;
 SELECT * INTO site FROM public.sites WHERE id=version.site_id AND status<>'archived';
 IF site.id IS NULL THEN RAISE EXCEPTION 'This site is unavailable.' USING ERRCODE='CMS03';END IF;
 IF p_parent_origin IS NULL OR length(p_parent_origin)>300 OR p_parent_origin !~ '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
  OR p_channel IS NULL OR p_channel !~ '^[A-Za-z0-9_-]{16,128}$' OR p_show_hidden IS NULL
  OR jsonb_typeof(p_lists) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lists)>200 THEN RAISE EXCEPTION 'The editing preview context is invalid.' USING ERRCODE='CMS04';END IF;
 manifest:=app.build_initial_preview_manifest(p_version);
 FOR item IN SELECT value FROM jsonb_array_elements(p_lists) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['section','slot','value']<>'{}'::jsonb OR COALESCE(item->>'section','') !~ '^(0|[1-9][0-9]{0,2})$' THEN RAISE EXCEPTION 'The draft list override is invalid.' USING ERRCODE='CMS04';END IF;
  index:=(item->>'section')::integer;slot:=item->>'slot';
  IF index>=jsonb_array_length(manifest->'sections') OR slot IS NULL OR slot !~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(manifest->'sections'->index->'def'->'slots') field WHERE field->>'id'=slot AND field->>'kind'='repeat') THEN RAISE EXCEPTION 'The draft list field is not on this page.' USING ERRCODE='CMS04';END IF;
  binding:=version.content->index->'values'->slot;resolved:=app.canvas_draft_list(site.id,binding,item->'value');
  manifest:=jsonb_set(manifest,ARRAY['sections',index::text,'instance','values',slot],resolved,false);
 END LOOP;
 draft:=COALESCE(p_site_drafts,site.initial_release_required);
 SELECT payload INTO shell FROM public.published_site_shells WHERE site_id=site.id;
 shell:=COALESCE(shell,jsonb_build_object('site',jsonb_build_object('id',site.id,'name',site.name,'slug',site.slug,'kind',site.kind),'theme','{}'::jsonb,'navigation','[]'::jsonb,'canonical_host',NULL,'staging_host',site.staging_hostname));
 SELECT COALESCE(jsonb_object_agg(page_id::text,path),'{}'::jsonb) INTO paths FROM public.published_routes WHERE site_id=site.id;
 IF draft THEN
  SELECT v.content INTO header FROM public.global_elements h JOIN public.global_element_versions v ON v.id=h.draft_version_id WHERE h.site_id=site.id AND h.kind='header';
  SELECT v.content INTO footer FROM public.global_elements h JOIN public.global_element_versions v ON v.id=h.draft_version_id WHERE h.site_id=site.id AND h.kind='footer';
  shell:=shell||jsonb_build_object('theme',(SELECT v.tokens FROM public.themes h JOIN public.theme_versions v ON v.id=h.draft_version_id WHERE h.site_id=site.id),
   'navigation',(SELECT v.tree FROM public.navigations h JOIN public.navigation_versions v ON v.id=h.draft_version_id WHERE h.site_id=site.id),
   'header',header,'footer',footer,'header_component',app.preview_global_component(site.id,'header',header),'footer_component',app.preview_global_component(site.id,'footer',footer));
  SELECT COALESCE(jsonb_object_agg(id::text,app.page_path(slug)),'{}'::jsonb) INTO paths FROM public.pages WHERE site_id=site.id AND archived_at IS NULL;
  shell:=shell||jsonb_build_object('site_files',app.preview_site_files(site.id));
 END IF;
 paths:=paths||jsonb_build_object(version.page_id::text,app.page_path(version.page_slug));
 -- Expired rows confer no access. Bounded cleanup and a per-actor cap prevent
 -- editor refreshes from accumulating an unbounded private-content cache.
 DELETE FROM public.canvas_preview_tickets WHERE id IN(SELECT t.id FROM public.canvas_preview_tickets t WHERE t.expires_at<=now() ORDER BY t.expires_at LIMIT 200);
 DELETE FROM public.canvas_preview_tickets WHERE id IN(SELECT t.id FROM public.canvas_preview_tickets t WHERE t.actor_id=actor ORDER BY t.created_at DESC,t.id OFFSET 15);
 snapshot:=jsonb_build_object('manifest',manifest,'shell',shell,'navigationPaths',paths,'parentOrigin',p_parent_origin,'channel',p_channel,'showHiddenSections',p_show_hidden);
 SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind',r.kind,'id',r.id,'variant',r.variant)),'[]'::jsonb) INTO refs FROM app.canvas_snapshot_asset_references(snapshot) r;
 INSERT INTO public.canvas_preview_tickets(id,site_id,page_id,version_id,actor_id,token_hash,snapshot,asset_refs,expires_at)
 VALUES(created,site.id,version.page_id,p_version,actor,encode(sha256(convert_to(secret,'UTF8')),'hex'),snapshot,refs,expiry);
 RETURN QUERY SELECT secret,expiry;
END $$;

CREATE FUNCTION app.canvas_ticket_actor_allowed(p_actor uuid,p_site uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_users u WHERE u.id=p_actor AND u.status='active'
 AND (EXISTS(SELECT 1 FROM public.global_roles g WHERE g.user_id=u.id AND g.role='super_admin')
  OR EXISTS(SELECT 1 FROM public.site_memberships m WHERE m.user_id=u.id AND m.site_id=p_site)))
$$;
CREATE FUNCTION app.canvas_tickets_for_host(p_host text,p_tokens text[]) RETURNS SETOF public.canvas_preview_tickets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT t.* FROM public.canvas_preview_tickets t JOIN public.sites s ON s.id=t.site_id
 JOIN public.pages p ON p.id=t.page_id AND p.site_id=t.site_id
 WHERE cardinality(p_tokens) BETWEEN 1 AND 16 AND t.token_hash IN(SELECT encode(sha256(convert_to(value,'UTF8')),'hex') FROM unnest(p_tokens) value WHERE value ~ '^[a-f0-9]{64}$')
 AND lower(s.staging_hostname)=lower(p_host) AND s.status<>'archived' AND p.archived_at IS NULL
 AND t.expires_at>now() AND app.canvas_ticket_actor_allowed(t.actor_id,t.site_id)
 ORDER BY t.created_at DESC,t.id
$$;
CREATE FUNCTION public_api.canvas_snapshot(p_host text,p_token text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('snapshot',t.snapshot,'expiresAt',t.expires_at) FROM app.canvas_tickets_for_host(p_host,ARRAY[p_token]) t
$$;
CREATE FUNCTION public_api.resolve_canvas_file(p_host text,p_tokens text[],p_file uuid)
RETURNS TABLE(id uuid,site_id uuid,kind text,name text,source text,object_key text,mime_type text,bytes bigint,sha256 text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT f.id,f.site_id,f.kind,f.name,f.source,f.object_key,f.mime_type,f.bytes,f.sha256
 FROM app.canvas_tickets_for_host(p_host,p_tokens) t JOIN public.site_files f ON f.site_id=t.site_id AND f.id=p_file
 WHERE t.snapshot#>'{shell,site_files,bundle,files}' @> to_jsonb(ARRAY[f.id::text])
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.snapshot#>'{shell,site_files,files}') item WHERE item->>'id'=f.id::text AND item->>'sha256'=f.sha256)
 LIMIT 1
$$;
CREATE FUNCTION public_api.resolve_canvas_media(p_host text,p_tokens text[],p_media uuid,p_variant text)
RETURNS TABLE(media_id uuid,variant text,object_key text,mime_type text,bytes bigint,width integer,height integer,content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT m.id,p_variant,CASE WHEN p_variant='original' THEN m.object_key ELSE v.object_key END,
 CASE WHEN p_variant='original' THEN m.mime_type ELSE v.mime_type END,CASE WHEN p_variant='original' THEN m.bytes ELSE v.bytes END,
 CASE WHEN p_variant='original' THEN m.width ELSE v.width END,CASE WHEN p_variant='original' THEN m.height ELSE v.height END,
 CASE WHEN p_variant='original' THEN m.content_hash ELSE v.content_hash END
 FROM app.canvas_tickets_for_host(p_host,p_tokens) t JOIN public.media m ON m.id=p_media AND (m.site_id=t.site_id OR m.site_id IS NULL)
 LEFT JOIN public.media_variants v ON v.media_id=m.id AND v.kind=p_variant
 WHERE m.status='ready' AND m.deleted_at IS NULL AND p_variant IN ('original','thumbnail','card','wide') AND (p_variant='original' OR v.id IS NOT NULL)
 AND t.asset_refs @> jsonb_build_array(jsonb_build_object('kind','media','id',m.id,'variant',p_variant)) LIMIT 1
$$;
CREATE FUNCTION public_api.resolve_canvas_asset(p_host text,p_tokens text[],p_asset uuid)
RETURNS TABLE(id uuid,kind text,object_key text,mime_type text,bytes bigint,content_hash text,original_name text,font_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT a.id,a.kind,a.object_key,a.mime_type,a.bytes,a.content_hash,a.original_name,a.font_key
 FROM app.canvas_tickets_for_host(p_host,p_tokens) t JOIN public.site_assets a ON a.site_id=t.site_id AND a.id=p_asset
 WHERE t.asset_refs @> jsonb_build_array(jsonb_build_object('kind','asset','id',a.id,'variant',NULL)) LIMIT 1
$$;
CREATE FUNCTION app.renew_canvas_ticket(p_page uuid,p_token text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;ticket public.canvas_preview_tickets;expiry timestamptz:=now()+interval '10 minutes';
BEGIN
 actor:=app.require_actor();
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'The editing preview is unavailable.' USING ERRCODE='CMS03';END IF;
 SELECT * INTO ticket FROM public.canvas_preview_tickets WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') AND page_id=p_page AND actor_id=actor FOR UPDATE;
 IF ticket.id IS NULL OR NOT app.has_site_access(ticket.site_id) OR NOT EXISTS(SELECT 1 FROM public.sites s JOIN public.pages p ON p.site_id=s.id WHERE s.id=ticket.site_id AND s.status<>'archived' AND p.id=p_page AND p.archived_at IS NULL) THEN RAISE EXCEPTION 'The editing preview is unavailable.' USING ERRCODE='CMS03';END IF;
 -- Only the original authenticated actor can renew; public ticket holders
 -- cannot extend their own access or change the frozen page/assets snapshot.
 UPDATE public.canvas_preview_tickets SET created_at=now(),expires_at=expiry WHERE id=ticket.id;
 RETURN expiry;
END $$;

ALTER FUNCTION app.canvas_draft_list(uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.canvas_snapshot_asset_references(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.create_canvas_ticket(uuid,boolean,text,text,boolean,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.canvas_ticket_actor_allowed(uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.canvas_tickets_for_host(text,text[]) OWNER TO cms_migration_owner;
ALTER FUNCTION app.renew_canvas_ticket(uuid,text) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.canvas_draft_list(uuid,jsonb,jsonb),app.canvas_snapshot_asset_references(jsonb),app.create_canvas_ticket(uuid,boolean,text,text,boolean,jsonb),app.canvas_ticket_actor_allowed(uuid,uuid),app.canvas_tickets_for_host(text,text[]),app.renew_canvas_ticket(uuid,text) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.create_canvas_ticket(uuid,boolean,text,text,boolean,jsonb),app.renew_canvas_ticket(uuid,text) TO cms_authenticated_user;
ALTER FUNCTION public_api.canvas_snapshot(text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_canvas_file(text,text[],uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_canvas_media(text,text[],uuid,text) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_canvas_asset(text,text[],uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.canvas_snapshot(text,text),public_api.resolve_canvas_file(text,text[],uuid),public_api.resolve_canvas_media(text,text[],uuid,text),public_api.resolve_canvas_asset(text,text[],uuid) FROM PUBLIC,cms_authenticated_user,cms_worker;
GRANT EXECUTE ON FUNCTION public_api.canvas_snapshot(text,text),public_api.resolve_canvas_file(text,text[],uuid),public_api.resolve_canvas_media(text,text[],uuid,text),public_api.resolve_canvas_asset(text,text[],uuid) TO cms_public_renderer;
