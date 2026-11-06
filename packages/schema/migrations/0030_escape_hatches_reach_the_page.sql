-- 0030 — the two escape hatches reach the renderer.
--
-- SPEC §6.4 keeps v1's escape hatches and gates them: "per-block Custom CSS
-- (parsed, scoped by block id, and linted); Edit HTML makes the UI derive
-- `carries_trusted_code` and shows the super-admin-review notice inline at the
-- moment of use. The publish command independently recomputes the marker and
-- never trusts the client flag."
--
-- Every part of that governance was built and none of it was reachable, because
-- the manifest did not carry either field. `app.content_carries_trusted_code`
-- reads `raw_html` and `custom_css` off the stored content and marks the
-- version; `app.approve_trusted_code` is super-admin-only; the trigger
-- `pages_trusted_code_publication` refuses to publish a marked version nobody
-- approved. All three worked. But `app.build_render_manifest_internal` built
-- its `instance` object from four keys — label, hidden, hidden_at, values — so
-- whatever an author put in either hatch was stored, was enough to require a
-- super admin's approval of the page, and then rendered as nothing at all.
--
-- That is the worst of the three possible states. An unimplemented feature
-- teaches you it is unimplemented the first time you try it. This one accepted
-- the work, escalated the page to needing review, and dropped the result — so
-- the review was of markup that was never going to appear, and the author's
-- evidence that it had not appeared was a page that looked unchanged.
--
-- So both fields travel with the instance now, and the renderer does what the
-- approval is an approval of: `custom_css` is scoped to `#s<index>` and refused
-- whole if the CSS policy blocks any of it, and `raw_html` replaces that
-- instance's body verbatim, inside the same wrapper, so the block id, the
-- section classes and the hide-at-breakpoint classes all still apply.
--
-- Nothing here widens a policy. No new value becomes publishable that was not
-- publishable before; what changes is that a value which was already enough to
-- demand a super admin's approval now also renders, which is the only reading
-- under which demanding the approval made sense.
--
-- COALESCE to '' rather than leaving NULL: the renderer trims and compares, and
-- a JSON null reaching a `.trim()` is a different bug in a different file.

CREATE OR REPLACE FUNCTION app.build_render_manifest_internal(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; sections jsonb; expected int; resolved int; stale text;
BEGIN
  SELECT pv.id, pv.content, pv.meta, pv.page_id, pv.site_id, p.title, p.slug
    INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id = pv.page_id
   WHERE pv.id = p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;

  SELECT count(*) INTO expected FROM jsonb_array_elements(v.content);

  SELECT jsonb_agg(jsonb_build_object(
           'def', jsonb_build_object(
             'section_def_id', d.id, 'version', dv.version, 'slug', d.slug,
             'compiled_ast', dv.compiled_ast,
             'css', dv.compiled_css, 'slots', dv.slots,
             'render_hash', dv.render_hash,
             'sanitizer_policy_version', dv.sanitizer_policy_version,
             'css_policy_version', dv.css_policy_version,
             -- The discriminator travels with the definition. A manifest that
             -- carried the document but not the kind would make the renderer
             -- work out which model it was looking at, which is the inference
             -- this column exists to remove.
             'definition_kind', dv.definition_kind,
             'structured_doc', dv.structured_doc,
             'structured_schema_version', dv.structured_schema_version),
           'instance', jsonb_build_object(
             'label', item.value ->> 'label',
             'hidden', COALESCE((item.value ->> 'hidden')::boolean, false),
             'hidden_at', COALESCE(item.value -> 'hidden_at', '[]'::jsonb),
             'values', COALESCE(item.value -> 'values', '{}'::jsonb),
             -- The two escape hatches. Exactly the two keys
             -- `app.content_carries_trusted_code` looks for, read here with the
             -- same `->>` it uses, so a value that marks a version for review
             -- is the same value that reaches the page.
             'custom_css', COALESCE(item.value ->> 'custom_css', ''),
             'raw_html', COALESCE(item.value ->> 'raw_html', ''))
         ) ORDER BY item.ordinality)
    INTO sections
    FROM jsonb_array_elements(v.content) WITH ORDINALITY AS item(value, ordinality)
    JOIN public.section_defs d ON d.id = (item.value ->> 'section_def_id')::uuid
    JOIN public.section_def_versions dv
      ON dv.section_def_id = d.id AND dv.version = (item.value ->> 'section_def_version')::int;

  resolved := COALESCE(jsonb_array_length(sections), 0);
  IF resolved <> expected THEN
    RAISE EXCEPTION 'page version % refers to % sections but only % resolve',
      p_page_version_id, expected, resolved USING ERRCODE = 'CMS04';
  END IF;

  SELECT string_agg(DISTINCT (s -> 'def' ->> 'slug') || ' (' || defect || ')', '; ')
    INTO stale
    FROM jsonb_array_elements(COALESCE(sections, '[]'::jsonb)) AS s
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        app.structured_section_defect(s -> 'def' ->> 'definition_kind',
                                      s -> 'def' -> 'structured_doc',
                                      (s -> 'def' ->> 'structured_schema_version')::int),
        app.render_ast_defect(s -> 'def' -> 'compiled_ast',
                              (s -> 'def' ->> 'sanitizer_policy_version')::int),
        app.compiled_css_defect(s -> 'def' ->> 'css',
                                (s -> 'def' ->> 'css_policy_version')::int,
                                '.cms-section--' || (s -> 'def' ->> 'slug'))) AS defect) AS d
   WHERE d.defect IS NOT NULL;
  IF stale IS NOT NULL THEN
    RAISE EXCEPTION 'this page uses a section that needs revalidating: %', stale
      USING ERRCODE = 'CMS04';
  END IF;

  RETURN jsonb_build_object(
    'page', jsonb_build_object('id', v.page_id, 'version_id', v.id, 'title', v.title,
                               'path', app.page_path(v.slug)),
    'meta', COALESCE(v.meta, '{}'::jsonb),
    'sections', COALESCE(sections, '[]'::jsonb));
END
$$;

ALTER FUNCTION app.build_render_manifest_internal(uuid) OWNER TO cms_migration_owner;
