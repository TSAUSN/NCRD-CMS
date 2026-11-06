-- 0073 — scalar typed fields in preserved legacy markup.
-- Existing policy-4 AST shape and compiled/source hashes stay intact. New
-- bindings require policy 5, so old invalid ASTs never become newly valid.
-- Images project only src/alt/role, links only href; these sinks emit escaped
-- scalars, never markup. No dynamic property names, new URL grammars, or active
-- content exemptions. The renderer still rebinds each declared context AND
-- attribute from the original node stream, refusing forged context claims.
-- Older runtimes fail closed on these formerly unsupported combinations.

CREATE OR REPLACE FUNCTION app.render_ast_defect(p_ast jsonb, p_policy_version int) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE node jsonb; ord int := 0; ctx text; kind text; id text; has_slot boolean := false; markup text := '';
        declared int;
BEGIN
  IF p_policy_version IS NULL OR p_policy_version NOT IN (app.current_sanitizer_policy_version(), 5) THEN
    RETURN format('was compiled under sanitizer policy version %s, but this database requires version %s',
                  COALESCE(p_policy_version::text, 'null'),
                  app.current_sanitizer_policy_version());
  END IF;
  IF p_ast IS NULL OR COALESCE(jsonb_typeof(p_ast), 'missing') <> 'object' THEN
    RETURN 'is not a compiled section';
  END IF;
  IF COALESCE(jsonb_typeof(p_ast -> 'nodes'), 'missing') <> 'array' THEN
    RETURN 'has no node list';
  END IF;

  -- The version the artifact carries, not only the one the column claims. The
  -- renderer reads this field and refuses the row when it is stale, so a gate
  -- that ignores it accepts definitions that can never render.
  IF COALESCE(jsonb_typeof(p_ast -> 'policyVersion'), 'missing') <> 'number' THEN
    RETURN 'does not say which sanitizer policy version compiled it';
  END IF;
  declared := (p_ast ->> 'policyVersion')::int;
  IF declared IS DISTINCT FROM p_policy_version THEN
    RETURN format('says it was compiled under sanitizer policy version %s while its row claims %s',
                  declared, p_policy_version);
  END IF;

  FOR node IN SELECT * FROM jsonb_array_elements(p_ast -> 'nodes') LOOP
    IF COALESCE(jsonb_typeof(node), 'missing') <> 'object' THEN
      RETURN format('node %s is not an object', ord);
    END IF;

    IF node ->> 'kind' = 'html' THEN
      IF COALESCE(jsonb_typeof(node -> 'value'), 'missing') <> 'string' THEN
        RETURN format('node %s is markup with no value', ord);
      END IF;
      IF node ->> 'value' ~ '\{\{[[:space:]]*[A-Za-z0-9_-]+[[:space:]]*\}\}' THEN
        RETURN format('node %s contains a slot token no compiler leaves in markup', ord);
      END IF;
      markup := markup || COALESCE(node ->> 'value', '');

    ELSIF node ->> 'kind' = 'slot' THEN
      id := node ->> 'slotId';
      IF NOT app.is_slot_id(id) THEN
        RETURN format('node %s has a slot id that is not a usable one: %s', ord, COALESCE(id, 'null'));
      END IF;
      has_slot := true;
      kind := COALESCE(node ->> 'slotKind', '');
      IF kind NOT IN ('text', 'richtext', 'image', 'link', 'button', 'repeat') THEN
        RETURN format('slot %s has kind %s, which is not a slot kind', id, kind);
      END IF;
      ctx := node ->> 'context';
      IF ctx IS NULL THEN
        RETURN format('slot %s does not say what kind of place it sits in', id);
      END IF;
      IF ctx NOT IN ('element-text', 'quoted-attribute', 'url-attribute', 'style-attribute') THEN
        RETURN format('slot %s sits in %s, which cannot be rendered safely', id, ctx);
      END IF;
      IF kind IN ('richtext', 'link', 'button', 'image') AND ctx <> 'element-text'
         AND NOT (p_policy_version = 5 AND (
           (kind = 'image' AND (
             (ctx = 'url-attribute' AND COALESCE(node ->> 'attribute', '') = 'src')
             OR (ctx = 'quoted-attribute' AND COALESCE(node ->> 'attribute', '') IN ('alt', 'role'))
           ))
           OR (kind IN ('link', 'button') AND ctx = 'url-attribute' AND COALESCE(node ->> 'attribute', '') = 'href')
         )) THEN
        RETURN format('slot %s is a %s slot in %s, where markup cannot go', id, kind, ctx);
      END IF;

    ELSE
      RETURN format('node %s has an unknown kind %s', ord, COALESCE(node ->> 'kind', 'null'));
    END IF;
    ord := ord + 1;
  END LOOP;

  IF has_slot AND COALESCE(markup, '') ~* '<[[:space:]]*script[[:space:]/>]' THEN
    RETURN 'mixes a script element with editable slots, which approval cannot make safe';
  END IF;

  RETURN NULL;
END
$$;

