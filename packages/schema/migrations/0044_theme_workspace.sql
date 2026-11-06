-- 0044 — a bounded, versioned theme command surface.
--
-- Existing theme versions predate the complete token contract and remain
-- readable. New saves must provide the complete normalized shape; publishing
-- additionally enforces the three WCAG AA contrast pairs which can otherwise
-- make an entire site unreadable.

CREATE OR REPLACE FUNCTION app.theme_tokens_defect(p_tokens jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE colors jsonb; fonts jsonb; buttons jsonb; value text;
        allowed_fonts constant text[] := ARRAY[
          '-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif',
          'Optima, Candara, ''Noto Sans'', sans-serif',
          'Georgia, ''Times New Roman'', serif',
          'Iowan Old Style, Baskerville, ''Times New Roman'', serif',
          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          'system-ui, sans-serif'
        ];
        allowed_radii constant text[] := ARRAY['0rem','0.25rem','0.5rem','0.75rem','1rem'];
BEGIN
  IF jsonb_typeof(p_tokens) IS DISTINCT FROM 'object' THEN
    RETURN 'theme tokens must be an object';
  END IF;
  IF (p_tokens - ARRAY['colors','fonts','radius','spacing','buttons']) <> '{}'::jsonb
     OR NOT (p_tokens ?& ARRAY['colors','fonts','radius','spacing','buttons']) THEN
    RETURN 'theme tokens must contain exactly colors, fonts, radius, spacing, and buttons';
  END IF;

  colors := p_tokens->'colors';
  IF jsonb_typeof(colors) IS DISTINCT FROM 'object'
     OR (colors - ARRAY['primary','accent','surface','surfaceAlt','ink','muted',
                        'primaryContrast','accentContrast']) <> '{}'::jsonb
     OR NOT (colors ?& ARRAY['primary','accent','surface','surfaceAlt','ink','muted',
                             'primaryContrast','accentContrast']) THEN
    RETURN 'theme colors must contain exactly the eight supported color roles';
  END IF;
  FOR value IN SELECT item.value FROM jsonb_each_text(colors) item LOOP
    IF value IS NULL OR value !~ '^#[0-9A-Fa-f]{6}$' THEN
      RETURN 'theme colors must be six-digit hexadecimal colors';
    END IF;
  END LOOP;

  fonts := p_tokens->'fonts';
  IF jsonb_typeof(fonts) IS DISTINCT FROM 'object'
     OR (fonts - ARRAY['heading','body']) <> '{}'::jsonb
     OR NOT (fonts ?& ARRAY['heading','body']) THEN
    RETURN 'theme fonts must contain exactly heading and body';
  END IF;
  IF jsonb_typeof(fonts->'heading') IS DISTINCT FROM 'string'
     OR jsonb_typeof(fonts->'body') IS DISTINCT FROM 'string'
     OR NOT ((fonts->>'heading') = ANY(allowed_fonts))
     OR NOT ((fonts->>'body') = ANY(allowed_fonts)) THEN
    RETURN 'theme fonts must use a supported device-native stack';
  END IF;

  IF jsonb_typeof(p_tokens->'radius') IS DISTINCT FROM 'string'
     OR NOT ((p_tokens->>'radius') = ANY(allowed_radii)) THEN
    RETURN 'theme radius is not supported';
  END IF;
  IF jsonb_typeof(p_tokens->'spacing') IS DISTINCT FROM 'string'
     OR p_tokens->>'spacing' NOT IN ('compact','comfortable','spacious') THEN
    RETURN 'theme spacing is not supported';
  END IF;

  buttons := p_tokens->'buttons';
  IF jsonb_typeof(buttons) IS DISTINCT FROM 'object'
     OR (buttons - ARRAY['style','color','radius','weight','hover','speed']) <> '{}'::jsonb
     OR NOT (buttons ?& ARRAY['style','color','radius','weight','hover','speed']) THEN
    RETURN 'theme buttons must contain exactly style, color, radius, weight, hover, and speed';
  END IF;
  IF jsonb_typeof(buttons->'style') IS DISTINCT FROM 'string'
     OR buttons->>'style' NOT IN ('solid','outline','text')
     OR jsonb_typeof(buttons->'color') IS DISTINCT FROM 'string'
     OR buttons->>'color' NOT IN ('primary','accent')
     OR jsonb_typeof(buttons->'radius') IS DISTINCT FROM 'string'
     OR NOT ((buttons->>'radius') = ANY(allowed_radii))
     OR jsonb_typeof(buttons->'weight') IS DISTINCT FROM 'string'
     OR buttons->>'weight' NOT IN ('regular','bold')
     OR jsonb_typeof(buttons->'hover') IS DISTINCT FROM 'string'
     OR buttons->>'hover' NOT IN ('none','darken','lift','invert','underline')
     OR jsonb_typeof(buttons->'speed') IS DISTINCT FROM 'string'
     OR buttons->>'speed' NOT IN ('fast','normal','slow') THEN
    RETURN 'theme button settings contain an unsupported value';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION app.theme_relative_luminance(p_hex text)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE bytes bytea; red double precision; green double precision; blue double precision;
BEGIN
  IF p_hex !~ '^#[0-9A-Fa-f]{6}$' THEN RETURN NULL; END IF;
  bytes := decode(substr(p_hex, 2), 'hex');
  red := get_byte(bytes, 0) / 255.0;
  green := get_byte(bytes, 1) / 255.0;
  blue := get_byte(bytes, 2) / 255.0;
  red := CASE WHEN red <= 0.04045 THEN red / 12.92 ELSE power((red + 0.055) / 1.055, 2.4) END;
  green := CASE WHEN green <= 0.04045 THEN green / 12.92 ELSE power((green + 0.055) / 1.055, 2.4) END;
  blue := CASE WHEN blue <= 0.04045 THEN blue / 12.92 ELSE power((blue + 0.055) / 1.055, 2.4) END;
  RETURN 0.2126 * red + 0.7152 * green + 0.0722 * blue;
END
$$;

CREATE OR REPLACE FUNCTION app.theme_contrast_ratio(p_foreground text, p_background text)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog, public AS $$
DECLARE first_luminance double precision; second_luminance double precision;
BEGIN
  first_luminance := app.theme_relative_luminance(p_foreground);
  second_luminance := app.theme_relative_luminance(p_background);
  IF first_luminance IS NULL OR second_luminance IS NULL THEN RETURN NULL; END IF;
  RETURN (greatest(first_luminance, second_luminance) + 0.05)
       / (least(first_luminance, second_luminance) + 0.05);
END
$$;

CREATE OR REPLACE FUNCTION app.save_theme_draft(
  p_site_id uuid, p_expected_revision bigint, p_tokens jsonb
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; next_rev bigint; created uuid; defect text;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision INTO head
    FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  defect := app.theme_tokens_defect(p_tokens);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, p_tokens, actor) RETURNING id INTO created;
  UPDATE public.themes SET revision = next_rev, draft_version_id = created WHERE id = head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.save', 'theme', head.id,
                          NULL, created, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT created, next_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.publish_theme(
  p_site_id uuid, p_expected_revision bigint
) RETURNS TABLE (version_id uuid, revision bigint, shell_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; draft RECORD; next_rev bigint; created uuid;
        shell_rev bigint; defect text;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision, t.draft_version_id, t.published_version_id
    INTO head FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to publish theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  SELECT tv.tokens INTO draft FROM public.theme_versions tv
   WHERE tv.id = head.draft_version_id AND tv.theme_id = head.id;
  IF draft.tokens IS NULL THEN RAISE EXCEPTION 'theme has no draft' USING ERRCODE = 'CMS04'; END IF;
  defect := app.theme_tokens_defect(draft.tokens);
  IF defect IS NOT NULL THEN RAISE EXCEPTION '%', defect USING ERRCODE = 'CMS04'; END IF;

  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'ink', draft.tokens->'colors'->>'surface') < 4.5 THEN
    RAISE EXCEPTION 'body text and surface contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;
  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'primaryContrast', draft.tokens->'colors'->>'primary') < 4.5 THEN
    RAISE EXCEPTION 'primary foreground and background contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;
  IF app.theme_contrast_ratio(draft.tokens->'colors'->>'accentContrast', draft.tokens->'colors'->>'accent') < 4.5 THEN
    RAISE EXCEPTION 'accent foreground and background contrast must be at least 4.5:1' USING ERRCODE = 'CMS04';
  END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, draft.tokens, actor) RETURNING id INTO created;
  UPDATE public.themes
     SET revision = next_rev, draft_version_id = created, published_version_id = created
   WHERE id = head.id;
  shell_rev := app.rebuild_site_shell(p_site_id);
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.publish', 'theme', head.id,
                          head.published_version_id, created,
                          jsonb_build_object('revision', next_rev, 'shell_revision', shell_rev));
  PERFORM app.emit_outbox(p_site_id, 'site_shell.published',
                          jsonb_build_object(
                            'site_id', p_site_id, 'revision', shell_rev,
                            'paths', COALESCE((SELECT jsonb_agg(r.path ORDER BY r.path)
                              FROM public.published_routes r WHERE r.site_id = p_site_id), '[]'::jsonb)));
  RETURN QUERY SELECT created, next_rev, shell_rev;
END
$$;

CREATE OR REPLACE FUNCTION app.revert_theme_to_live(
  p_site_id uuid, p_expected_revision bigint
) RETURNS TABLE (version_id uuid, revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE actor uuid; head RECORD; live_tokens jsonb; next_rev bigint; created uuid;
BEGIN
  actor := app.require_actor();
  SELECT t.id, t.site_id, t.revision, t.published_version_id INTO head
    FROM public.themes t WHERE t.site_id = p_site_id FOR UPDATE;
  IF head IS NULL THEN RAISE EXCEPTION 'no theme for that site' USING ERRCODE = 'CMS03'; END IF;
  IF NOT app.can_administer_site(p_site_id) THEN
    RAISE EXCEPTION 'not permitted to manage theme on this site' USING ERRCODE = 'CMS02';
  END IF;
  IF head.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, head is at %', p_expected_revision, head.revision
      USING ERRCODE = 'CMS01', DETAIL = head.revision::text;
  END IF;
  SELECT tv.tokens INTO live_tokens FROM public.theme_versions tv
   WHERE tv.id = head.published_version_id AND tv.theme_id = head.id;
  IF live_tokens IS NULL THEN RAISE EXCEPTION 'theme has no published version' USING ERRCODE = 'CMS04'; END IF;

  next_rev := head.revision + 1;
  INSERT INTO public.theme_versions (site_id, theme_id, revision, tokens, author_id)
  VALUES (p_site_id, head.id, next_rev, live_tokens, actor) RETURNING id INTO created;
  UPDATE public.themes SET revision = next_rev, draft_version_id = created WHERE id = head.id;
  PERFORM app.write_audit(p_site_id, 'user', actor, 'theme.revert_to_live', 'theme', head.id,
                          NULL, created, jsonb_build_object('revision', next_rev));
  RETURN QUERY SELECT created, next_rev;
END
$$;

REVOKE ALL ON FUNCTION app.theme_tokens_defect(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.theme_relative_luminance(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.theme_contrast_ratio(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.save_theme_draft(uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.publish_theme(uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revert_theme_to_live(uuid, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.save_theme_draft(uuid, bigint, jsonb) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.publish_theme(uuid, bigint) TO cms_authenticated_user;
GRANT EXECUTE ON FUNCTION app.revert_theme_to_live(uuid, bigint) TO cms_authenticated_user;

ALTER FUNCTION app.theme_tokens_defect(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.theme_relative_luminance(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.theme_contrast_ratio(text, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_theme_draft(uuid, bigint, jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.publish_theme(uuid, bigint) OWNER TO cms_migration_owner;
ALTER FUNCTION app.revert_theme_to_live(uuid, bigint) OWNER TO cms_migration_owner;
