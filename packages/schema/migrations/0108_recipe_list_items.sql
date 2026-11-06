-- A page recipe keeps the items of a repeated list (LIB-02). Saving a recipe
-- copies only declared fields, so a list's items, stored beside it as
-- `<list>__<key>__<field>` (0107), were left behind and a recipe made from a
-- page with cards brought the cards back empty. With samples chosen the list
-- keeps its order and every listed item's declared fields; without samples it
-- starts empty, as every other field starts blank. Collection bindings are
-- unchanged: they stay structural and are always kept.
CREATE OR REPLACE FUNCTION app.save_page_recipe(p_site uuid,p_recipe uuid,p_expected bigint,p_name text,p_source uuid,p_selection jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.page_recipes; source public.page_versions; choice jsonb; section jsonb; selected jsonb:='[]'; next_id uuid; vals jsonb;
BEGIN
  actor:=app.require_actor();
  IF NOT app.can_publish(p_site) THEN RAISE EXCEPTION 'only editors can manage recipes' USING ERRCODE='CMS02'; END IF;
  PERFORM 1 FROM public.sites WHERE id=p_site AND status<>'archived' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'site is unavailable' USING ERRCODE='CMS03'; END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'enter a recipe name up to 120 characters' USING ERRCODE='CMS04'; END IF;
  IF p_recipe IS NULL THEN
    IF p_expected IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'reload before saving the recipe' USING ERRCODE='CMS01'; END IF;
    INSERT INTO public.page_recipes(site_id,name) VALUES(p_site,btrim(p_name)) RETURNING * INTO head;
  ELSE
    SELECT * INTO head FROM public.page_recipes WHERE id=p_recipe AND site_id=p_site FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'recipe is unavailable' USING ERRCODE='CMS03'; END IF;
    IF head.revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'recipe changed; reload before saving' USING ERRCODE='CMS01'; END IF;
    IF head.retired_at IS NOT NULL THEN RAISE EXCEPTION 'retired recipes cannot be updated' USING ERRCODE='CMS04'; END IF;
  END IF;
  SELECT * INTO source FROM public.page_versions WHERE id=p_source AND site_id=p_site;
  IF NOT FOUND THEN RAISE EXCEPTION 'choose a saved page from this site' USING ERRCODE='CMS03'; END IF;
  IF jsonb_typeof(p_selection) IS DISTINCT FROM 'array' OR jsonb_array_length(p_selection) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'choose between 1 and 100 sections' USING ERRCODE='CMS04'; END IF;
  FOR choice IN SELECT value FROM jsonb_array_elements(p_selection) LOOP
    IF jsonb_typeof(choice->'index') IS DISTINCT FROM 'number' OR (choice->>'index') !~ '^[0-9]{1,6}$'
      OR jsonb_typeof(choice->'sample') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid section selection' USING ERRCODE='CMS04'; END IF;
    section:=source.content->(choice->>'index')::int;
    IF section IS NULL THEN RAISE EXCEPTION 'source section is unavailable' USING ERRCODE='CMS04'; END IF;
    IF COALESCE(section->>'raw_html','')<>'' OR COALESCE(section->>'custom_css','')<>'' THEN
      RAISE EXCEPTION 'save this section as a governed definition before including it in a recipe' USING ERRCODE='CMS04'; END IF;
    -- Only declared fields are reusable. Required repeat bindings are part of
    -- the composition, not sample records; dropping them produces a page that
    -- cannot render. Ordinary sample values require the explicit checkbox.
    -- A list of items (a repeat declaring `item`) is sample content: with the
    -- checkbox it keeps its order and each listed item's declared fields
    -- (`<list>__<key>__<field>`), without it the list starts empty.
    SELECT COALESCE(jsonb_object_agg(field.key,section->'values'->field.key),'{}'::jsonb) INTO vals FROM (
      SELECT s->>'id' AS key
        FROM public.section_def_versions v CROSS JOIN LATERAL jsonb_array_elements(v.slots) s
       WHERE v.section_def_id=(section->>'section_def_id')::uuid AND v.version=(section->>'section_def_version')::int
         AND section->'values' ? (s->>'id') AND s->>'kind'<>'navigation'
         AND ((choice->>'sample')::boolean OR (s->>'kind'='repeat' AND NOT COALESCE(s->'constraints' ? 'item',false)))
      UNION
      SELECT (s->>'id')||'__'||(item.key #>> '{}')||'__'||(f->>'id')
        FROM public.section_def_versions v CROSS JOIN LATERAL jsonb_array_elements(v.slots) s
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(section->'values'->(s->>'id')->'items')='array'
          THEN section->'values'->(s->>'id')->'items' ELSE '[]'::jsonb END) item(key)
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s->'constraints'->'item'->'fields')='array'
          THEN s->'constraints'->'item'->'fields' ELSE '[]'::jsonb END) f
       WHERE v.section_def_id=(section->>'section_def_id')::uuid AND v.version=(section->>'section_def_version')::int
         AND (choice->>'sample')::boolean AND s->>'kind'='repeat'
         AND jsonb_typeof(item.key)='string' AND (item.key #>> '{}') ~ '^[a-z][a-z0-9]{0,7}$'
         AND section->'values' ? ((s->>'id')||'__'||(item.key #>> '{}')||'__'||(f->>'id'))
    ) field;
    selected:=selected||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'section_def_id',section->'section_def_id','section_def_version',section->'section_def_version',
      'values',vals,'hidden',COALESCE(section->'hidden','false'::jsonb),'hidden_at',COALESCE(section->'hidden_at','[]'::jsonb),
      'label',COALESCE(section->'label','""'::jsonb),'appearance',section->'appearance')));
  END LOOP;
  PERFORM app.assert_page_recipe_content(p_site,selected);
  INSERT INTO public.page_recipe_versions(recipe_id,site_id,revision,source_version_id,content,created_by)
    VALUES(head.id,p_site,head.revision+1,p_source,selected,actor) RETURNING id INTO next_id;
  UPDATE public.page_recipes SET name=btrim(p_name),revision=head.revision+1,current_version_id=next_id WHERE id=head.id;
  PERFORM app.write_audit(p_site,'user',actor,'recipe.save','page_recipe',head.id,head.current_version_id,next_id,'{}');
  RETURN head.id;
END $$;
