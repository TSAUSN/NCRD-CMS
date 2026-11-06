-- A chapter editor may inspect photos referenced by a page they can read,
-- including its history. This grants no site-wide Media access or write rights.
CREATE OR REPLACE FUNCTION app.resolve_media(p_media_id uuid, p_variant text)
RETURNS TABLE (
  media_id uuid, variant text, object_key text, mime_type text,
  bytes bigint, width integer, height integer, content_hash text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF p_variant NOT IN ('original', 'thumbnail', 'card', 'wide') THEN
    RAISE EXCEPTION 'unsupported media variant' USING ERRCODE = 'CMS04';
  END IF;
  RETURN QUERY
  SELECT m.id, p_variant,
         CASE WHEN p_variant = 'original' THEN m.object_key ELSE v.object_key END,
         CASE WHEN p_variant = 'original' THEN m.mime_type ELSE v.mime_type END,
         CASE WHEN p_variant = 'original' THEN m.bytes ELSE v.bytes END,
         CASE WHEN p_variant = 'original' THEN m.width ELSE v.width END,
         CASE WHEN p_variant = 'original' THEN m.height ELSE v.height END,
         CASE WHEN p_variant = 'original' THEN m.content_hash ELSE v.content_hash END
    FROM public.media m
    LEFT JOIN public.media_variants v
      ON v.media_id = m.id AND v.kind = p_variant AND p_variant <> 'original'
   WHERE m.id = p_media_id AND m.status = 'ready' AND m.deleted_at IS NULL
     AND ((m.site_id IS NULL AND actor IS NOT NULL) OR app.has_site_access(m.site_id)
       OR EXISTS (
         SELECT 1 FROM public.media_usage u
         JOIN public.page_versions pv ON pv.id = u.version_id
           AND pv.page_id = u.item_id AND pv.site_id = u.site_id
         WHERE u.media_id = m.id AND u.site_id = m.site_id AND u.item_type = 'page'
           AND app.has_page_access(pv.page_id)
       ))
     AND (p_variant = 'original' OR v.id IS NOT NULL);
END
$$;

