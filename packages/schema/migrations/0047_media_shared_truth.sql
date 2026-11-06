-- Media truth has to agree at every boundary.  The library has always exposed
-- the shared pool, but page persistence and public delivery treated every
-- shared UUID as cross-tenant.  Conversely, a shared UUID must not become a
-- public bearer token: it is deliverable on a host only while that site's live
-- page or live header actually references it.

-- A finalized image supplies every rendition that the admin can construct.
-- Keep the thoroughly-audited 0036 implementation as the inner command and
-- put the strengthened contract in front of it rather than copying its large
-- storage-key validator into a second implementation.
ALTER FUNCTION app.finalize_media_upload(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) RENAME TO finalize_media_upload_incomplete_0047;

REVOKE ALL ON FUNCTION app.finalize_media_upload_incomplete_0047(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) FROM PUBLIC, cms_worker, cms_authenticated_user, cms_public_renderer;

CREATE FUNCTION app.finalize_media_upload(
  p_intent_id uuid, p_upload_object_key text, p_final_object_key text,
  p_sha256 text, p_inspected_mime_type text, p_bytes bigint,
  p_width integer, p_height integer, p_variants jsonb
) RETURNS TABLE (media_id uuid, object_key text, status media_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE kinds text[];
BEGIN
  PERFORM app.require_worker();
  IF jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) <> 3 THEN
    RAISE EXCEPTION 'finalized media needs thumbnail, card, and wide variants'
      USING ERRCODE = 'CMS04';
  END IF;
  SELECT array_agg(value->>'kind' ORDER BY value->>'kind') INTO kinds
    FROM jsonb_array_elements(p_variants);
  IF kinds IS DISTINCT FROM ARRAY['card','thumbnail','wide']::text[] THEN
    RAISE EXCEPTION 'finalized media needs exactly thumbnail, card, and wide variants'
      USING ERRCODE = 'CMS04';
  END IF;
  RETURN QUERY SELECT * FROM app.finalize_media_upload_incomplete_0047(
    p_intent_id, p_upload_object_key, p_final_object_key, p_sha256,
    p_inspected_mime_type, p_bytes, p_width, p_height, p_variants);
END
$$;

REVOKE ALL ON FUNCTION app.finalize_media_upload(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.finalize_media_upload(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) TO cms_worker;

-- Shared media is tenant-neutral at rest and tenant-bound at the usage row.
-- Another site's owned media remains a hard failure.
CREATE OR REPLACE FUNCTION app.index_page_version_media(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version_row RECORD; reference RECORD; media_row RECORD;
BEGIN
  SELECT pv.id, pv.site_id, pv.page_id, pv.content INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;

  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
  LOOP
    SELECT m.id, m.site_id, m.status, m.deleted_at INTO media_row
      FROM public.media m WHERE m.id = reference.media_id;
    IF media_row.id IS NULL
       OR (media_row.site_id IS NOT NULL AND media_row.site_id <> version_row.site_id)
       OR media_row.status <> 'ready' OR media_row.deleted_at IS NOT NULL
       OR (reference.variant <> 'original' AND NOT EXISTS (
         SELECT 1 FROM public.media_variants mv
          WHERE mv.media_id = reference.media_id AND mv.kind = reference.variant
            AND mv.mime_type IS NOT NULL AND mv.content_hash IS NOT NULL)) THEN
      RAISE EXCEPTION 'page content contains media or a variant that is unresolved, deleted, or belongs to another site'
        USING ERRCODE = 'CMS04';
    END IF;
    INSERT INTO public.media_usage (media_id, site_id, item_type, item_id, version_id)
    VALUES (reference.media_id, version_row.site_id, 'page', version_row.page_id, version_row.id)
    ON CONFLICT (media_id, version_id) DO NOTHING;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.assert_page_version_media_ready(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version_row RECORD; reference RECORD; ok boolean;
BEGIN
  SELECT pv.id, pv.site_id, pv.content INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;
  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.media m
       WHERE m.id = reference.media_id
         AND (m.site_id = version_row.site_id OR m.site_id IS NULL)
         AND m.status = 'ready' AND m.deleted_at IS NULL
         AND (reference.variant = 'original' OR EXISTS (
           SELECT 1 FROM public.media_variants mv
            WHERE mv.media_id = m.id AND mv.kind = reference.variant
              AND mv.mime_type IS NOT NULL AND mv.content_hash IS NOT NULL))
         AND EXISTS (SELECT 1 FROM public.media_usage u
                      WHERE u.media_id = m.id AND u.site_id = version_row.site_id
                        AND u.version_id = version_row.id))
      INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'page version contains media that is no longer publishable'
        USING ERRCODE = 'CMS04';
    END IF;
  END LOOP;
END
$$;

-- Strengthen the header gate without duplicating the complete 0045 content
-- validator.  A full logo renders `wide`; a compact logo renders `thumbnail`.
ALTER FUNCTION app.global_elements_readiness_defect(uuid,global_element_kind,jsonb)
  RENAME TO global_elements_readiness_defect_0045;

CREATE FUNCTION app.global_elements_readiness_defect(
  p_site_id uuid, p_kind global_element_kind, p_content jsonb
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE defect text; logo_id uuid;
BEGIN
  defect := app.global_elements_readiness_defect_0045(p_site_id, p_kind, p_content);
  IF defect IS NOT NULL OR p_kind <> 'header' THEN RETURN defect; END IF;
  IF jsonb_typeof(p_content->'brand'->'logoMediaId') = 'string' THEN
    logo_id := (p_content->'brand'->>'logoMediaId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.media_variants
                    WHERE media_id = logo_id AND kind = 'wide') THEN
      RETURN 'a full header logo does not have its required wide rendition';
    END IF;
  END IF;
  IF jsonb_typeof(p_content->'brand'->'compactLogoMediaId') = 'string' THEN
    logo_id := (p_content->'brand'->>'compactLogoMediaId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.media_variants
                    WHERE media_id = logo_id AND kind = 'thumbnail') THEN
      RETURN 'a compact header logo does not have its required thumbnail rendition';
    END IF;
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION app.global_elements_readiness_defect_0045(
  uuid,global_element_kind,jsonb
) FROM PUBLIC, cms_authenticated_user, cms_worker, cms_public_renderer;
REVOKE ALL ON FUNCTION app.global_elements_readiness_defect(
  uuid,global_element_kind,jsonb
) FROM PUBLIC;

-- A shared object is public on one host only while a live projection on that
-- exact site names it.  Site-owned media keeps its existing tenant rule.
CREATE OR REPLACE FUNCTION public_api.resolve_media(
  p_host text, p_media_id uuid, p_variant text
) RETURNS TABLE (
  media_id uuid, variant text, object_key text, mime_type text,
  bytes bigint, width integer, height integer, content_hash text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.id, p_variant,
         CASE WHEN p_variant = 'original' THEN m.object_key ELSE v.object_key END,
         CASE WHEN p_variant = 'original' THEN m.mime_type ELSE v.mime_type END,
         CASE WHEN p_variant = 'original' THEN m.bytes ELSE v.bytes END,
         CASE WHEN p_variant = 'original' THEN m.width ELSE v.width END,
         CASE WHEN p_variant = 'original' THEN m.height ELSE v.height END,
         CASE WHEN p_variant = 'original' THEN m.content_hash ELSE v.content_hash END
    FROM public_api.resolve_host(p_host) h
    JOIN public.media m ON (
      m.site_id = h.site_id
      OR (m.site_id IS NULL AND (
        EXISTS (
          SELECT 1 FROM public.media_usage u
          JOIN public.pages p ON p.id = u.item_id AND u.item_type = 'page'
           WHERE u.media_id = m.id AND u.site_id = h.site_id
             AND p.site_id = h.site_id AND p.archived_at IS NULL
             AND p.published_version_id = u.version_id)
        OR EXISTS (
          SELECT 1 FROM public.global_elements g
          JOIN public.global_element_versions gv ON gv.id = g.published_version_id
           WHERE g.site_id = h.site_id AND g.kind = 'header'
             AND (gv.content #>> '{brand,logoMediaId}' = m.id::text
                  OR gv.content #>> '{brand,compactLogoMediaId}' = m.id::text))
      ))
    )
    LEFT JOIN public.media_variants v
      ON v.media_id = m.id AND v.kind = p_variant AND p_variant <> 'original'
   WHERE p_variant IN ('original', 'thumbnail', 'card', 'wide')
     AND m.id = p_media_id AND m.status = 'ready' AND m.deleted_at IS NULL
     AND (p_variant = 'original' OR v.id IS NOT NULL)
$$;

-- Polling reads a narrow projection of the private upload-intent table.  It is
-- collaborative inside the owning site but neutral for another tenant.
CREATE OR REPLACE FUNCTION app.media_upload_status(p_intent_id uuid)
RETURNS TABLE (
  intent_id uuid, status text, original_name text, media_id uuid,
  failure_code text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  RETURN QUERY
  SELECT i.id,
         CASE WHEN i.status IN ('pending','receiving','uploaded') THEN 'processing'
              ELSE i.status::text END,
         i.original_name, i.media_id, i.failure_code
    FROM app.media_upload_intents i
   WHERE i.id = p_intent_id
     AND (i.uploaded_by = actor
          OR (i.site_id IS NULL AND app.is_super_admin())
          OR (i.site_id IS NOT NULL AND app.has_site_access(i.site_id)));
END
$$;

REVOKE ALL ON FUNCTION app.media_upload_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.media_upload_status(uuid) TO cms_authenticated_user;

GRANT EXECUTE ON FUNCTION public_api.resolve_media(text,uuid,text)
  TO cms_public_renderer, cms_authenticated_user;

ALTER FUNCTION app.finalize_media_upload_incomplete_0047(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) OWNER TO cms_migration_owner;
ALTER FUNCTION app.finalize_media_upload(
  uuid,text,text,text,text,bigint,integer,integer,jsonb
) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_page_version_media(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_page_version_media_ready(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_elements_readiness_defect_0045(
  uuid,global_element_kind,jsonb
) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_elements_readiness_defect(
  uuid,global_element_kind,jsonb
) OWNER TO cms_migration_owner;
ALTER FUNCTION public_api.resolve_media(text,uuid,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.media_upload_status(uuid) OWNER TO cms_migration_owner;
