-- 0045 — versioned header and footer workspace.
--
-- Header and footer are published as one site-shell decision. Their enabled
-- state lives in immutable content; the legacy use_on_live column is no longer
-- a source of truth. Existing sites receive explicit versions matching the
-- baseline shell that the renderer previously supplied implicitly.

CREATE OR REPLACE FUNCTION app.global_link_defect(p_link jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE target jsonb; value text;
BEGIN
  IF jsonb_typeof(p_link) IS DISTINCT FROM 'object'
     OR (p_link - ARRAY['label','target']) <> '{}'::jsonb
     OR NOT (p_link ?& ARRAY['label','target']) THEN
    RETURN 'a global-element link must contain exactly label and target';
  END IF;
  IF jsonb_typeof(p_link->'label') IS DISTINCT FROM 'string'
     OR btrim(p_link->>'label') = '' OR char_length(p_link->>'label') > 80 THEN
    RETURN 'a global-element link label must be between 1 and 80 characters';
  END IF;
  target := p_link->'target';
  IF jsonb_typeof(target) IS DISTINCT FROM 'object' THEN RETURN 'a link target is not an object'; END IF;
  IF target->>'type' = 'page' THEN
    IF (target - ARRAY['type','page_id']) <> '{}'::jsonb
       OR jsonb_typeof(target->'page_id') IS DISTINCT FROM 'string'
       OR NOT (target->>'page_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN
      RETURN 'a page link target is invalid';
    END IF;
  ELSIF target->>'type' = 'url' THEN
    value := target->>'url';
    IF (target - ARRAY['type','url']) <> '{}'::jsonb
       OR jsonb_typeof(target->'url') IS DISTINCT FROM 'string'
       OR btrim(value) = '' OR char_length(value) > 2048
       OR value ~ '[[:space:]\\]'
       OR value ~* '^https://[^/]*@'
       OR NOT ((starts_with(value, '/') AND NOT starts_with(value, '//'))
               OR value ~* '^https://([^/?#@[:space:]\\]+|\[[0-9a-f:]+\])(?::[0-9]{1,5})?([/?#]|$)') THEN
      RETURN 'a URL target must be an internal path or credential-free https URL';
    END IF;
  ELSE
    RETURN 'a link target has an unknown type';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.global_header_defect(p_content jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE brand jsonb; link jsonb; defect text; media_value jsonb;
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
     OR (p_content - ARRAY['schemaVersion','enabled','preset','brand','surface','sticky','utilityLinks','cta']) <> '{}'::jsonb
     OR NOT (p_content ?& ARRAY['schemaVersion','enabled','preset','brand','surface','sticky','utilityLinks','cta']) THEN
    RETURN 'header must contain exactly the version-1 header properties';
  END IF;
  IF p_content->'schemaVersion' <> '1'::jsonb THEN RETURN 'header schemaVersion must be 1'; END IF;
  IF jsonb_typeof(p_content->'enabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_content->'sticky') IS DISTINCT FROM 'boolean' THEN
    RETURN 'header enabled and sticky must be booleans';
  END IF;
  IF jsonb_typeof(p_content->'preset') IS DISTINCT FROM 'string'
     OR p_content->>'preset' NOT IN ('standard','centered','compact','minimal') THEN
    RETURN 'header preset is unsupported';
  END IF;
  IF jsonb_typeof(p_content->'surface') IS DISTINCT FROM 'string'
     OR p_content->>'surface' NOT IN ('page','soft','primary','accent','transparent') THEN
    RETURN 'header surface is unsupported';
  END IF;
  brand := p_content->'brand';
  IF jsonb_typeof(brand) IS DISTINCT FROM 'object'
     OR (brand - ARRAY['siteName','showName','logoMediaId','compactLogoMediaId']) <> '{}'::jsonb
     OR NOT (brand ?& ARRAY['siteName','showName','logoMediaId','compactLogoMediaId']) THEN
    RETURN 'header brand must contain exactly siteName, showName, logoMediaId, and compactLogoMediaId';
  END IF;
  IF jsonb_typeof(brand->'siteName') IS DISTINCT FROM 'string'
     OR char_length(brand->>'siteName') > 120
     OR jsonb_typeof(brand->'showName') IS DISTINCT FROM 'boolean' THEN
    RETURN 'header brand name is invalid';
  END IF;
  FOREACH media_value IN ARRAY ARRAY[brand->'logoMediaId', brand->'compactLogoMediaId'] LOOP
    IF jsonb_typeof(media_value) NOT IN ('null','string')
       OR (jsonb_typeof(media_value) = 'string'
           AND NOT (media_value #>> '{}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')) THEN
      RETURN 'header logo references must be UUIDs or null';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_content->'utilityLinks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_content->'utilityLinks') > 4 THEN
    RETURN 'header utilityLinks must contain at most 4 links';
  END IF;
  FOR link IN SELECT value FROM jsonb_array_elements(p_content->'utilityLinks') LOOP
    defect := app.global_link_defect(link); IF defect IS NOT NULL THEN RETURN defect; END IF;
  END LOOP;
  IF jsonb_typeof(p_content->'cta') <> 'null' THEN
    defect := app.global_link_defect(p_content->'cta'); IF defect IS NOT NULL THEN RETURN defect; END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.global_footer_defect(p_content jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE brand jsonb; group_row jsonb; link jsonb; contact jsonb; social_row jsonb;
        legal jsonb; legal_link jsonb; key text; defect text;
BEGIN
  IF jsonb_typeof(p_content) IS DISTINCT FROM 'object'
     OR (p_content - ARRAY['schemaVersion','enabled','preset','brand','groups','contact','social','legal']) <> '{}'::jsonb
     OR NOT (p_content ?& ARRAY['schemaVersion','enabled','preset','brand','groups','contact','social','legal']) THEN
    RETURN 'footer must contain exactly the version-1 footer properties';
  END IF;
  IF p_content->'schemaVersion' <> '1'::jsonb THEN RETURN 'footer schemaVersion must be 1'; END IF;
  IF jsonb_typeof(p_content->'enabled') IS DISTINCT FROM 'boolean' THEN RETURN 'footer enabled must be boolean'; END IF;
  IF jsonb_typeof(p_content->'preset') IS DISTINCT FROM 'string'
     OR p_content->>'preset' NOT IN ('simple','columns','contact') THEN
    RETURN 'footer preset is unsupported';
  END IF;
  brand := p_content->'brand';
  IF jsonb_typeof(brand) IS DISTINCT FROM 'object'
     OR (brand - ARRAY['siteName','blurb','showFoundation']) <> '{}'::jsonb
     OR NOT (brand ?& ARRAY['siteName','blurb','showFoundation'])
     OR jsonb_typeof(brand->'siteName') IS DISTINCT FROM 'string'
     OR char_length(brand->>'siteName') > 120
     OR jsonb_typeof(brand->'blurb') IS DISTINCT FROM 'string'
     OR char_length(brand->>'blurb') > 500
     OR jsonb_typeof(brand->'showFoundation') IS DISTINCT FROM 'boolean' THEN
    RETURN 'footer brand is invalid';
  END IF;
  IF jsonb_typeof(p_content->'groups') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_content->'groups') > 4 THEN RETURN 'footer groups must contain at most 4 groups'; END IF;
  FOR group_row IN SELECT value FROM jsonb_array_elements(p_content->'groups') LOOP
    IF jsonb_typeof(group_row) IS DISTINCT FROM 'object'
       OR (group_row - ARRAY['heading','links']) <> '{}'::jsonb
       OR NOT (group_row ?& ARRAY['heading','links'])
       OR jsonb_typeof(group_row->'heading') IS DISTINCT FROM 'string'
       OR btrim(group_row->>'heading') = '' OR char_length(group_row->>'heading') > 80
       OR jsonb_typeof(group_row->'links') IS DISTINCT FROM 'array'
       OR jsonb_array_length(group_row->'links') > 6 THEN RETURN 'a footer group is invalid'; END IF;
    FOR link IN SELECT value FROM jsonb_array_elements(group_row->'links') LOOP
      defect := app.global_link_defect(link); IF defect IS NOT NULL THEN RETURN defect; END IF;
    END LOOP;
  END LOOP;
  contact := p_content->'contact';
  IF jsonb_typeof(contact) <> 'null' THEN
    IF jsonb_typeof(contact) IS DISTINCT FROM 'object'
       OR (contact - ARRAY['heading','address','email','phone']) <> '{}'::jsonb
       OR contact = '{}'::jsonb THEN RETURN 'footer contact is invalid'; END IF;
    FOR key IN SELECT jsonb_object_keys(contact) LOOP
      IF jsonb_typeof(contact->key) IS DISTINCT FROM 'string'
         OR btrim(contact->>key) = ''
         OR char_length(contact->>key) > (CASE key WHEN 'heading' THEN 80 WHEN 'email' THEN 254 ELSE 300 END)
         OR (key = 'email' AND NOT (contact->>key ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) THEN
        RETURN 'a footer contact field is invalid';
      END IF;
    END LOOP;
    IF NOT (contact ?| ARRAY['address','email','phone']) THEN
      RETURN 'footer contact needs an address, email, or phone';
    END IF;
  END IF;
  IF jsonb_typeof(p_content->'social') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_content->'social') > 6 THEN RETURN 'footer social must contain at most 6 links'; END IF;
  FOR social_row IN SELECT value FROM jsonb_array_elements(p_content->'social') LOOP
    IF jsonb_typeof(social_row) IS DISTINCT FROM 'object'
       OR (social_row - ARRAY['service','url']) <> '{}'::jsonb
       OR NOT (social_row ?& ARRAY['service','url'])
       OR jsonb_typeof(social_row->'service') IS DISTINCT FROM 'string'
       OR social_row->>'service' NOT IN ('facebook','instagram','youtube','linkedin','x','tiktok')
       OR jsonb_typeof(social_row->'url') IS DISTINCT FROM 'string'
       OR char_length(social_row->>'url') > 2048
       OR social_row->>'url' ~ '[[:space:]\\]'
       OR social_row->>'url' ~* '^https://[^/]*@'
       OR NOT (social_row->>'url' ~* '^https://([^/?#@[:space:]\\]+|\[[0-9a-f:]+\])(?::[0-9]{1,5})?([/?#]|$)')
      THEN RETURN 'a footer social link is invalid'; END IF;
  END LOOP;
  legal := p_content->'legal';
  IF jsonb_typeof(legal) IS DISTINCT FROM 'object'
     OR (legal - ARRAY['copyright','privacy','accessibility','terms']) <> '{}'::jsonb
     OR NOT (legal ?& ARRAY['copyright','privacy','accessibility','terms'])
     OR jsonb_typeof(legal->'copyright') IS DISTINCT FROM 'string'
     OR char_length(legal->>'copyright') > 200 THEN RETURN 'footer legal fields are invalid'; END IF;
  FOREACH key IN ARRAY ARRAY['privacy','accessibility','terms'] LOOP
    legal_link := legal->key;
    IF jsonb_typeof(legal_link) <> 'null' THEN
      defect := app.global_link_defect(legal_link); IF defect IS NOT NULL THEN RETURN defect; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.default_header_content(p_site_name text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'enabled', true, 'preset', 'standard',
    'brand', jsonb_build_object('siteName', p_site_name, 'showName', true,
      'logoMediaId', NULL, 'compactLogoMediaId', NULL),
    'surface', 'page', 'sticky', false, 'utilityLinks', '[]'::jsonb, 'cta', NULL)
$$;

CREATE OR REPLACE FUNCTION app.default_footer_content(p_site_name text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1, 'enabled', true, 'preset', 'simple',
    'brand', jsonb_build_object('siteName', p_site_name, 'blurb', '', 'showFoundation', true),
    'groups', '[]'::jsonb, 'contact', NULL, 'social', '[]'::jsonb,
    'legal', jsonb_build_object('copyright', '',
      'privacy', NULL, 'accessibility', NULL, 'terms', NULL))
$$;

CREATE OR REPLACE FUNCTION app.global_link_readiness_defect(
  p_site_id uuid, p_link jsonb, p_required boolean
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_required AND btrim(p_link->>'label') = '' THEN RETURN 'an enabled link needs a label'; END IF;
  IF p_link->'target'->>'type' = 'page' AND NOT EXISTS (
    SELECT 1 FROM public.pages p
     WHERE p.id = (p_link->'target'->>'page_id')::uuid
       AND p.site_id = p_site_id AND p.published_version_id IS NOT NULL AND p.archived_at IS NULL
  ) THEN RETURN 'a page link does not name a published page on this site'; END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.global_elements_readiness_defect(
  p_site_id uuid, p_kind global_element_kind, p_content jsonb
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE defect text; enabled boolean; link jsonb; group_row jsonb; legal_link jsonb;
        logo_key text; logo_id uuid; contact jsonb;
BEGIN
  defect := CASE p_kind WHEN 'header' THEN app.global_header_defect(p_content)
                        ELSE app.global_footer_defect(p_content) END;
  IF defect IS NOT NULL THEN RETURN defect; END IF;
  enabled := (p_content->>'enabled')::boolean;

  IF p_kind = 'header' THEN
    IF enabled AND (p_content->'brand'->>'showName')::boolean
       AND btrim(p_content->'brand'->>'siteName') = '' THEN RETURN 'an enabled header needs a site name'; END IF;
    IF enabled AND p_content->>'preset' = 'minimal'
       AND (SELECT count(*) FROM public.pages p WHERE p.site_id = p_site_id
             AND p.published_version_id IS NOT NULL AND p.archived_at IS NULL) > 1 THEN
      RETURN 'a minimal header cannot serve a site with more than one published page';
    END IF;
    FOREACH logo_key IN ARRAY ARRAY['logoMediaId','compactLogoMediaId'] LOOP
      IF jsonb_typeof(p_content->'brand'->logo_key) = 'string' THEN
        logo_id := (p_content->'brand'->>logo_key)::uuid;
        IF NOT EXISTS (SELECT 1 FROM public.media m WHERE m.id = logo_id
          AND (m.site_id = p_site_id OR m.site_id IS NULL)
          AND m.status = 'ready' AND m.deleted_at IS NULL) THEN
          RETURN 'a header logo is not ready media available to this site';
        END IF;
      END IF;
    END LOOP;
    FOR link IN SELECT value FROM jsonb_array_elements(p_content->'utilityLinks') LOOP
      defect := app.global_link_readiness_defect(p_site_id, link, enabled);
      IF defect IS NOT NULL THEN RETURN defect; END IF;
    END LOOP;
    IF jsonb_typeof(p_content->'cta') <> 'null' THEN
      defect := app.global_link_readiness_defect(p_site_id, p_content->'cta', enabled);
      IF defect IS NOT NULL THEN RETURN defect; END IF;
    END IF;
  ELSE
    IF enabled AND btrim(p_content->'brand'->>'siteName') = '' THEN RETURN 'an enabled footer needs a site name'; END IF;
    FOR group_row IN SELECT value FROM jsonb_array_elements(p_content->'groups') LOOP
      IF enabled AND (btrim(group_row->>'heading') = '' OR jsonb_array_length(group_row->'links') = 0) THEN
        RETURN 'an enabled footer group needs a heading and at least one link';
      END IF;
      FOR link IN SELECT value FROM jsonb_array_elements(group_row->'links') LOOP
        defect := app.global_link_readiness_defect(p_site_id, link, enabled);
        IF defect IS NOT NULL THEN RETURN defect; END IF;
      END LOOP;
    END LOOP;
    contact := p_content->'contact';
    IF enabled AND jsonb_typeof(contact) = 'object'
       AND btrim(COALESCE(contact->>'address','')) = ''
       AND btrim(COALESCE(contact->>'email','')) = ''
       AND btrim(COALESCE(contact->>'phone','')) = '' THEN
      RETURN 'an enabled footer contact needs an address, email, or phone';
    END IF;
    FOR legal_link IN SELECT value FROM jsonb_each(p_content->'legal')
       WHERE key IN ('privacy','accessibility','terms') AND jsonb_typeof(value) <> 'null' LOOP
      defect := app.global_link_readiness_defect(p_site_id, legal_link, enabled);
      IF defect IS NOT NULL THEN RETURN defect; END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END
$$;

-- New sites get explicit baseline versions even if they are created by a
-- future command or migration rather than today's app.create_site wrapper.
CREATE OR REPLACE FUNCTION app.insert_default_global_elements()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE head_id uuid; version_id uuid;
BEGIN
  INSERT INTO public.global_elements (site_id, kind, use_on_live)
  VALUES (NEW.id, 'header', true) RETURNING id INTO head_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (NEW.id, head_id, 1, app.default_header_content(NEW.name), NEW.created_by) RETURNING id INTO version_id;
  UPDATE public.global_elements SET revision = 1, draft_version_id = version_id,
    published_version_id = version_id WHERE id = head_id;

  INSERT INTO public.global_elements (site_id, kind, use_on_live)
  VALUES (NEW.id, 'footer', true) RETURNING id INTO head_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (NEW.id, head_id, 1, app.default_footer_content(NEW.name), NEW.created_by) RETURNING id INTO version_id;
  UPDATE public.global_elements SET revision = 1, draft_version_id = version_id,
    published_version_id = version_id WHERE id = head_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER sites_insert_default_global_elements
  AFTER INSERT ON public.sites
  FOR EACH ROW EXECUTE FUNCTION app.insert_default_global_elements();

-- Existing sites had no header/footer heads. Backfill the same explicit
-- baseline without rewriting any pre-existing version history.
DO $$
DECLARE site_row RECORD; head_id uuid; version_id uuid;
BEGIN
  FOR site_row IN SELECT s.id, s.name, s.created_by FROM public.sites s LOOP
    IF NOT EXISTS (SELECT 1 FROM public.global_elements g
                    WHERE g.site_id = site_row.id AND g.kind = 'header') THEN
      INSERT INTO public.global_elements (site_id, kind, use_on_live)
      VALUES (site_row.id, 'header', true) RETURNING id INTO head_id;
      INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
      VALUES (site_row.id, head_id, 1, app.default_header_content(site_row.name), site_row.created_by)
      RETURNING id INTO version_id;
      UPDATE public.global_elements SET revision = 1, draft_version_id = version_id,
        published_version_id = version_id WHERE id = head_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.global_elements g
                    WHERE g.site_id = site_row.id AND g.kind = 'footer') THEN
      INSERT INTO public.global_elements (site_id, kind, use_on_live)
      VALUES (site_row.id, 'footer', true) RETURNING id INTO head_id;
      INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
      VALUES (site_row.id, head_id, 1, app.default_footer_content(site_row.name), site_row.created_by)
      RETURNING id INTO version_id;
      UPDATE public.global_elements SET revision = 1, draft_version_id = version_id,
        published_version_id = version_id WHERE id = head_id;
    END IF;
  END LOOP;
END
$$;

-- Content.enabled, not use_on_live, is authoritative. The shell always carries
-- the immutable version and lets both renderers make the same decision.
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
               WHERE g.site_id = s.id AND g.kind = 'header'),
    'footer', (SELECT gv.content FROM public.global_elements g
                JOIN public.global_element_versions gv ON gv.id = g.published_version_id
               WHERE g.site_id = s.id AND g.kind = 'footer'),
    'canonical_host', (SELECT d.hostname_normalized FROM public.domains d
                        WHERE d.site_id = s.id AND d.kind = 'primary' AND d.status = 'live'
                        ORDER BY d.created_at LIMIT 1),
    'staging_host', s.staging_hostname
  ) INTO payload FROM public.sites s WHERE s.id = p_site_id;
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

-- app.create_site inserts site_settings only after the theme, navigation, and
-- the two global-element heads exist. That final singleton is therefore the
-- reliable bootstrap boundary for publishing the first complete shell. Without
-- it, the first page on a new site was judged against an empty fallback shell,
-- then visitors received a different shell after publication rebuilt it.
CREATE OR REPLACE FUNCTION app.publish_initial_site_shell()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM app.rebuild_site_shell(NEW.site_id);
  RETURN NEW;
END
$$;

CREATE TRIGGER site_settings_publish_initial_shell
  AFTER INSERT ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION app.publish_initial_site_shell();

-- Existing projections must opt into the explicit header/footer versions at
-- migration time, rather than waiting for an unrelated future publication.
DO $$
DECLARE site_row RECORD;
BEGIN
  FOR site_row IN SELECT s.id FROM public.sites s LOOP
    PERFORM app.rebuild_site_shell(site_row.id);
  END LOOP;
END
$$;

-- Navigation and global-element links name pages by id. The original public
-- route list exposed only paths, which meant the public renderer could resolve
-- the current page but silently dropped links to every other published page.
DROP FUNCTION public_api.site_routes(text);
CREATE FUNCTION public_api.site_routes(p_host text)
RETURNS TABLE (page_id uuid, path text, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT r.page_id, r.path, r.updated_at
    FROM public_api.resolve_host(p_host) h
    JOIN public.published_routes r ON r.site_id = h.site_id
   ORDER BY r.path
$$;
REVOKE ALL ON FUNCTION public_api.site_routes(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_api.site_routes(text)
  TO cms_public_renderer, cms_authenticated_user;
ALTER FUNCTION public_api.site_routes(text) OWNER TO cms_migration_owner;

CREATE OR REPLACE FUNCTION app.save_global_elements_draft(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint,
  p_header_content jsonb, p_footer_content jsonb
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_id uuid; footer_id uuid;
        next_header bigint; next_footer bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision INTO header_head FROM public.global_elements g
   WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision INTO footer_head FROM public.global_elements g
   WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision <> p_expected_header_revision THEN
    RAISE EXCEPTION 'stale header revision: expected %, head is at %',
      p_expected_header_revision, header_head.revision
      USING ERRCODE = 'CMS01', DETAIL = header_head.revision::text;
  END IF;
  IF footer_head.revision <> p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale footer revision: expected %, head is at %',
      p_expected_footer_revision, footer_head.revision
      USING ERRCODE = 'CMS01', DETAIL = footer_head.revision::text;
  END IF;
  defect := app.global_header_defect(p_header_content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_footer_defect(p_footer_content);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, p_header_content, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, p_footer_content, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id
   WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id
   WHERE id = footer_head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.save', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'header_version_id', header_id, 'header_revision', next_header,
      'footer_version_id', footer_id, 'footer_revision', next_footer));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer;
END
$$;

CREATE OR REPLACE FUNCTION app.publish_global_elements(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint, shell_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_draft jsonb; footer_draft jsonb;
        header_id uuid; footer_id uuid; next_header bigint; next_footer bigint; shell_rev bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision, g.draft_version_id, g.published_version_id INTO header_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision, g.draft_version_id, g.published_version_id INTO footer_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to publish global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision <> p_expected_header_revision THEN
    RAISE EXCEPTION 'stale header revision: expected %, head is at %',
      p_expected_header_revision, header_head.revision
      USING ERRCODE = 'CMS01', DETAIL = header_head.revision::text;
  END IF;
  IF footer_head.revision <> p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale footer revision: expected %, head is at %',
      p_expected_footer_revision, footer_head.revision
      USING ERRCODE = 'CMS01', DETAIL = footer_head.revision::text;
  END IF;
  SELECT v.content INTO header_draft FROM public.global_element_versions v
   WHERE v.id = header_head.draft_version_id AND v.global_element_id = header_head.id;
  SELECT v.content INTO footer_draft FROM public.global_element_versions v
   WHERE v.id = footer_head.draft_version_id AND v.global_element_id = footer_head.id;
  IF header_draft IS NULL OR footer_draft IS NULL THEN
    RAISE EXCEPTION 'global elements do not have complete drafts' USING ERRCODE = 'CMS04';
  END IF;
  defect := app.global_elements_readiness_defect(p_site_id, 'header', header_draft);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_elements_readiness_defect(p_site_id, 'footer', footer_draft);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;
  IF (NOT (footer_draft->>'enabled')::boolean
      OR NOT (footer_draft->'brand'->>'showFoundation')::boolean)
     AND NOT app.is_super_admin() THEN
    RAISE EXCEPTION 'only a super admin may hide the shared foundation' USING ERRCODE = 'CMS02';
  END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, header_draft, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, footer_draft, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id,
    published_version_id = header_id WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id,
    published_version_id = footer_id WHERE id = footer_head.id;
  shell_rev := app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.publish', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'before_header_version_id', header_head.published_version_id,
      'header_version_id', header_id, 'header_revision', next_header,
      'before_footer_version_id', footer_head.published_version_id,
      'footer_version_id', footer_id, 'footer_revision', next_footer,
      'shell_revision', shell_rev));
  PERFORM app.emit_outbox(p_site_id, 'site_shell.published', jsonb_build_object(
    'site_id', p_site_id, 'revision', shell_rev,
    'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
      FROM public.published_routes r WHERE r.site_id = p_site_id), '[]'::jsonb)));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer, shell_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.revert_global_elements_to_live(
  p_site_id uuid, p_expected_header_revision bigint, p_expected_footer_revision bigint
) RETURNS TABLE (
  header_version_id uuid, header_revision bigint,
  footer_version_id uuid, footer_revision bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; header_head RECORD; footer_head RECORD; header_live jsonb; footer_live jsonb;
        header_id uuid; footer_id uuid; next_header bigint; next_footer bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT g.id, g.revision, g.published_version_id INTO header_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'header' FOR UPDATE;
  SELECT g.id, g.revision, g.published_version_id INTO footer_head
    FROM public.global_elements g WHERE g.site_id = p_site_id AND g.kind = 'footer' FOR UPDATE;
  IF header_head IS NULL OR footer_head IS NULL THEN
    RAISE EXCEPTION 'site does not have both global-element heads' USING ERRCODE = 'CMS03';
  END IF;
  IF NOT app.can_publish(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to revert global elements on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF header_head.revision <> p_expected_header_revision
     OR footer_head.revision <> p_expected_footer_revision THEN
    RAISE EXCEPTION 'stale global-element revision' USING ERRCODE = 'CMS01',
      DETAIL = jsonb_build_object('header_revision',header_head.revision,
                                  'footer_revision',footer_head.revision)::text;
  END IF;
  SELECT v.content INTO header_live FROM public.global_element_versions v
   WHERE v.id = header_head.published_version_id AND v.global_element_id = header_head.id;
  SELECT v.content INTO footer_live FROM public.global_element_versions v
   WHERE v.id = footer_head.published_version_id AND v.global_element_id = footer_head.id;
  IF header_live IS NULL OR footer_live IS NULL THEN
    RAISE EXCEPTION 'global elements do not have complete live versions' USING ERRCODE = 'CMS04';
  END IF;
  defect := app.global_header_defect(header_live);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'live header is not a current safe version: %', defect USING ERRCODE = 'CMS04'; END IF;
  defect := app.global_footer_defect(footer_live);
  IF defect IS NOT NULL THEN RAISE EXCEPTION 'live footer is not a current safe version: %', defect USING ERRCODE = 'CMS04'; END IF;

  next_header := header_head.revision + 1;
  next_footer := footer_head.revision + 1;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, header_head.id, next_header, header_live, actor) RETURNING id INTO header_id;
  INSERT INTO public.global_element_versions (site_id, global_element_id, revision, content, author_id)
  VALUES (p_site_id, footer_head.id, next_footer, footer_live, actor) RETURNING id INTO footer_id;
  UPDATE public.global_elements SET revision = next_header, draft_version_id = header_id
   WHERE id = header_head.id;
  UPDATE public.global_elements SET revision = next_footer, draft_version_id = footer_id
   WHERE id = footer_head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'global_elements.revert', 'site', p_site_id,
    NULL, NULL, jsonb_build_object(
      'header_version_id', header_id, 'header_revision', next_header,
      'footer_version_id', footer_id, 'footer_revision', next_footer));
  RETURN QUERY SELECT header_id, next_header, footer_id, next_footer;
END
$$;

REVOKE ALL ON FUNCTION app.global_link_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_header_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_footer_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.default_header_content(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.default_footer_content(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_link_readiness_defect(uuid,jsonb,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.global_elements_readiness_defect(uuid,global_element_kind,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.insert_default_global_elements() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_initial_site_shell() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_global_elements_draft(uuid,bigint,bigint,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_global_elements(uuid,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revert_global_elements_to_live(uuid,bigint,bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.save_global_elements_draft(uuid,bigint,bigint,jsonb,jsonb)
  TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_global_elements(uuid,bigint,bigint)
  TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.revert_global_elements_to_live(uuid,bigint,bigint)
  TO cms_authenticated_user;

ALTER FUNCTION app.global_link_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_header_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_footer_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.default_header_content(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.default_footer_content(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_link_readiness_defect(uuid,jsonb,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.global_elements_readiness_defect(uuid,global_element_kind,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.insert_default_global_elements() OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_initial_site_shell() OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_global_elements_draft(uuid,bigint,bigint,jsonb,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_global_elements(uuid,bigint,bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.revert_global_elements_to_live(uuid,bigint,bigint) OWNER TO cms_migration_owner;
