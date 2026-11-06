-- Unsaved Site look previews use the same isolated, read-only capability.
-- The caller supplies only closed design/frame values, never a manifest or code.
CREATE FUNCTION app.create_site_look_canvas_ticket(p_version uuid,p_parent_origin text,p_channel text,p_lists jsonb,p_look jsonb)
RETURNS TABLE(token text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE issued record;ticket public.canvas_preview_tickets;look_shell jsonb;normalized_theme jsonb;defect text;refs jsonb;reference record;
BEGIN
 IF jsonb_typeof(p_look) IS DISTINCT FROM 'object' OR NOT(p_look ?& ARRAY['tokens','header','footer','menu'])
  OR p_look-ARRAY['tokens','header','footer','menu']<>'{}'::jsonb OR NOT app.json_within(p_look,524288) THEN
  RAISE EXCEPTION 'The site look preview is incomplete.' USING ERRCODE='CMS04';END IF;
 SELECT * INTO issued FROM app.create_canvas_ticket(p_version,true,p_parent_origin,p_channel,false,p_lists);
 SELECT * INTO STRICT ticket FROM public.canvas_preview_tickets WHERE token_hash=encode(sha256(convert_to(issued.token,'UTF8')),'hex') AND actor_id=app.require_actor() FOR UPDATE;
 -- Mirror the established in-memory defaults for historical compact themes;
 -- preview normalization never writes or upgrades their immutable history.
 normalized_theme:='{"radius":"0.5rem","spacing":"comfortable","buttons":{"style":"solid","color":"primary","radius":"0.25rem","weight":"bold","hover":"darken","speed":"normal"}}'::jsonb||COALESCE(ticket.snapshot#>'{shell,theme}','{}');
 normalized_theme:=jsonb_set(normalized_theme,'{colors}','{"accent":"#d22630","surfaceAlt":"#f4f6f8","muted":"#5f6b7a","primaryContrast":"#ffffff","accentContrast":"#ffffff"}'::jsonb||COALESCE(normalized_theme->'colors','{}'));
 IF p_look->'tokens' IS DISTINCT FROM normalized_theme AND NOT app.can_administer_site(ticket.site_id) THEN
  RAISE EXCEPTION 'Only a site admin can change these design choices.' USING ERRCODE='CMS02';END IF;
 IF (p_look->'header' IS DISTINCT FROM ticket.snapshot#>'{shell,header}' OR p_look->'footer' IS DISTINCT FROM ticket.snapshot#>'{shell,footer}' OR p_look->'menu' IS DISTINCT FROM ticket.snapshot#>'{shell,navigation}') AND NOT app.can_publish(ticket.site_id) THEN
  RAISE EXCEPTION 'An editor is needed to change the site frame.' USING ERRCODE='CMS02';END IF;
 defect:=COALESCE(app.theme_tokens_defect(p_look->'tokens'),app.global_header_defect(p_look->'header'),app.global_footer_defect(p_look->'footer'),app.navigation_tree_defect(p_look->'menu'));
 IF defect IS NOT NULL THEN RAISE EXCEPTION '%',defect USING ERRCODE='CMS04';END IF;
 -- Authored frames must resolve through the same site/placement/code policy.
 IF p_look#>>'{header,schemaVersion}'='2' AND app.global_component_readiness_defect(ticket.site_id,'header',p_look->'header') IS NOT NULL
  OR p_look#>>'{footer,schemaVersion}'='2' AND app.global_component_readiness_defect(ticket.site_id,'footer',p_look->'footer') IS NOT NULL THEN
  RAISE EXCEPTION 'The site frame is unavailable.' USING ERRCODE='CMS04';END IF;
 IF EXISTS(WITH RECURSIVE nodes(node) AS(SELECT value FROM jsonb_array_elements(p_look->'menu') UNION ALL SELECT child.value FROM nodes CROSS JOIN LATERAL jsonb_array_elements(COALESCE(nodes.node->'children','[]')) child)
  SELECT 1 FROM nodes WHERE node#>>'{target,type}'='page' AND NOT EXISTS(SELECT 1 FROM public.pages p WHERE p.site_id=ticket.site_id AND p.id=(node#>>'{target,page_id}')::uuid AND p.archived_at IS NULL)) THEN
  RAISE EXCEPTION 'Choose pages from this site.' USING ERRCODE='CMS04';END IF;
 FOR reference IN SELECT * FROM app.canvas_snapshot_asset_references(p_look) LOOP
  IF reference.kind='media' AND NOT EXISTS(SELECT 1 FROM public.media m WHERE m.id=reference.id AND (m.site_id=ticket.site_id OR m.site_id IS NULL) AND m.status='ready' AND m.deleted_at IS NULL)
   OR reference.kind='asset' AND NOT EXISTS(SELECT 1 FROM public.site_assets a WHERE a.id=reference.id AND a.site_id=ticket.site_id) THEN
   RAISE EXCEPTION 'Choose an available file from this site.' USING ERRCODE='CMS04';END IF;
 END LOOP;
 look_shell:=ticket.snapshot->'shell'||jsonb_build_object('theme',p_look->'tokens','header',p_look->'header','footer',p_look->'footer','navigation',p_look->'menu',
  'header_component',app.preview_global_component(ticket.site_id,'header',p_look->'header'),'footer_component',app.preview_global_component(ticket.site_id,'footer',p_look->'footer'));
 ticket.snapshot:=jsonb_set(ticket.snapshot,'{shell}',look_shell);
 SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('kind',r.kind,'id',r.id,'variant',r.variant)),'[]'::jsonb) INTO refs FROM app.canvas_snapshot_asset_references(ticket.snapshot) r;
 UPDATE public.canvas_preview_tickets SET snapshot=ticket.snapshot,asset_refs=refs WHERE id=ticket.id;
 RETURN QUERY SELECT issued.token::text,issued.expires_at::timestamptz;
END $$;
ALTER FUNCTION app.create_site_look_canvas_ticket(uuid,text,text,jsonb,jsonb) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.create_site_look_canvas_ticket(uuid,text,text,jsonb,jsonb) FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT EXECUTE ON FUNCTION app.create_site_look_canvas_ticket(uuid,text,text,jsonb,jsonb) TO cms_authenticated_user;
