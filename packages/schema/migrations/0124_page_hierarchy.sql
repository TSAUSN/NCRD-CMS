-- Authoring hierarchy is independent of live addresses and menu nesting.
ALTER TABLE public.pages ADD COLUMN IF NOT EXISTS parent_page_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.pages'::regclass AND conname='pages_parent_page_fk') THEN
  ALTER TABLE public.pages ADD CONSTRAINT pages_parent_page_fk FOREIGN KEY(parent_page_id) REFERENCES public.pages(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS pages_parent_page_idx ON public.pages(site_id,parent_page_id);
CREATE OR REPLACE FUNCTION app.validate_page_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.parent_page_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.pages WHERE id=NEW.parent_page_id AND site_id=NEW.site_id) THEN RAISE EXCEPTION 'Choose a parent page on this site.' USING ERRCODE='CMS04'; END IF;
 IF EXISTS(WITH RECURSIVE ancestors AS (
  SELECT id,parent_page_id,ARRAY[id] AS path FROM public.pages WHERE id=NEW.parent_page_id
  UNION ALL SELECT p.id,p.parent_page_id,a.path||p.id FROM public.pages p JOIN ancestors a ON p.id=a.parent_page_id WHERE NOT p.id=ANY(a.path)
 ) SELECT 1 FROM ancestors WHERE id=NEW.id) THEN RAISE EXCEPTION 'A page cannot be its own parent or sit below one of its children.' USING ERRCODE='CMS04'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.validate_page_parent() FROM PUBLIC;
ALTER FUNCTION app.validate_page_parent() OWNER TO cms_migration_owner;
DROP TRIGGER IF EXISTS pages_parent_guard ON public.pages;
CREATE CONSTRAINT TRIGGER pages_parent_guard AFTER INSERT OR UPDATE OF parent_page_id,site_id ON public.pages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.validate_page_parent();
CREATE OR REPLACE FUNCTION app.set_page_parent(p_page_id uuid,p_expected_revision bigint,p_parent_page_id uuid) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head RECORD; next_revision bigint;
BEGIN
 actor:=app.require_actor(); SELECT * INTO head FROM public.pages WHERE id=p_page_id FOR UPDATE;
 IF head.id IS NULL THEN RAISE EXCEPTION 'Page unavailable.' USING ERRCODE='CMS03'; END IF;
 IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'An editor can organize pages on this site.' USING ERRCODE='CMS02'; END IF;
 IF head.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This page is archived.' USING ERRCODE='CMS04'; END IF;
 IF head.revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'The page changed.' USING ERRCODE='CMS01',DETAIL=head.revision::text; END IF;
 IF head.parent_page_id IS NOT DISTINCT FROM p_parent_page_id THEN RETURN head.revision; END IF;
 IF p_parent_page_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pages WHERE id=p_parent_page_id AND site_id=head.site_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'Choose an available parent page on this site.' USING ERRCODE='CMS04'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(head.site_id::text,50));
 -- Check the proposed edge before changing it; the deferred trigger also guards imports.
 IF p_parent_page_id IS NOT NULL AND EXISTS(WITH RECURSIVE descendants AS (
   SELECT id FROM public.pages WHERE id=p_page_id UNION SELECT p.id FROM public.pages p JOIN descendants d ON p.parent_page_id=d.id
 ) SELECT 1 FROM descendants WHERE id=p_parent_page_id) THEN RAISE EXCEPTION 'Choose a parent outside this page and its children.' USING ERRCODE='CMS04'; END IF;
 next_revision:=head.revision+1;
 UPDATE public.pages SET parent_page_id=p_parent_page_id,revision=next_revision WHERE id=head.id;
 PERFORM app.write_audit(head.site_id,'user',actor,'page.parent','page',head.id,head.draft_version_id,head.draft_version_id,jsonb_build_object('old_parent',head.parent_page_id,'parent',p_parent_page_id,'revision',next_revision));
 RETURN next_revision;
END $$;
REVOKE ALL ON FUNCTION app.set_page_parent(uuid,bigint,uuid) FROM PUBLIC;
ALTER FUNCTION app.set_page_parent(uuid,bigint,uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.set_page_parent(uuid,bigint,uuid) TO cms_authenticated_user;
-- Keep content exports and imports complete without changing the archive version.
-- Optional parent ids make older archives readable; ids are remapped by the existing importer.
DO $$ DECLARE source text; BEGIN
 source:=pg_get_functiondef('app.export_site_content_before_assets(uuid)'::regprocedure);
 IF position('"parent_page_id" FROM public.pages' IN source)=0 THEN
  source:=replace(source,'"archived_at" FROM public.pages','"archived_at","parent_page_id" FROM public.pages');
  EXECUTE source;
 END IF;
 source:=pg_get_functiondef('app.import_site_content_before_recipes(uuid,jsonb,jsonb)'::regprocedure);
 IF position('r."parent_page_id"' IN source)=0 THEN
  source:=replace(source,'"editor_label","sort_index","archived_at","site_id")','"editor_label","sort_index","archived_at","parent_page_id","site_id")');
  source:=replace(source,'r."editor_label",r."sort_index",r."archived_at",r."site_id" FROM jsonb_populate_record(NULL::public.pages,row_value)','r."editor_label",r."sort_index",r."archived_at",r."parent_page_id",r."site_id" FROM jsonb_populate_record(NULL::public.pages,row_value)');
  EXECUTE source;
 END IF;
END $$;

-- Page details and menu visibility are one intention, under owner-held locks.
-- Application roles retain SELECT-only access to navigation heads.
CREATE OR REPLACE FUNCTION app.page_menu_contains(p_tree jsonb,p_page uuid) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE node jsonb;
BEGIN
 FOR node IN SELECT value FROM jsonb_array_elements(p_tree) LOOP
  IF node->>'visible'='true' AND (node#>>'{target,page_id}'=p_page::text OR app.page_menu_contains(COALESCE(node->'children','[]'::jsonb),p_page)) THEN RETURN true; END IF;
 END LOOP;RETURN false;
END $$;
CREATE OR REPLACE FUNCTION app.page_menu_visibility(p_tree jsonb,p_page uuid,p_title text,p_visible boolean) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE node jsonb; child jsonb; children jsonb; result jsonb:='[]'; saved_label text:=left(p_title,80);
BEGIN
 FOR node IN SELECT value FROM jsonb_array_elements(p_tree) LOOP
  IF node#>>'{target,page_id}'=p_page::text THEN saved_label:=node->>'label';result:=result||COALESCE(node->'children','[]'::jsonb);CONTINUE;END IF;
  children:='[]';
  FOR child IN SELECT value FROM jsonb_array_elements(COALESCE(node->'children','[]'::jsonb)) LOOP
   IF child#>>'{target,page_id}'=p_page::text THEN saved_label:=child->>'label';ELSE children:=children||jsonb_build_array(child);END IF;
  END LOOP;
  IF node ? 'children' THEN node:=jsonb_set(node,'{children}',children);END IF;
  result:=result||jsonb_build_array(node);
 END LOOP;
 IF p_visible THEN result:=result||jsonb_build_array(jsonb_build_object('label',saved_label,'visible',true,'target',jsonb_build_object('type','page','page_id',p_page)));END IF;
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION app.save_page_details(p_page uuid,p_revision bigint,p_title text,p_address text,p_parent uuid,p_in_menu boolean,p_menu_revision bigint)
RETURNS TABLE(revision bigint,draft_version_id uuid,menu_revision bigint,title text,address text,parent_page_id uuid,in_menu boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
#variable_conflict use_column
DECLARE head RECORD; menu_head RECORD; renamed RECORD; parent_revision bigint; changed boolean;
BEGIN
 PERFORM app.require_actor();SELECT * INTO head FROM public.pages WHERE id=p_page FOR UPDATE;
 IF head.id IS NULL OR head.archived_at IS NOT NULL THEN RAISE EXCEPTION 'This page is unavailable.' USING ERRCODE='CMS03';END IF;
 IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'An editor can change page details on this site.' USING ERRCODE='CMS02';END IF;
 IF head.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'The page changed.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 IF p_in_menu IS NULL THEN RAISE EXCEPTION 'Choose whether this page appears in the menu.' USING ERRCODE='CMS04';END IF;
 SELECT n.revision,v.tree INTO menu_head FROM public.navigations n JOIN public.navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=head.site_id FOR UPDATE OF n;
 changed:=app.page_menu_contains(menu_head.tree,p_page) IS DISTINCT FROM p_in_menu;
 IF changed AND menu_head.revision IS DISTINCT FROM p_menu_revision THEN RAISE EXCEPTION 'The menu changed. Reopen Page settings before saving.' USING ERRCODE='CMS01',DETAIL=head.revision::text;END IF;
 SELECT * INTO renamed FROM app.rename_page(p_page,p_revision,p_title,p_address);
 parent_revision:=app.set_page_parent(p_page,renamed.revision,p_parent);
 SELECT n.revision,v.tree INTO menu_head FROM public.navigations n JOIN public.navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=head.site_id;
 IF changed THEN
  SELECT n.revision INTO menu_revision FROM app.save_navigation_draft(head.site_id,menu_head.revision,app.page_menu_visibility(menu_head.tree,p_page,btrim(p_title),p_in_menu),'manual') n;
 ELSE menu_revision:=menu_head.revision;END IF;
 RETURN QUERY SELECT p.revision,p.draft_version_id,menu_revision,p.title,p.slug,p.parent_page_id,p_in_menu FROM public.pages p WHERE p.id=p_page;
END $$;
REVOKE ALL ON FUNCTION app.page_menu_contains(jsonb,uuid),app.page_menu_visibility(jsonb,uuid,text,boolean),app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) FROM PUBLIC;
ALTER FUNCTION app.page_menu_contains(jsonb,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.page_menu_visibility(jsonb,uuid,text,boolean) OWNER TO cms_migration_owner;
ALTER FUNCTION app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.save_page_details(uuid,bigint,text,text,uuid,boolean,bigint) TO cms_authenticated_user;
