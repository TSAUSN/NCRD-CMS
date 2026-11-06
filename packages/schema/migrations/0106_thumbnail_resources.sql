-- Library pictures draw a definition with its site's own fonts, the pictures
-- its markup shows and, for a site's own layout, the words a page of that site
-- gives it (SPEC §6.5; V1 references 18/19: faithful, current, branded
-- thumbnails). The capture itself stays offline and deterministic: the worker
-- reads these objects from the media store and embeds them in the document it
-- photographs. Only the definition's own site's fonts, ready media and page
-- content are named, and a shared (global) layout gets no page content, so a
-- picture can never carry another site's files or words.
CREATE FUNCTION app.thumbnail_resources(p_section_def_id uuid, p_version int, p_media uuid[] DEFAULT '{}')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE site uuid;
BEGIN
  PERFORM app.require_worker();
  SELECT d.site_id INTO site FROM public.section_defs d WHERE d.id = p_section_def_id;
  RETURN jsonb_build_object(
    'fonts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('assetId', a.id, 'fontKey', a.font_key, 'objectKey', a.object_key,
                                          'mimeType', a.mime_type, 'bytes', a.bytes) ORDER BY a.font_key, a.id)
        FROM public.site_assets a
       WHERE site IS NOT NULL AND a.site_id = site AND a.kind = 'font' AND a.font_key IS NOT NULL), '[]'::jsonb),
    'media', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('mediaId', v.media_id, 'kind', v.kind, 'objectKey', v.object_key,
                                          'mimeType', v.mime_type, 'bytes', v.bytes, 'width', v.width) ORDER BY v.media_id, v.kind)
        FROM public.media_variants v
        JOIN public.media m ON m.id = v.media_id
       WHERE v.media_id = ANY (COALESCE(p_media, '{}'::uuid[]))
         AND m.site_id IS NOT DISTINCT FROM site AND m.status = 'ready' AND m.deleted_at IS NULL), '[]'::jsonb),
    -- The values of this version on a page of its own site: published first,
    -- then the newest draft.
    'values', COALESCE((
      SELECT section.value -> 'values'
        FROM public.pages p
        JOIN public.page_versions pv ON pv.id IN (p.published_version_id, p.draft_version_id)
        CROSS JOIN LATERAL jsonb_array_elements(pv.content) section(value)
       WHERE site IS NOT NULL AND p.site_id = site AND p.archived_at IS NULL
         AND section.value ->> 'section_def_id' = p_section_def_id::text
         AND (section.value ->> 'section_def_version')::int = p_version
       ORDER BY (pv.id = p.published_version_id) DESC, pv.revision DESC, p.id
       LIMIT 1), '{}'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION app.thumbnail_resources(uuid, int, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.thumbnail_resources(uuid, int, uuid[]) TO cms_worker;
ALTER FUNCTION app.thumbnail_resources(uuid, int, uuid[]) OWNER TO cms_migration_owner;

-- Pictures taken before they could carry fonts and images are retaken: the
-- worker's object key now names the picture recipe as well as the render, so
-- the guard sees them as stale, and this asks for the current version of each
-- active definition once.
DO $$
DECLARE v RECORD;
BEGIN
  FOR v IN
    SELECT sv.section_def_id, sv.version, d.slug, d.site_id
      FROM public.section_def_versions sv
      JOIN public.section_defs d ON d.id = sv.section_def_id
     WHERE d.status = 'active' AND sv.thumbnail_path IS NOT NULL
       AND sv.version = (SELECT max(l.version) FROM public.section_def_versions l WHERE l.section_def_id = sv.section_def_id)
       AND NOT EXISTS (SELECT 1 FROM public.outbox o
                        WHERE o.event_type = 'section_def.thumbnail_requested' AND o.status IN ('pending', 'running')
                          AND o.payload ->> 'section_def_id' = sv.section_def_id::text AND (o.payload ->> 'version')::int = sv.version)
  LOOP
    PERFORM app.emit_outbox(v.site_id, 'section_def.thumbnail_requested',
      jsonb_build_object('section_def_id', v.section_def_id, 'version', v.version, 'slug', v.slug));
  END LOOP;
END
$$;
