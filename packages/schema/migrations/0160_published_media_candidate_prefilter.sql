-- Reject impossible governed-URL candidates before validating large section CSS.
-- A positive candidate still crosses every existing rendering/publication check.
-- Other URL patterns retain the original path unchanged.
DO $$ DECLARE source text; changed text; BEGIN
 source:=pg_get_functiondef('app.render_manifest_uses_media_url(jsonb,text)'::regprocedure);
 changed:=replace(source,'DECLARE section jsonb; component jsonb; instance jsonb;',
  'DECLARE section jsonb; component jsonb; instance jsonb; media_parts text[]; candidate_media_id text;');
 changed:=replace(changed, '  IF app.frame_url_matches(p_manifest#>>''{meta,social_image}'',p_pattern)', $guard$
  media_parts:=regexp_match(p_pattern,'^\^/media/([0-9a-f-]{36})/(original|thumbnail|card|wide)');
  IF media_parts IS NOT NULL AND p_pattern='^/media/'||media_parts[1]||'/'||media_parts[2]||'([?#][^[:space:]]*)?$' THEN
    candidate_media_id:=media_parts[1];
  END IF;
  IF app.frame_url_matches(p_manifest#>>'{meta,social_image}',p_pattern)$guard$);
 changed:=replace(changed, '    component:=section->''def''; instance:=section->''instance'';', $guard$
    IF candidate_media_id IS NOT NULL AND strpos(lower(section::text),candidate_media_id)=0 THEN CONTINUE; END IF;
    component:=section->'def'; instance:=section->'instance';$guard$);
 IF changed=source OR strpos(changed,'candidate_media_id:=media_parts[1]')=0 THEN RAISE EXCEPTION 'the media guard changed; review the candidate optimization'; END IF;
 EXECUTE changed;
END $$;
