-- Editor-managed PDFs use the existing immutable asset store. This is a
-- separate command from super-admin frozen imports: no fonts, arbitrary keys,
-- destination URLs, source receipts or publication rights come from callers.
CREATE FUNCTION app.authorize_site_document_upload(p_site uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF COALESCE(app.site_role(p_site) IN ('contributor','editor','site_admin'),false) IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted to upload site documents' USING ERRCODE='CMS02';
  END IF;
  -- Held by the caller's transaction while the private object is written.
  PERFORM 1 FROM public.sites WHERE id=p_site AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document destination is unavailable' USING ERRCODE='CMS03'; END IF;
END $$;

CREATE FUNCTION app.upload_site_document(p_site uuid,p_id uuid,p_bytes bigint,p_hash text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; identity_hash text; expected_id uuid; object_path text; receipt jsonb; existing public.site_assets;
BEGIN
  PERFORM app.authorize_site_document_upload(p_site);
  actor:=app.require_actor();
  IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 26214400
    OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
    OR p_name IS NULL OR char_length(p_name) NOT BETWEEN 5 AND 255
    OR p_name<>btrim(p_name) OR p_name ~ '[[:cntrl:]/\\]' OR p_name !~* '\.pdf$' THEN
    RAISE EXCEPTION 'invalid PDF upload receipt' USING ERRCODE='CMS04';
  END IF;
  identity_hash:=encode(sha256(convert_to('cms-site-document:1:'||p_site::text||':'||p_hash||':'||p_name,'UTF8')),'hex');
  expected_id:=(substr(identity_hash,1,8)||'-'||substr(identity_hash,9,4)||'-4'||substr(identity_hash,14,3)||'-a'||substr(identity_hash,18,3)||'-'||substr(identity_hash,21,12))::uuid;
  IF p_id IS DISTINCT FROM expected_id THEN RAISE EXCEPTION 'document identity does not match its receipt' USING ERRCODE='CMS04'; END IF;
  object_path:='site-assets/'||p_site::text||'/'||p_id::text||'/'||p_hash;
  -- Retain the portable receipt schema. This manifest checksum identifies the
  -- upload receipt (site, bytes checksum, filename), not a frozen-source import.
  receipt:=jsonb_build_object('path','editor-uploads/'||p_id::text||'/'||p_name,
    'sha256',p_hash,'manifest_sha256',identity_hash);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,89));
  SELECT * INTO existing FROM public.site_assets WHERE id=p_id;
  IF existing.id IS NOT NULL THEN
    IF (existing.site_id,existing.kind,existing.object_key,existing.mime_type,existing.bytes,existing.content_hash,existing.original_name,existing.font_key,existing.provenance)
      IS DISTINCT FROM (p_site,'document'::text,object_path,'application/pdf'::text,p_bytes,p_hash,p_name,NULL::text,receipt) THEN
      RAISE EXCEPTION 'document retry differs from immutable receipt' USING ERRCODE='CMS04';
    END IF;
    RETURN p_id;
  END IF;
  INSERT INTO public.site_assets(id,site_id,kind,object_key,mime_type,bytes,content_hash,original_name,font_key,provenance,created_by)
    VALUES(p_id,p_site,'document',object_path,'application/pdf',p_bytes,p_hash,p_name,NULL,receipt,actor);
  PERFORM app.write_audit(p_site,'user',actor,'document.upload','media',p_id,NULL,p_id,
    jsonb_build_object('kind','document','sha256',p_hash,'bytes',p_bytes));
  RETURN p_id;
END $$;

-- Validate every new immutable entry version, including imported versions and
-- direct owner inserts. Historical entries are not rewritten by a migration.
CREATE FUNCTION app.collection_document_references(p_values jsonb,p_fields jsonb) RETURNS SETOF uuid
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE field jsonb; value text; address text; addresses text[]; tag text[]; attribute text[]; candidate text;
BEGIN
  FOR field IN SELECT f FROM jsonb_array_elements(p_fields) f WHERE f->>'type' IN ('url','richtext') LOOP
    IF jsonb_typeof(p_values->(field->>'key')) IS DISTINCT FROM 'string' THEN CONTINUE; END IF;
    value:=p_values->>(field->>'key'); addresses:=ARRAY[]::text[];
    IF field->>'type'='url' THEN addresses:=ARRAY[btrim(value)];
    ELSE
      -- Only anchor hrefs survive the rich-text renderer. External addresses,
      -- plain mentions, image tags, labels and metadata are not asset references.
      FOR tag IN SELECT regexp_matches(value,
        $re$<([[:alpha:]][[:alnum:]:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>$re$,'g') LOOP
        IF lower(tag[1])<>'a' THEN CONTINUE; END IF;
        FOR attribute IN SELECT regexp_matches(tag[2],
          $re$(?:^|[[:space:]])([[:alpha:]_:][[:alnum:]_:.-]*)[[:space:]]*=[[:space:]]*(?:"([^"]*)"|'([^']*)'|([^[:space:]"'=<>`]+))$re$,'g') LOOP
          IF lower(attribute[1])<>'href' THEN CONTINUE; END IF;
          IF attribute[4] IS NULL THEN addresses:=array_append(addresses,btrim(COALESCE(attribute[2],attribute[3]))); END IF;
          EXIT;
        END LOOP;
      END LOOP;
    END IF;
    FOREACH address IN ARRAY addresses LOOP
      IF address NOT LIKE '/assets/%' THEN CONTINUE; END IF;
      IF address !~* '^/assets/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}([?#][^[:space:]]*)?$' THEN
        RAISE EXCEPTION 'invalid collection document URL' USING ERRCODE='CMS04';
      END IF;
      RETURN NEXT substr(address,9,36)::uuid;
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION app.validate_collection_document_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE asset uuid; fields jsonb;
BEGIN
  SELECT s.fields INTO fields FROM public.collection_schema_versions s WHERE s.id=NEW.schema_version_id;
  FOR asset IN SELECT DISTINCT app.collection_document_references(NEW."values",fields) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.site_assets WHERE id=asset AND site_id=NEW.site_id AND kind='document') THEN
      RAISE EXCEPTION 'collection document is missing, is not a PDF, or belongs to another site' USING ERRCODE='CMS04';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER collection_entry_versions_validate_documents BEFORE INSERT ON public.collection_entry_versions
  FOR EACH ROW EXECUTE FUNCTION app.validate_collection_document_references();

-- Authored frames retain their independently published, pinned definitions and
-- declared non-navigation values. Drafts and stripped source cannot grant access.
CREATE FUNCTION app.published_frame_uses_site_document(p_site uuid,p_asset uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT app.published_frame_uses_url_pattern(p_site,'^/assets/'||p_asset::text||'([?#][^[:space:]]*)?$',true)
$$;

-- A selected entry alone is not a grant to all of its stored fields. Walk the
-- repeat item actually rendered by the route and permit URL/richtext sinks only.
CREATE FUNCTION app.render_manifest_uses_collection_document(p_manifest jsonb,p_collection uuid,p_entry uuid,p_asset uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE live RECORD; section jsonb; repeater jsonb; binding jsonb; node jsonb; field jsonb; field_value jsonb; pattern text;
BEGIN
  IF NOT app.render_manifest_uses_collection_entry(p_manifest,p_collection,p_entry) THEN RETURN false; END IF;
  SELECT v.schema_version_id,v."values",s.fields,c.published_entry_revision INTO live
    FROM public.collection_entries e JOIN public.collections c ON c.id=e.collection_id AND c.site_id=e.site_id
    JOIN public.collection_entry_versions v ON v.id=e.published_version_id AND v.entry_id=e.id AND v.site_id=e.site_id
    JOIN public.collection_schema_versions s ON s.id=v.schema_version_id AND s.collection_id=c.id
    WHERE e.id=p_entry AND e.collection_id=p_collection AND e.published_archived_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  pattern:='^/assets/'||p_asset::text||'([?#][^[:space:]]*)?$';
  FOR section IN SELECT value FROM jsonb_array_elements(COALESCE(p_manifest->'sections','[]'::jsonb)) LOOP
    IF section#>>'{def,definition_kind}' IS DISTINCT FROM 'structured'
      OR section#>'{instance,hidden}'='true'::jsonb
      OR btrim(COALESCE(section#>>'{instance,raw_html}',''))<>''
      OR COALESCE(app.structured_section_defect(section#>>'{def,definition_kind}',section#>'{def,structured_doc}',(section#>>'{def,structured_schema_version}')::int),
        app.render_ast_defect(section#>'{def,compiled_ast}',(section#>>'{def,sanitizer_policy_version}')::int),
        app.compiled_css_defect(section#>>'{def,css}',(section#>>'{def,css_policy_version}')::int,'.cms-section--'||(section#>>'{def,slug}'))) IS NOT NULL
      THEN CONTINUE; END IF;
    FOR repeater IN WITH RECURSIVE nodes(value) AS (
      SELECT value FROM jsonb_array_elements(COALESCE(section#>'{def,structured_doc,nodes}','[]'::jsonb))
      UNION ALL SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
    ) SELECT value FROM nodes WHERE value->>'type'='repeat' LOOP
      binding:=section#>'{instance,values}'->(repeater->>'field');
      IF binding->>'kind' IS DISTINCT FROM 'collection' OR binding->>'collectionId' IS DISTINCT FROM p_collection::text
        OR binding->>'publishedEntryRevision' IS DISTINCT FROM live.published_entry_revision::text
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(binding->'entries','[]'::jsonb)) entry
          WHERE entry->>'id'=p_entry::text AND entry->>'schemaVersionId'=live.schema_version_id::text AND entry->'values'=live."values") THEN CONTINUE; END IF;
      FOR node IN WITH RECURSIVE nodes(value) AS (
        SELECT value FROM jsonb_array_elements(COALESCE(repeater->'item','[]'::jsonb))
        UNION ALL SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
      ) SELECT value FROM nodes LOOP
        SELECT f INTO field FROM jsonb_array_elements(live.fields) f WHERE f->>'key'=node->>'field';
        field_value:=live."values"->(node->>'field');
        IF node->>'type'='link' AND field->>'type'='url' AND jsonb_typeof(field_value)='string'
          AND btrim(field_value#>>'{}') ~ pattern THEN RETURN true;
        ELSIF node->>'type'='richtext' AND field->>'type'='richtext' AND jsonb_typeof(field_value)='string'
          AND app.frame_markup_uses_url_pattern(field_value#>>'{}',pattern,true) THEN RETURN true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public_api.resolve_site_asset(p_host text,p_asset uuid)
RETURNS TABLE(id uuid,kind text,object_key text,mime_type text,bytes bigint,content_hash text,original_name text,font_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT a.id,a.kind,a.object_key,a.mime_type,a.bytes,a.content_hash,a.original_name,a.font_key
  FROM public_api.resolve_host(p_host) h JOIN public.site_assets a ON a.site_id=h.site_id
  WHERE a.id=p_asset AND (
    EXISTS(SELECT 1 FROM public.site_asset_usage u JOIN public.pages p ON p.id=u.page_id AND p.site_id=u.site_id
      WHERE u.asset_id=a.id AND u.version_id=p.published_version_id AND p.status='published' AND p.archived_at IS NULL)
    OR (a.kind='document' AND app.published_frame_uses_site_document(h.site_id,a.id))
    OR (a.kind='document' AND EXISTS(
      SELECT 1 FROM public.collection_entries e JOIN public.collections c ON c.id=e.collection_id AND c.site_id=e.site_id
      WHERE e.site_id=h.site_id AND e.published_version_id IS NOT NULL AND e.published_archived_at IS NULL
        AND EXISTS(SELECT 1 FROM public.published_routes r
          JOIN public.pages p ON p.id=r.page_id AND p.site_id=r.site_id AND p.published_version_id=r.page_version_id
          WHERE r.site_id=h.site_id AND p.status='published' AND p.archived_at IS NULL
            AND app.render_manifest_uses_collection_document(r.render_manifest,c.id,e.id,a.id))
    ))
  )
$$;

DO $$ DECLARE obj RECORD; BEGIN
  FOR obj IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND p.proname IN ('authorize_site_document_upload','upload_site_document',
      'collection_document_references','validate_collection_document_references','published_frame_uses_site_document','render_manifest_uses_collection_document')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',obj.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',obj.sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.authorize_site_document_upload(uuid),app.upload_site_document(uuid,uuid,bigint,text,text) TO cms_authenticated_user;
ALTER FUNCTION public_api.resolve_site_asset(text,uuid) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION public_api.resolve_site_asset(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_api.resolve_site_asset(text,uuid) TO cms_public_renderer;
