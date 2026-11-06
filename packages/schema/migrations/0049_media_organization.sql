-- A large media library stays usable only when organization is a server-owned
-- query and multi-row changes are one database decision.  This migration does
-- not change media bytes or object identity: it exposes atomic metadata-only
-- organization over the immutable assets admitted by 0036/0047.

CREATE INDEX media_folder_scope_status
  ON public.media (site_id, folder, status, created_at DESC, id);

CREATE INDEX media_search_document
  ON public.media USING gin (to_tsvector(
    'simple',
    coalesce(original_name, '') || ' ' || coalesce(alt_text, '') || ' '
      || coalesce(folder, '') || ' ' || coalesce(attribution, '') || ' '
      || coalesce(source, '')
  ));

CREATE OR REPLACE FUNCTION app.bulk_organize_media(
  p_media_ids uuid[], p_expected_revisions bigint[], p_folder text,
  p_add_tags text[], p_remove_tags text[]
) RETURNS TABLE(media_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; n integer; i integer; row public.media%ROWTYPE;
        next_tags text[]; next_revision bigint;
BEGIN
  actor := app.require_actor();
  n := cardinality(p_media_ids);
  IF p_media_ids IS NULL OR p_expected_revisions IS NULL
     OR n IS NULL OR n NOT BETWEEN 1 AND 100
     OR cardinality(p_expected_revisions) <> n
     OR (SELECT count(DISTINCT id) FROM unnest(p_media_ids) id) <> n
     OR p_add_tags IS NULL OR p_remove_tags IS NULL
     OR NOT app.media_tags_are_valid(p_add_tags)
     OR NOT app.media_tags_are_valid(p_remove_tags)
     OR EXISTS (SELECT 1 FROM unnest(p_add_tags) tag WHERE tag = ANY(p_remove_tags)) THEN
    RAISE EXCEPTION 'bulk media organization input is invalid' USING ERRCODE = 'CMS04';
  END IF;
  IF p_folder IS NOT NULL AND (
       p_folder <> btrim(p_folder) OR char_length(p_folder) > 200
       OR (p_folder <> '' AND p_folder !~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}(/[A-Za-z0-9][A-Za-z0-9 _-]{0,63})*$')) THEN
    RAISE EXCEPTION 'bulk media folder is invalid' USING ERRCODE = 'CMS04';
  END IF;

  -- Lock in a canonical order before inspecting any row. Concurrent bulk
  -- commands cannot deadlock merely because the browser selected in a
  -- different order.
  PERFORM 1 FROM public.media m WHERE m.id = ANY(p_media_ids) ORDER BY m.id FOR UPDATE;
  IF (SELECT count(*) FROM public.media m WHERE m.id = ANY(p_media_ids)) <> n THEN
    RAISE EXCEPTION 'one or more media items do not exist' USING ERRCODE = 'CMS03';
  END IF;

  FOR i IN 1..n LOOP
    SELECT * INTO row FROM public.media m WHERE m.id = p_media_ids[i];
    IF (row.site_id IS NULL AND NOT app.is_super_admin())
       OR (row.site_id IS NOT NULL AND NOT app.has_site_access(row.site_id)) THEN
      RAISE EXCEPTION 'not permitted to organize one or more media items' USING ERRCODE = 'CMS02';
    END IF;
    IF row.status <> 'ready' THEN
      RAISE EXCEPTION 'only ready media can be organized' USING ERRCODE = 'CMS04';
    END IF;
    IF row.revision <> p_expected_revisions[i] THEN
      RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revisions[i], row.revision
        USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
    END IF;
    SELECT coalesce(array_agg(DISTINCT tag ORDER BY tag), '{}'::text[]) INTO next_tags
      FROM unnest(row.tags || p_add_tags) tag WHERE NOT tag = ANY(p_remove_tags);
    IF NOT app.media_tags_are_valid(next_tags) THEN
      RAISE EXCEPTION 'bulk media tags exceed the governed limit' USING ERRCODE = 'CMS04';
    END IF;
    SELECT app.update_media_metadata(
      row.id, row.revision, row.alt_text, row.decorative, row.focal,
      coalesce(p_folder, row.folder), row.attribution, row.source, next_tags
    ) INTO next_revision;
    media_id := row.id; revision := next_revision; RETURN NEXT;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.bulk_soft_delete_media(
  p_media_ids uuid[], p_expected_revisions bigint[],
  p_break_references boolean, p_reason text
) RETURNS TABLE(media_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE n integer; i integer; next_revision bigint;
BEGIN
  PERFORM app.require_actor();
  n := cardinality(p_media_ids);
  IF p_media_ids IS NULL OR p_expected_revisions IS NULL
     OR n IS NULL OR n NOT BETWEEN 1 AND 50
     OR cardinality(p_expected_revisions) <> n
     OR (SELECT count(DISTINCT id) FROM unnest(p_media_ids) id) <> n
     OR p_break_references IS NULL THEN
    RAISE EXCEPTION 'bulk media deletion input is invalid' USING ERRCODE = 'CMS04';
  END IF;
  PERFORM 1 FROM public.media m WHERE m.id = ANY(p_media_ids) ORDER BY m.id FOR UPDATE;
  IF (SELECT count(*) FROM public.media m WHERE m.id = ANY(p_media_ids)) <> n THEN
    RAISE EXCEPTION 'one or more media items do not exist' USING ERRCODE = 'CMS03';
  END IF;
  FOR i IN 1..n LOOP
    SELECT app.soft_delete_media(
      p_media_ids[i], p_expected_revisions[i], p_break_references, p_reason
    ) INTO next_revision;
    media_id := p_media_ids[i]; revision := next_revision; RETURN NEXT;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION app.bulk_organize_media(
  uuid[],bigint[],text,text[],text[]
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.bulk_soft_delete_media(
  uuid[],bigint[],boolean,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bulk_organize_media(
  uuid[],bigint[],text,text[],text[]
) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.bulk_soft_delete_media(
  uuid[],bigint[],boolean,text
) TO cms_authenticated_user;

ALTER FUNCTION app.bulk_organize_media(
  uuid[],bigint[],text,text[],text[]
) OWNER TO cms_migration_owner;
ALTER FUNCTION app.bulk_soft_delete_media(
  uuid[],bigint[],boolean,text
) OWNER TO cms_migration_owner;
