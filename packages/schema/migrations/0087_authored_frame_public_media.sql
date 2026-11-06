-- 0087 — shared media used only by an authored frame must be public on the
-- exact site that published it. Drafts, historical pins, later definitions,
-- inactive frames and unrelated library media do not grant delivery access.

-- A local delivery URL, not a mention inside text, an external URL's path,
-- a query parameter, or an image metadata object's media_id. Authored frames
-- render their stored src/url directly; they do not hydrate media_id.
CREATE FUNCTION app.frame_url_matches(p_url text, p_url_pattern text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT COALESCE(btrim(p_url) ~ p_url_pattern, false)
$$;

-- Tokenize strings/comments as well as url(): a CSS content string that
-- merely spells "url(/media/...)" does not load that image.
CREATE FUNCTION app.frame_css_uses_url_pattern(p_css text, p_url_pattern text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE token text[];
BEGIN
  FOR token IN SELECT regexp_matches(COALESCE(p_css,''),
    $re$/\*(?:[^*]|\*+[^*/])*\*+/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\murl[[:space:]]*\([[:space:]]*(?:"([^"]*)"|'([^']*)'|([^[:space:]"')]*))[[:space:]]*\)$re$, 'gi')
  LOOP
    IF app.frame_url_matches(COALESCE(token[1], token[2], token[3]), p_url_pattern) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END
$$;

-- Read actual URL-bearing attributes, not arbitrary substrings in HTML.
-- Quoted attribute contents are consumed as a unit so a title containing
-- '<img src="...">' cannot invent a second element. Rich text permits anchors
-- only: its renderer strips img, style and every other URL-bearing attribute.
CREATE FUNCTION app.frame_markup_uses_url_pattern(p_html text, p_url_pattern text, p_richtext boolean DEFAULT false, p_links_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE tag text[]; attribute text[]; address text; candidate text; name text; html text; seen_names text[]; parts text[];
BEGIN
  html := COALESCE(p_html,'');
  IF NOT p_richtext THEN
    -- The browser does not interpret markup inside these inert regions.
    html := regexp_replace(html, '<!--.*?(-->|$)', '', 'gs');
    html := regexp_replace(html, '<(textarea|title|template)([[:space:]][^>]*)?>.*</\1[[:space:]]*>', '', 'gis');
    html := regexp_replace(html, '<(?:textarea|title|template)(?:[[:space:]][^>]*)?>.*$', '', 'gis');
  END IF;
  FOR tag IN SELECT regexp_matches(html,
    $re$<([[:alpha:]][[:alnum:]:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>$re$, 'g')
  LOOP
    IF (p_richtext OR p_links_only) AND lower(tag[1]) <> 'a' THEN CONTINUE; END IF;
    seen_names := ARRAY[]::text[];
    FOR attribute IN SELECT regexp_matches(tag[2],
      $re$(?:^|[[:space:]])([[:alpha:]_:][[:alnum:]_:.-]*)[[:space:]]*=[[:space:]]*(?:"([^"]*)"|'([^']*)'|([^[:space:]"'=<>`]+))$re$, 'g')
    LOOP
      name := lower(attribute[1]); address := COALESCE(attribute[2], attribute[3], attribute[4]);
      -- HTML keeps the first attribute with a name; duplicate trailing src
      -- or href values are not a second usable reference.
      IF name=ANY(seen_names) THEN CONTINUE; END IF;
      seen_names := array_append(seen_names, name);
      IF (p_richtext OR p_links_only) AND name <> 'href' THEN CONTINUE; END IF;
      IF p_richtext AND attribute[4] IS NOT NULL THEN CONTINUE; END IF;
      IF (name='src' AND lower(tag[1]) IN ('img','audio','video','source','track','iframe','embed','script'))
         OR (name='href' AND lower(tag[1]) IN ('a','area','link','image'))
         OR (name='xlink:href' AND lower(tag[1]) IN ('a','image','use'))
         OR (name='poster' AND lower(tag[1])='video')
         OR (name='background' AND lower(tag[1]) IN ('body','table','td','th')) THEN
        IF app.frame_url_matches(address, p_url_pattern) THEN RETURN true; END IF;
      ELSIF NOT p_richtext AND name = 'srcset' AND lower(tag[1]) IN ('img','source') THEN
        FOREACH candidate IN ARRAY string_to_array(address, ',') LOOP
          parts := regexp_split_to_array(btrim(candidate), '[[:space:]]+');
          IF cardinality(parts)>2 OR (cardinality(parts)=2 AND parts[2] !~ '^[0-9]+([.][0-9]+)?[xw]$') THEN CONTINUE; END IF;
          IF app.frame_url_matches(parts[1], p_url_pattern) THEN RETURN true; END IF;
        END LOOP;
      ELSIF NOT p_richtext AND name = 'style' AND app.frame_css_uses_url_pattern(address, p_url_pattern) THEN
        RETURN true;
      END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END
$$;

-- A text slot in srcset is an all-or-nothing URL list in render.ts. One
-- refused candidate suppresses the complete attribute, including good URLs.
CREATE FUNCTION app.frame_srcset_is_safe(p_value text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE candidate text; parts text[]; address text; count int := 0;
BEGIN
  FOREACH candidate IN ARRAY string_to_array(regexp_replace(COALESCE(p_value,''),'[[:cntrl:]]','','g'), ',') LOOP
    candidate := btrim(candidate);
    IF candidate='' THEN CONTINUE; END IF;
    count := count+1; parts := regexp_split_to_array(candidate,'[[:space:]]+');
    IF cardinality(parts)>2 OR (cardinality(parts)=2 AND parts[2] !~ '^[0-9]+([.][0-9]+)?[xw]$') THEN RETURN false; END IF;
    address := parts[1];
    IF left(translate(address,chr(92),'/'),2)='//' THEN RETURN false; END IF;
    IF left(translate(address,chr(92),'/'),1)<>'/' AND left(address,1) NOT IN ('#','?')
      AND address !~* '^(https?:|mailto:|tel:)' THEN RETURN false; END IF;
  END LOOP;
  RETURN count>0;
END
$$;

-- The renderer re-derives legacy slot contexts before emitting anything.
-- Check bindings against the reconstructed template too: trusting a stored
-- "image in element-text" claim inside title/comment would expose a value
-- from a component that the renderer actually refuses.
CREATE FUNCTION app.frame_ast_bindings_match(p_ast jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE entry RECORD; markup text := ''; outside text; marker text; tag text[];
        attribute text[]; name text; context text; found boolean;
BEGIN
  FOR entry IN SELECT value, ord FROM jsonb_array_elements(p_ast->'nodes') WITH ORDINALITY AS nodes(value,ord) LOOP
    IF entry.value->>'kind'='html' THEN
      IF strpos(entry.value->>'value','__cms_frame_probe_')>0 THEN RETURN false; END IF;
      markup := markup || (entry.value->>'value');
    ELSE
      markup := markup || '__cms_frame_probe_' || entry.ord::text || '__';
    END IF;
  END LOOP;
  markup := regexp_replace(markup, '<!--.*?(-->|$)', '', 'gs');
  markup := regexp_replace(markup, '<(textarea|title|template)([[:space:]][^>]*)?>.*</\1[[:space:]]*>', '', 'gis');
  markup := regexp_replace(markup, '<(?:textarea|title|template)(?:[[:space:]][^>]*)?>.*$', '', 'gis');
  outside := regexp_replace(markup, $re$</?[[:alpha:]][[:alnum:]:-]*(?:[^<>"']|"[^"]*"|'[^']*')*>$re$, '', 'g');
  -- An unterminated or malformed tag cannot establish a safe text position.
  IF outside ~ '<[[:alpha:]!/?]' THEN RETURN false; END IF;
  FOR entry IN SELECT value, ord FROM jsonb_array_elements(p_ast->'nodes') WITH ORDINALITY AS nodes(value,ord)
    WHERE value->>'kind'='slot'
  LOOP
    marker := '__cms_frame_probe_' || entry.ord::text || '__';
    IF entry.value->>'context'='element-text' THEN
      IF strpos(outside, marker)=0 THEN RETURN false; END IF;
      CONTINUE;
    END IF;
    found := false;
    FOR tag IN SELECT regexp_matches(markup, $re$<[[:alpha:]][[:alnum:]:-]*((?:[^<>"']|"[^"]*"|'[^']*')*)>$re$, 'g') LOOP
      FOR attribute IN SELECT regexp_matches(tag[1],
        $re$(?:^|[[:space:]])([[:alpha:]_:][[:alnum:]_:.-]*)[[:space:]]*=[[:space:]]*(?:"([^"]*)"|'([^']*)')$re$, 'g')
      LOOP
        IF strpos(COALESCE(attribute[2],attribute[3]), marker)=0 THEN CONTINUE; END IF;
        name := lower(attribute[1]);
        context := CASE WHEN name='style' THEN 'style-attribute'
          WHEN name IN ('href','src','action','formaction','poster','data','cite','background','longdesc','manifest','profile','icon','usemap','codebase','xlink:href','ping','archive','srcset','xmlns','xmlns:xlink','from','to','values') THEN 'url-attribute'
          WHEN name LIKE 'on%' OR name='srcdoc' THEN 'refused' ELSE 'quoted-attribute' END;
        found := context=entry.value->>'context'
          AND (NOT (entry.value ? 'attribute') OR entry.value->>'attribute'=name);
      END LOOP;
    END LOOP;
    IF NOT found THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

CREATE FUNCTION app.published_frame_uses_url_pattern(p_site_id uuid, p_url_pattern text, p_links_only boolean DEFAULT false)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE frame RECORD; component jsonb; values jsonb; node jsonb; value jsonb;
        markup text; kind text; context text; address text;
BEGIN
  FOR frame IN
    SELECT g.kind, v.content FROM public.global_elements g
      JOIN public.global_element_versions v ON v.id=g.published_version_id
        AND v.global_element_id=g.id AND v.site_id=g.site_id
     WHERE g.site_id=p_site_id AND v.content->'schemaVersion'='2'::jsonb
       AND v.content->'enabled'='true'::jsonb
  LOOP
    -- Same pinned placement, tenant, trusted-code and policy gate as the shell.
    component := app.global_component_view(p_site_id, frame.kind, frame.content);
    IF component IS NULL THEN CONTINUE; END IF;
    -- The shell does not resolve collection bindings for frames. A repeat
    -- makes the structured renderer refuse the body; its item template and
    -- sibling values must not independently grant public access.
    IF component->>'definition_kind'='structured' AND EXISTS (
      WITH RECURSIVE nodes(value) AS (
        SELECT root.value FROM jsonb_array_elements(component#>'{structured_doc,nodes}') root
        UNION ALL
        SELECT child.value FROM nodes n CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN n.value->>'type'='element' THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
      ) SELECT 1 FROM nodes WHERE nodes.value->>'type'='repeat'
    ) THEN CONTINUE; END IF;
    IF component->>'definition_kind'<>'structured' AND NOT app.frame_ast_bindings_match(component->'compiled_ast') THEN CONTINUE; END IF;
    values := frame.content->'component'->'values';
    IF NOT p_links_only AND app.frame_css_uses_url_pattern(component->>'css', p_url_pattern) THEN RETURN true; END IF;

    IF component->>'definition_kind' = 'structured' THEN
      -- Walk rendered children only. Field declarations/labels, unused values,
      -- provider metadata and repeat templates are not rendered media sinks.
      FOR node IN
        WITH RECURSIVE nodes(value, depth) AS (
          SELECT root.value, 1 FROM jsonb_array_elements(component#>'{structured_doc,nodes}') root
          UNION ALL
          SELECT child.value, n.depth+1 FROM nodes n CROSS JOIN LATERAL
            jsonb_array_elements(CASE WHEN n.value->>'type'='element'
              THEN COALESCE(n.value->'children','[]'::jsonb) ELSE '[]'::jsonb END) child
            WHERE n.depth<16
        ) SELECT nodes.value FROM nodes
      LOOP
        value := values->(node->>'field'); kind := node->>'type';
        IF NOT p_links_only AND kind='image' AND jsonb_typeof(value)='object'
           AND (value->'decorative'='true'::jsonb OR
             (jsonb_typeof(value->'alt')='string' AND value->>'alt'<>'')) THEN
          IF app.frame_url_matches(value->>'src', p_url_pattern) THEN RETURN true; END IF;
        ELSIF kind='link' AND jsonb_typeof(value)='object' AND jsonb_typeof(value->'label')='string' AND value->>'label'<>'' THEN
          IF app.frame_url_matches(value->>'url', p_url_pattern) THEN RETURN true; END IF;
        ELSIF kind='richtext' AND jsonb_typeof(value)='string' THEN
          IF app.frame_markup_uses_url_pattern(value#>>'{}', p_url_pattern, true) THEN RETURN true; END IF;
        END IF;
      END LOOP;
    ELSE
      -- Reconstruct URL attributes in their owning element before matching.
      -- Attribute names alone are insufficient: <div href> and <a src> are
      -- inert even if their declared slot kind is link/image.
      markup := '';
      FOR node IN SELECT entry.value FROM jsonb_array_elements(component#>'{compiled_ast,nodes}') entry LOOP
        IF node->>'kind'='html' THEN markup := markup || (node->>'value'); CONTINUE; END IF;
        value := values->(node->>'slotId'); address := NULL;
        IF node->>'context'='url-attribute' THEN
          IF node->>'slotKind'='image' AND node->>'attribute'='src' AND jsonb_typeof(value)='object' THEN
            address := value->>'src';
          ELSIF node->>'slotKind' IN ('link','button') AND node->>'attribute'='href' AND jsonb_typeof(value)='object' THEN
            address := value->>'url';
          ELSIF node->>'slotKind'='text' AND jsonb_typeof(value)='string'
            AND node->>'attribute' IN ('src','href','poster','background','xlink:href') THEN
            address := value#>>'{}';
          ELSIF node->>'slotKind'='text' AND node->>'attribute'='srcset' AND jsonb_typeof(value)='string'
            AND app.frame_srcset_is_safe(value#>>'{}') THEN
            address := regexp_replace(value#>>'{}','[[:cntrl:]]','','g');
          END IF;
        END IF;
        -- Keep unsupported/absent values inert instead of accidentally joining
        -- static URL halves, and escape scalar values as the renderer does.
        markup := markup || replace(replace(replace(replace(replace(COALESCE(address,'__cms_value__'),
          '&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),chr(39),'&#39;');
      END LOOP;
      IF app.frame_markup_uses_url_pattern(markup, p_url_pattern, false, p_links_only) THEN RETURN true; END IF;
      FOR node IN SELECT entry.value FROM jsonb_array_elements(component#>'{compiled_ast,nodes}') entry
        WHERE entry.value->>'kind'='slot'
      LOOP
        value := values->(node->>'slotId'); kind := node->>'slotKind'; context := node->>'context';
        address := NULL;
        IF NOT p_links_only AND kind='image' AND context='element-text' THEN
          address := CASE WHEN jsonb_typeof(value)='object' THEN value->>'src'
            WHEN context='element-text' AND jsonb_typeof(value)='string' THEN value#>>'{}' END;
        ELSIF kind IN ('link','button') AND context='element-text' THEN
          address := CASE WHEN jsonb_typeof(value)='object' THEN value->>'url'
            WHEN context='element-text' AND jsonb_typeof(value)='string' THEN value#>>'{}' END;
        ELSIF kind='richtext' AND context='element-text' AND jsonb_typeof(value)='string' THEN
          IF app.frame_markup_uses_url_pattern(value#>>'{}', p_url_pattern, true) THEN RETURN true; END IF;
        END IF;
        IF app.frame_url_matches(address, p_url_pattern) THEN RETURN true; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN false;
END
$$;
REVOKE ALL ON FUNCTION app.frame_srcset_is_safe(text), app.frame_ast_bindings_match(jsonb), app.frame_url_matches(text, text), app.frame_css_uses_url_pattern(text, text),
  app.frame_markup_uses_url_pattern(text, text, boolean, boolean), app.published_frame_uses_url_pattern(uuid, text, boolean) FROM PUBLIC;
ALTER FUNCTION app.frame_srcset_is_safe(text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.frame_ast_bindings_match(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.frame_url_matches(text, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.frame_css_uses_url_pattern(text, text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.frame_markup_uses_url_pattern(text, text, boolean, boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.published_frame_uses_url_pattern(uuid, text, boolean) OWNER TO cms_migration_owner;

-- The URL-pattern reader is shared with governed document delivery. Only
-- internal callers supply anchored patterns; it is never executable by readers.
CREATE FUNCTION app.published_frame_uses_media(p_site_id uuid, p_media_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT app.published_frame_uses_url_pattern(p_site_id, '^/media/' || p_media_id::text ||
    '/(original|thumbnail|card|wide)([?#][^[:space:]]*)?$')
$$;
REVOKE ALL ON FUNCTION app.published_frame_uses_media(uuid, uuid) FROM PUBLIC;
ALTER FUNCTION app.published_frame_uses_media(uuid, uuid) OWNER TO cms_migration_owner;

CREATE OR REPLACE FUNCTION public_api.resolve_media(
  p_host text,p_media_id uuid,p_variant text
) RETURNS TABLE(media_id uuid,variant text,object_key text,mime_type text,
  bytes bigint,width integer,height integer,content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT media.id,p_variant,
    CASE WHEN p_variant='original' THEN media.object_key ELSE variant.object_key END,
    CASE WHEN p_variant='original' THEN media.mime_type ELSE variant.mime_type END,
    CASE WHEN p_variant='original' THEN media.bytes ELSE variant.bytes END,
    CASE WHEN p_variant='original' THEN media.width ELSE variant.width END,
    CASE WHEN p_variant='original' THEN media.height ELSE variant.height END,
    CASE WHEN p_variant='original' THEN media.content_hash ELSE variant.content_hash END
  FROM public_api.resolve_host(p_host) host
  JOIN public.media media ON media.site_id=host.site_id OR (media.site_id IS NULL AND (
    EXISTS(SELECT 1 FROM public.media_usage usage JOIN public.pages page
      ON page.id=usage.item_id AND usage.item_type='page'
      WHERE usage.media_id=media.id AND usage.site_id=host.site_id
        AND page.site_id=host.site_id AND page.archived_at IS NULL
        AND page.published_version_id=usage.version_id)
    OR EXISTS(SELECT 1 FROM public.global_elements element
      JOIN public.global_element_versions version ON version.id=element.published_version_id
      WHERE element.site_id=host.site_id AND element.kind='header'
        AND version.content->'enabled'='true'::jsonb
        AND (version.content#>>'{brand,logoMediaId}'=media.id::text
          OR version.content#>>'{brand,compactLogoMediaId}'=media.id::text))
    OR app.published_frame_uses_media(host.site_id, media.id)
    OR EXISTS(SELECT 1 FROM public.media_usage usage
      JOIN public.collection_entries entry ON entry.id=usage.item_id
        AND usage.item_type='collection_entry' AND entry.published_version_id=usage.version_id
        AND entry.published_archived_at IS NULL
      JOIN public.collections collection ON collection.id=entry.collection_id
        AND collection.site_id=host.site_id
      WHERE usage.media_id=media.id AND usage.site_id=host.site_id
        AND EXISTS(SELECT 1 FROM public.published_routes route
          WHERE route.site_id=host.site_id
            AND app.render_manifest_uses_collection_entry(
              route.render_manifest,collection.id,entry.id)))
  ))
  LEFT JOIN public.media_variants variant
    ON variant.media_id=media.id AND variant.kind=p_variant AND p_variant<>'original'
  WHERE p_variant IN ('original','thumbnail','card','wide')
    AND media.id=p_media_id AND media.status='ready' AND media.deleted_at IS NULL AND media.purged_at IS NULL
    AND (p_variant='original' OR variant.id IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION public_api.resolve_media(text, uuid, text) FROM PUBLIC;
ALTER FUNCTION public_api.resolve_media(text, uuid, text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION public_api.resolve_media(text, uuid, text) TO cms_public_renderer, cms_authenticated_user;
