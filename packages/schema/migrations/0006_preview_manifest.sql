-- 0006 — let the editor build a preview from the same code publishing uses.
--
-- The admin canvas renders a *draft*, and it must render it through exactly the
-- projection builder the publish command uses, or preview and live can drift —
-- the failure v1 spent scripts trying to prevent.
--
-- Granting EXECUTE on a SECURITY DEFINER function to an application role means
-- the function itself becomes the tenant boundary: it runs as the owner, so RLS
-- no longer filters anything for it. Until now build_render_manifest was only
-- ever called from inside publish_page, which had already authorized the actor.
-- Called directly it would happily build a manifest for any page version in the
-- database, so it now checks access itself before it reads anything.

CREATE OR REPLACE FUNCTION app.build_render_manifest(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; sections jsonb; expected int; resolved int;
BEGIN
  SELECT pv.id, pv.content, pv.meta, pv.page_id, pv.site_id, p.title, p.slug
    INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id = pv.page_id
   WHERE pv.id = p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;

  -- This function runs as its owner, so RLS is not filtering for it. The check
  -- has to be here, not left to whoever called.
  IF NOT app.has_site_access(v.site_id) THEN
    RAISE EXCEPTION 'not permitted to read this page version' USING ERRCODE = 'CMS02';
  END IF;

  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);

  SELECT COALESCE(jsonb_agg(entry ORDER BY ord), '[]'::jsonb), count(*)
    INTO sections, resolved
  FROM (
    SELECT inst.ord,
           jsonb_build_object(
             'instance', inst.value,
             'def', jsonb_build_object(
               'section_def_id', sdv.section_def_id,
               'version', sdv.version,
               'slug', sd.slug,
               'compiled_ast', sdv.compiled_ast,
               'css', sdv.source_css,
               'slots', sdv.slots,
               'sanitizer_policy_version', sdv.sanitizer_policy_version,
               'render_hash', sdv.render_hash)) AS entry
    FROM jsonb_array_elements(v.content) WITH ORDINALITY AS inst(value, ord)
    JOIN public.section_defs sd ON sd.id = (inst.value->>'section_def_id')::uuid
    JOIN public.section_def_versions sdv
      ON sdv.section_def_id = sd.id
     AND sdv.version = (inst.value->>'section_def_version')::int
  ) resolved_rows;

  IF resolved <> expected THEN
    RAISE EXCEPTION 'page version % references % section definition version(s) that do not exist',
      p_page_version_id, expected - resolved USING ERRCODE = 'CMS04';
  END IF;

  RETURN jsonb_build_object(
    'page', jsonb_build_object('id', v.page_id, 'version_id', v.id,
                               'title', v.title, 'path', app.page_path(v.slug)),
    'meta', v.meta,
    'sections', sections);
END
$$;

ALTER FUNCTION app.build_render_manifest(uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.build_render_manifest(uuid) TO cms_authenticated_user;
