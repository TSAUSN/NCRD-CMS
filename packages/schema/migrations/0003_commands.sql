-- 0003 — narrow state-transition commands (SPEC §4, §5, §6.8).
--
-- Every function here is SECURITY DEFINER with a pinned search_path, derives
-- its actor from the session GUC rather than an argument, checks tenancy and
-- the expected revision, and writes audit inside the same transaction as the
-- change. Execute grants are named one function at a time.
--
-- Typed failures use custom SQLSTATEs so the TypeScript layer can map them to
-- product errors instead of matching on message text:
--
--   CMS01 stale revision   CMS02 not authorized   CMS03 not found
--   CMS04 invalid state    CMS05 trusted code not approved

CREATE OR REPLACE FUNCTION app.require_actor() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.current_user_id();
  IF actor IS NULL THEN
    RAISE EXCEPTION 'no active product user for this session' USING ERRCODE = 'CMS02';
  END IF;
  RETURN actor;
END
$$;

-- The only writer of audit_log. Application roles hold no INSERT on the table,
-- so history can only be written next to the change that caused it.
CREATE OR REPLACE FUNCTION app.write_audit(
  p_site_id uuid, p_actor_type actor_type, p_actor_id uuid, p_action text,
  p_item_type text, p_item_id uuid, p_before uuid, p_after uuid, p_detail jsonb
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO public.audit_log (site_id, actor_type, actor_id, action, item_type, item_id,
                                before_ref, after_ref, detail, request_id)
  VALUES (p_site_id, p_actor_type, p_actor_id, p_action, p_item_type, p_item_id,
          p_before, p_after, COALESCE(p_detail, '{}'::jsonb), app.current_request_id())
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION app.emit_outbox(p_site_id uuid, p_event_type text, p_payload jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO public.outbox (site_id, event_type, payload)
  VALUES (p_site_id, p_event_type, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

-- ---------------------------------------------------------------- people --

CREATE OR REPLACE FUNCTION app.provision_user(p_email text, p_display_name text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; new_id uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may invite users' USING ERRCODE = 'CMS02';
  END IF;
  INSERT INTO public.app_users (email, display_name) VALUES (lower(p_email), COALESCE(p_display_name, ''))
  ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
  RETURNING id INTO new_id;
  PERFORM app.write_audit(NULL, 'user', actor, 'user.provision', 'app_user', new_id, NULL, NULL,
                          jsonb_build_object('email', lower(p_email)));
  RETURN new_id;
END
$$;

-- Attaching the verified auth subject is the moment an invite becomes a login.
-- It is deliberately not a membership change: a provider account with no
-- product record is authenticated and still not authorized (SPEC §6.1).
CREATE OR REPLACE FUNCTION app.attach_auth_subject(p_email text, p_auth_subject text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE target uuid;
BEGIN
  SELECT id INTO target FROM public.app_users WHERE email = lower(p_email) AND status = 'active';
  IF target IS NULL THEN
    RAISE EXCEPTION 'no active product user for %', lower(p_email) USING ERRCODE = 'CMS03';
  END IF;
  UPDATE public.app_users SET auth_subject = p_auth_subject
   WHERE id = target AND (auth_subject IS NULL OR auth_subject = p_auth_subject);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % is already attached to a different auth subject', target USING ERRCODE = 'CMS04';
  END IF;
  PERFORM app.write_audit(NULL, 'user', target, 'user.attach_auth_subject', 'app_user', target, NULL, NULL, '{}'::jsonb);
  RETURN target;
END
$$;

CREATE OR REPLACE FUNCTION app.set_site_membership(p_user_id uuid, p_site_id uuid, p_role site_role_name)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF NOT (app.is_super_admin() OR app.can_administer_site(p_site_id)) THEN
    RAISE EXCEPTION 'not permitted to change memberships on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF p_role IS NULL THEN
    DELETE FROM public.site_memberships WHERE user_id = p_user_id AND site_id = p_site_id;
  ELSE
    INSERT INTO public.site_memberships (user_id, site_id, role) VALUES (p_user_id, p_site_id, p_role)
    ON CONFLICT (user_id, site_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'membership.set', 'app_user', p_user_id, NULL, NULL,
                          jsonb_build_object('role', p_role));
END
$$;

CREATE OR REPLACE FUNCTION app.set_global_role(p_user_id uuid, p_role global_role_name)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may change global roles' USING ERRCODE = 'CMS02';
  END IF;
  IF p_role IS NULL THEN
    DELETE FROM public.global_roles WHERE user_id = p_user_id;
  ELSE
    INSERT INTO public.global_roles (user_id, role) VALUES (p_user_id, p_role)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;
  PERFORM app.write_audit(NULL, 'user', actor, 'global_role.set', 'app_user', p_user_id, NULL, NULL,
                          jsonb_build_object('role', p_role));
END
$$;

CREATE OR REPLACE FUNCTION app.set_user_status(p_user_id uuid, p_status user_status)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may change user status' USING ERRCODE = 'CMS02';
  END IF;
  UPDATE public.app_users SET status = p_status WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such user' USING ERRCODE = 'CMS03'; END IF;
  PERFORM app.write_audit(NULL, 'user', actor, 'user.set_status', 'app_user', p_user_id, NULL, NULL,
                          jsonb_build_object('status', p_status));
END
$$;

-- ----------------------------------------------------------------- sites --

CREATE OR REPLACE FUNCTION app.create_site(
  p_slug text, p_name text, p_kind site_kind, p_staging_hostname text,
  p_theme_tokens jsonb, p_nav_tree jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; new_site uuid; theme_head uuid; nav_head uuid; v uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may create sites' USING ERRCODE = 'CMS02';
  END IF;

  INSERT INTO public.sites (slug, name, kind, status, staging_hostname, created_by)
  VALUES (p_slug, p_name, p_kind, 'in_progress', lower(p_staging_hostname), actor)
  RETURNING id INTO new_site;

  -- A site is created with its singleton heads already present and published,
  -- so no later code has to cope with "site exists but has no theme yet".
  INSERT INTO public.themes (site_id) VALUES (new_site) RETURNING id INTO theme_head;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (new_site, theme_head, 1, p_theme_tokens, actor) RETURNING id INTO v;
  UPDATE public.themes SET revision = 1, draft_version_id = v, published_version_id = v WHERE id = theme_head;

  INSERT INTO public.navigations (site_id) VALUES (new_site) RETURNING id INTO nav_head;
  INSERT INTO public.navigation_versions (site_id, navigation_id, revision, tree, author_id)
  VALUES (new_site, nav_head, 1, COALESCE(p_nav_tree, '[]'::jsonb), actor) RETURNING id INTO v;
  UPDATE public.navigations SET revision = 1, draft_version_id = v, published_version_id = v WHERE id = nav_head;

  INSERT INTO public.site_settings (site_id) VALUES (new_site);

  PERFORM app.write_audit(new_site, 'user', actor, 'site.create', 'site', new_site, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'kind', p_kind));
  RETURN new_site;
END
$$;

-- ----------------------------------------------------------------- pages --

CREATE OR REPLACE FUNCTION app.create_page(p_site_id uuid, p_slug text, p_title text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; new_page uuid;
BEGIN
  actor := app.require_actor();
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage pages on this site' USING ERRCODE = 'CMS02';
  END IF;
  INSERT INTO public.pages (site_id, slug, title) VALUES (p_site_id, lower(p_slug), p_title)
  RETURNING id INTO new_page;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'page.create', 'page', new_page, NULL, NULL,
                          jsonb_build_object('slug', lower(p_slug)));
  RETURN new_page;
END
$$;

-- The compare-and-set save (SPEC §5). One transaction: lock the head, compare
-- the revision the editor loaded, insert the immutable version, advance the
-- draft pointer, audit. A mismatch raises CMS01 carrying the current revision
-- so the editor can keep its local draft and offer a diff.
--
-- carries_trusted_code is recomputed here from the payload. A client-supplied
-- flag is never read (SPEC §4).
CREATE OR REPLACE FUNCTION app.save_page_draft(
  p_page_id uuid, p_expected_revision bigint, p_content jsonb, p_meta jsonb,
  p_kind version_kind DEFAULT 'autosave', p_note text DEFAULT ''
) RETURNS TABLE (version_id uuid, revision bigint, carries_trusted_code boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint; new_version uuid; trusted boolean;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.archived_at INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to edit this page' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  trusted := app.content_carries_trusted_code(p_content);
  next_rev := head.revision + 1;

  INSERT INTO public.page_versions (site_id, page_id, revision, content, meta,
                                    carries_trusted_code, kind, note, author_id)
  VALUES (head.site_id, p_page_id, next_rev, p_content, COALESCE(p_meta, '{}'::jsonb),
          trusted, p_kind, COALESCE(p_note, ''), actor)
  RETURNING id INTO new_version;

  UPDATE public.pages SET revision = next_rev, draft_version_id = new_version WHERE id = p_page_id;

  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.save_draft', 'page', p_page_id,
                          NULL, new_version,
                          jsonb_build_object('revision', next_rev, 'kind', p_kind,
                                             'carries_trusted_code', trusted));
  RETURN QUERY SELECT new_version, next_rev, trusted;
END
$$;

-- Raw markup detection, server-side and recomputed on every save. Any section
-- instance carrying custom CSS or a raw-HTML escape hatch marks the version.
CREATE OR REPLACE FUNCTION app.content_carries_trusted_code(p_content jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(bool_or(
    (s ? 'raw_html' AND length(btrim(COALESCE(s->>'raw_html', ''))) > 0)
    OR (s ? 'custom_css' AND length(btrim(COALESCE(s->>'custom_css', ''))) > 0)
  ), false)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_content) = 'array' THEN p_content ELSE '[]'::jsonb END) AS s
$$;

CREATE OR REPLACE FUNCTION app.approve_trusted_code(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; v RECORD;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may approve raw markup' USING ERRCODE = 'CMS02';
  END IF;
  SELECT id, site_id, page_id INTO v FROM public.page_versions WHERE id = p_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such version' USING ERRCODE = 'CMS03'; END IF;
  UPDATE public.page_versions
     SET trusted_code_approved_by = actor, trusted_code_approved_at = now()
   WHERE id = p_version_id;
  PERFORM app.write_audit(v.site_id, 'user', actor, 'page.approve_trusted_code', 'page', v.page_id,
                          NULL, p_version_id, '{}'::jsonb);
END
$$;

-- ------------------------------------------------------------ publication --

CREATE OR REPLACE FUNCTION app.page_path(p_slug text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN COALESCE(p_slug, '') = '' THEN '/' ELSE '/' || p_slug END
$$;

-- The site shell: theme tokens, navigation, and the live header/footer, in one
-- public-safe row. Derived here rather than accepted as an argument, so no
-- caller can push a payload the authoring tables do not actually support.
CREATE OR REPLACE FUNCTION app.rebuild_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE payload jsonb; next_rev bigint;
BEGIN
  SELECT jsonb_build_object(
    'site', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'kind', s.kind),
    'theme', COALESCE((SELECT tv.tokens FROM public.themes t
                        JOIN public.theme_versions tv ON tv.id = t.published_version_id
                       WHERE t.site_id = s.id), '{}'::jsonb),
    'navigation', COALESCE((SELECT nv.tree FROM public.navigations n
                             JOIN public.navigation_versions nv ON nv.id = n.published_version_id
                            WHERE n.site_id = s.id), '[]'::jsonb),
    'header', (SELECT gv.content FROM public.global_elements g
                JOIN public.global_element_versions gv ON gv.id = g.published_version_id
               WHERE g.site_id = s.id AND g.kind = 'header' AND g.use_on_live),
    'footer', (SELECT gv.content FROM public.global_elements g
                JOIN public.global_element_versions gv ON gv.id = g.published_version_id
               WHERE g.site_id = s.id AND g.kind = 'footer' AND g.use_on_live),
    -- A live primary domain flips the canonical base for the whole site; until
    -- then the staging host serves and stays noindex (SPEC §6.10).
    'canonical_host', (SELECT d.hostname_normalized FROM public.domains d
                        WHERE d.site_id = s.id AND d.kind = 'primary' AND d.status = 'live'
                        ORDER BY d.created_at LIMIT 1),
    'staging_host', s.staging_hostname
  ) INTO payload
  FROM public.sites s WHERE s.id = p_site_id;

  IF payload IS NULL THEN RAISE EXCEPTION 'no such site' USING ERRCODE = 'CMS03'; END IF;

  INSERT INTO public.published_site_shells (site_id, revision, payload, updated_at)
  VALUES (p_site_id, 1, payload, now())
  ON CONFLICT (site_id) DO UPDATE
    SET revision = public.published_site_shells.revision + 1,
        payload = EXCLUDED.payload, updated_at = now()
  RETURNING revision INTO next_rev;
  RETURN next_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.ensure_site_shell(p_site_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE rev bigint;
BEGIN
  SELECT revision INTO rev FROM public.published_site_shells WHERE site_id = p_site_id;
  IF rev IS NULL THEN rev := app.rebuild_site_shell(p_site_id); END IF;
  RETURN rev;
END
$$;

-- The render manifest: every section instance resolved against the *pinned*
-- definition version, flattened into one row the public renderer can serve
-- without joining anything. Order is preserved by ordinality.
--
-- A section instance whose pinned definition version is missing is a rendering
-- failure, and rendering failure is a blocking readiness rule (SPEC §6.8) — so
-- it raises here instead of publishing a page with a hole in it.
CREATE OR REPLACE FUNCTION app.build_render_manifest(p_page_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v RECORD; sections jsonb; expected int; resolved int;
BEGIN
  SELECT pv.id, pv.content, pv.meta, pv.page_id, p.title, p.slug
    INTO v
    FROM public.page_versions pv JOIN public.pages p ON p.id = pv.page_id
   WHERE pv.id = p_page_version_id;
  IF v IS NULL THEN RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03'; END IF;

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

-- The one publication command (SPEC §6.8). Editor Publish, review approval,
-- whole-site release, restore-and-publish, import, and the scheduler all end
-- up here; no surface is allowed to reconstruct this sequence.
--
-- Concurrency: the head row is locked and its revision compared, then advanced.
-- Two simultaneous publishes at the same expected revision therefore produce
-- exactly one winner and one CMS01 conflict. Advancing the head's revision does
-- not create a version row — publishing points at content, it never rewrites it.
CREATE OR REPLACE FUNCTION app.publish_page(
  p_page_id uuid, p_expected_revision bigint,
  p_readiness_policy_version int DEFAULT 1,
  p_override_reason text DEFAULT NULL,
  p_readiness jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE (published_version_id uuid, revision bigint, path text, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
-- The OUT names above are the ones callers want to read, and they shadow real
-- columns inside this body. Resolve such references to the column; the values
-- returned come from the local variables below, which do not collide.
#variable_conflict use_column
DECLARE
  actor uuid; head RECORD; src RECORD; site RECORD;
  next_rev bigint; manifest jsonb; shell_rev bigint; page_path text;
BEGIN
  actor := app.require_actor();

  SELECT p.id, p.site_id, p.revision, p.slug, p.draft_version_id, p.published_version_id, p.archived_at
    INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;

  -- Reauthorize at execution time, not at scheduling time: a schedule created
  -- by someone who has since lost the capability must fail closed.
  IF NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'page is archived' USING ERRCODE = 'CMS04';
  END IF;

  SELECT s.id, s.status INTO site FROM public.sites s WHERE s.id = head.site_id;
  IF site.status = 'archived' THEN
    RAISE EXCEPTION 'site is archived' USING ERRCODE = 'CMS04';
  END IF;

  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  IF head.draft_version_id IS NULL THEN
    RAISE EXCEPTION 'page has no draft to publish' USING ERRCODE = 'CMS04';
  END IF;

  SELECT pv.id, pv.carries_trusted_code, pv.trusted_code_approved_by
    INTO src FROM public.page_versions pv WHERE pv.id = head.draft_version_id;

  -- Recomputed, never trusted from the client, and checked again here even
  -- though the save already stamped it (SPEC §4).
  IF src.carries_trusted_code AND src.trusted_code_approved_by IS NULL THEN
    RAISE EXCEPTION 'version carries raw markup and needs super-admin approval'
      USING ERRCODE = 'CMS05';
  END IF;

  manifest := app.build_render_manifest(src.id);
  shell_rev := app.ensure_site_shell(head.site_id);
  page_path := app.page_path(head.slug);
  next_rev := head.revision + 1;

  UPDATE public.pages
     SET published_version_id = src.id, revision = next_rev, status = 'published'
   WHERE id = p_page_id;

  -- Public projection, published pointer, audit, and outbox all commit together
  -- or not at all. Downstream invalidation can fail and retry without ever
  -- losing the publication itself.
  INSERT INTO public.published_routes
    (site_id, path, page_id, page_version_id, shell_revision, render_manifest, updated_at)
  VALUES (head.site_id, page_path, p_page_id, src.id, shell_rev, manifest, now())
  ON CONFLICT (site_id, path) DO UPDATE
    SET page_id = EXCLUDED.page_id, page_version_id = EXCLUDED.page_version_id,
        shell_revision = EXCLUDED.shell_revision, render_manifest = EXCLUDED.render_manifest,
        updated_at = now();

  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.publish', 'page', p_page_id,
                          head.published_version_id, src.id,
                          jsonb_build_object('revision', next_rev, 'path', page_path,
                                             'readiness_policy_version', p_readiness_policy_version,
                                             'override_reason', p_override_reason,
                                             'readiness', p_readiness));

  PERFORM app.emit_outbox(head.site_id, 'page.published',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path,
                                             'revision', next_rev, 'shell_revision', shell_rev));

  RETURN QUERY SELECT src.id, next_rev, page_path, shell_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.unpublish_page(p_page_id uuid, p_expected_revision bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; next_rev bigint; page_path text;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision, p.slug, p.published_version_id INTO head
    FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to publish on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  page_path := app.page_path(head.slug);
  next_rev := head.revision + 1;

  -- Routing is revoked before anything else, so an unpublished page stops
  -- being reachable even if a downstream cache purge is delayed.
  DELETE FROM public.published_routes WHERE site_id = head.site_id AND path = page_path;
  UPDATE public.pages SET published_version_id = NULL, revision = next_rev, status = 'draft'
   WHERE id = p_page_id;

  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.unpublish', 'page', p_page_id,
                          head.published_version_id, NULL,
                          jsonb_build_object('revision', next_rev, 'path', page_path));
  PERFORM app.emit_outbox(head.site_id, 'page.unpublished',
                          jsonb_build_object('page_id', p_page_id, 'path', page_path, 'revision', next_rev));
  RETURN next_rev;
END
$$;

-- Restore is v1's exact semantics: it never republishes and never edits a
-- historical version — it creates a new draft from one (SPEC §6.3).
CREATE OR REPLACE FUNCTION app.restore_version_as_draft(
  p_page_id uuid, p_expected_revision bigint, p_source_version_id uuid, p_note text DEFAULT ''
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; head RECORD; src RECORD; next_rev bigint; new_version uuid;
BEGIN
  actor := app.require_actor();
  SELECT p.id, p.site_id, p.revision INTO head FROM public.pages p WHERE p.id = p_page_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no such page' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN
    RAISE EXCEPTION 'not permitted to edit this page' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;

  SELECT pv.id, pv.content, pv.meta INTO src
    FROM public.page_versions pv WHERE pv.id = p_source_version_id AND pv.page_id = p_page_id;
  IF src IS NULL THEN
    RAISE EXCEPTION 'version does not belong to this page' USING ERRCODE = 'CMS03';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.page_versions (site_id, page_id, revision, content, meta,
                                    carries_trusted_code, kind, note, author_id)
  VALUES (head.site_id, p_page_id, next_rev, src.content, src.meta,
          app.content_carries_trusted_code(src.content), 'restore', COALESCE(p_note, ''), actor)
  RETURNING id INTO new_version;

  UPDATE public.pages SET revision = next_rev, draft_version_id = new_version WHERE id = p_page_id;
  PERFORM app.write_audit(head.site_id, 'user', actor, 'page.restore', 'page', p_page_id,
                          p_source_version_id, new_version, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT new_version, next_rev;
END
$$;

-- ------------------------------------------------------ section definitions --

CREATE OR REPLACE FUNCTION app.upsert_section_def_version(
  p_slug text, p_name text, p_category text,
  p_source_html text, p_source_css text, p_compiled_ast jsonb, p_slots jsonb,
  p_render_hash text, p_sanitizer_policy_version int, p_changelog text,
  p_carries_trusted_code boolean DEFAULT false
) RETURNS TABLE (section_def_id uuid, version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; def_id uuid; next_version int;
BEGIN
  actor := app.require_actor();
  IF NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may author section definitions' USING ERRCODE = 'CMS02';
  END IF;

  SELECT id INTO def_id FROM public.section_defs WHERE scope = 'global' AND slug = p_slug;
  IF def_id IS NULL THEN
    INSERT INTO public.section_defs (scope, slug, name, category, created_by)
    VALUES ('global', p_slug, p_name, COALESCE(p_category, ''), actor) RETURNING id INTO def_id;
  ELSE
    UPDATE public.section_defs SET name = p_name, category = COALESCE(p_category, '') WHERE id = def_id;
  END IF;

  -- Editing a definition always creates version N+1; pages pinned to N keep
  -- rendering N until someone deliberately upgrades them (SPEC §6.5).
  SELECT COALESCE(max(v.version), 0) + 1 INTO next_version
    FROM public.section_def_versions v WHERE v.section_def_id = def_id;

  INSERT INTO public.section_def_versions
    (section_def_id, version, source_html, source_css, compiled_ast, slots,
     sanitizer_policy_version, render_hash, carries_trusted_code, changelog, created_by)
  VALUES (def_id, next_version, p_source_html, COALESCE(p_source_css, ''), p_compiled_ast,
          COALESCE(p_slots, '[]'::jsonb), COALESCE(p_sanitizer_policy_version, 1), p_render_hash,
          COALESCE(p_carries_trusted_code, false), COALESCE(p_changelog, ''), actor);

  PERFORM app.write_audit(NULL, 'user', actor, 'section_def.version', 'section_def', def_id, NULL, NULL,
                          jsonb_build_object('slug', p_slug, 'version', next_version));
  RETURN QUERY SELECT def_id, next_version;
END
$$;

-- ------------------------------------------------------------ worker only --

CREATE OR REPLACE FUNCTION app.worker_heartbeat(p_worker_id text, p_role text, p_version text)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE seen timestamptz;
BEGIN
  INSERT INTO public.job_heartbeats (worker_id, role, version)
  VALUES (p_worker_id, COALESCE(p_role, 'worker'), COALESCE(p_version, ''))
  ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = now(), version = EXCLUDED.version
  RETURNING last_seen_at INTO seen;
  RETURN seen;
END
$$;

-- One lease per due schedule. FOR UPDATE SKIP LOCKED means two runners never
-- contend for the same row, and an expired lease is reclaimable (SPEC §6.8).
CREATE OR REPLACE FUNCTION app.claim_scheduled_action(p_worker_id text, p_lease_seconds int)
RETURNS TABLE (id uuid, site_id uuid, item_type reviewable_type, item_id uuid,
               version_id uuid, action scheduled_action_kind, created_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.scheduled_actions sa
     SET status = 'running', leased_by = p_worker_id,
         leased_until = now() + make_interval(secs => COALESCE(p_lease_seconds, 60)),
         attempt_count = sa.attempt_count + 1
   WHERE sa.id = (
     SELECT c.id FROM public.scheduled_actions c
      WHERE c.run_at <= now()
        AND (c.status = 'pending' OR (c.status = 'running' AND c.leased_until < now()))
      ORDER BY c.run_at
      FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING sa.id, sa.site_id, sa.item_type, sa.item_id, sa.version_id, sa.action, sa.created_by;
END
$$;

CREATE OR REPLACE FUNCTION app.complete_scheduled_action(
  p_id uuid, p_worker_id text, p_status scheduled_status, p_error text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row RECORD;
BEGIN
  IF p_status NOT IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'not a terminal status' USING ERRCODE = 'CMS04';
  END IF;
  -- A runner can only close out a schedule it currently holds the lease on, so
  -- "mark it succeeded" is not something an unrelated caller can assert.
  UPDATE public.scheduled_actions
     SET status = p_status, last_error = p_error, finished_at = now()
   WHERE id = p_id AND leased_by = p_worker_id AND status = 'running'
  RETURNING site_id, item_id INTO row;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no running schedule % leased by %', p_id, p_worker_id USING ERRCODE = 'CMS04';
  END IF;
  PERFORM app.write_audit(row.site_id, 'scheduler', NULL, 'schedule.' || p_status, 'scheduled_action',
                          p_id, NULL, NULL, jsonb_build_object('error', p_error, 'worker', p_worker_id));
END
$$;

CREATE OR REPLACE FUNCTION app.claim_outbox(p_limit int)
RETURNS TABLE (id bigint, site_id uuid, event_type text, payload jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT o.id, o.site_id, o.event_type, o.payload
    FROM public.outbox o
   WHERE o.processed_at IS NULL
   ORDER BY o.id
   LIMIT COALESCE(p_limit, 50)
$$;

CREATE OR REPLACE FUNCTION app.settle_outbox(p_id bigint, p_ok boolean, p_error text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.outbox
     SET processed_at = CASE WHEN p_ok THEN now() ELSE NULL END,
         attempts = attempts + 1,
         last_error = CASE WHEN p_ok THEN NULL ELSE p_error END
   WHERE id = p_id;
END
$$;

-- ------------------------------------------------------------ execute grants --
--
-- Named one at a time. A function not listed here is unreachable from every
-- application role, which is the default this file wants.

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.provision_user(text, text),
  app.attach_auth_subject(text, text),
  app.set_site_membership(uuid, uuid, site_role_name),
  app.set_global_role(uuid, global_role_name),
  app.set_user_status(uuid, user_status),
  app.create_site(text, text, site_kind, text, jsonb, jsonb),
  app.create_page(uuid, text, text),
  app.save_page_draft(uuid, bigint, jsonb, jsonb, version_kind, text),
  app.approve_trusted_code(uuid),
  app.publish_page(uuid, bigint, int, text, jsonb),
  app.unpublish_page(uuid, bigint),
  app.restore_version_as_draft(uuid, bigint, uuid, text),
  app.rebuild_site_shell(uuid),
  app.upsert_section_def_version(text, text, text, text, text, jsonb, jsonb, text, int, text, boolean)
TO cms_authenticated_user;

GRANT EXECUTE ON FUNCTION
  app.worker_heartbeat(text, text, text),
  app.claim_scheduled_action(text, int),
  app.complete_scheduled_action(uuid, text, scheduled_status, text),
  app.claim_outbox(int),
  app.settle_outbox(bigint, boolean, text),
  app.publish_page(uuid, bigint, int, text, jsonb),
  app.unpublish_page(uuid, bigint),
  app.current_user_id(), app.current_worker_id(), app.current_request_id()
TO cms_worker;
