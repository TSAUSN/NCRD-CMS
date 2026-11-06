-- Sharing images remain strings. A governed /media/id/variant address is a
-- real immutable media reference even when the picture is absent from body content.
CREATE FUNCTION app.social_image_media_reference(p_meta jsonb)
RETURNS TABLE (media_id uuid, variant text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE address text; parts text[];
BEGIN
  address := btrim(COALESCE(p_meta->>'social_image', ''));
  IF address = '' OR address NOT LIKE '/media/%' THEN RETURN; END IF;
  parts := regexp_match(address, '^/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(original|thumbnail|card|wide)$', 'i');
  IF parts IS NULL OR parts[2] <> lower(parts[2]) THEN
    RAISE EXCEPTION 'choose a sharing image from Media or use a public HTTPS image address' USING ERRCODE = 'CMS04';
  END IF;
  media_id := parts[1]::uuid;
  variant := lower(parts[2]);
  RETURN NEXT;
END
$$;

CREATE OR REPLACE FUNCTION app.index_page_version_media(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version_row RECORD; reference RECORD; media_row RECORD;
BEGIN
  SELECT pv.id, pv.site_id, pv.page_id, pv.content, pv.meta INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;

  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
    UNION SELECT * FROM app.social_image_media_reference(version_row.meta)
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
  SELECT pv.id, pv.site_id, pv.content, pv.meta INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;
  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
    UNION SELECT * FROM app.social_image_media_reference(version_row.meta)
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

-- Existing historical references may point at recoverably deleted media.
-- Index their valid ownership without rewriting immutable versions or approving
-- broken references. The publication gate still requires ready media/variants.
INSERT INTO public.media_usage (media_id, site_id, item_type, item_id, version_id)
SELECT m.id, pv.site_id, 'page', pv.page_id, pv.id
FROM public.page_versions pv
CROSS JOIN LATERAL regexp_match(btrim(COALESCE(pv.meta->>'social_image','')),
  '^/media/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(original|thumbnail|card|wide)$', 'i') AS matched(parts)
JOIN public.media m ON m.id = parts[1]::uuid AND (m.site_id = pv.site_id OR m.site_id IS NULL)
ON CONFLICT (media_id, version_id) DO NOTHING;

REVOKE ALL ON FUNCTION app.social_image_media_reference(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.index_page_version_media(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assert_page_version_media_ready(uuid) FROM PUBLIC;
ALTER FUNCTION app.social_image_media_reference(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.index_page_version_media(uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.assert_page_version_media_ready(uuid) OWNER TO cms_migration_owner;
