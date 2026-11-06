-- A manual, identity-scoped check journal. No scheduler, network call or publication.
CREATE TABLE story_source_checks (
 id uuid PRIMARY KEY, site_id uuid NOT NULL, collection_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES app_users(id), started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 minutes', finished_at timestamptz,
 status text NOT NULL DEFAULT 'checking' CHECK(status IN ('checking','ok','error')),
 result jsonb NOT NULL DEFAULT '{}'::jsonb,
 FOREIGN KEY(site_id,collection_id) REFERENCES collections(site_id,id),
 CHECK(jsonb_typeof(result)='object'),
 CHECK((status='checking' AND finished_at IS NULL) OR (status<>'checking' AND finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX story_source_one_check ON story_source_checks(collection_id) WHERE status='checking';
CREATE INDEX story_source_latest_check ON story_source_checks(collection_id,started_at DESC,id DESC);
CREATE TABLE story_source_baselines (
 site_id uuid NOT NULL, collection_id uuid NOT NULL, source_id text NOT NULL,
 entry_id uuid NOT NULL, fields jsonb NOT NULL,
 PRIMARY KEY(collection_id,source_id), UNIQUE(collection_id,entry_id),
 FOREIGN KEY(site_id,collection_id) REFERENCES collections(site_id,id),
 FOREIGN KEY(entry_id,collection_id) REFERENCES collection_entries(id,collection_id),
 CHECK(source_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
 CHECK(jsonb_typeof(fields)='object')
);
ALTER TABLE story_source_checks OWNER TO cms_migration_owner;
ALTER TABLE story_source_baselines OWNER TO cms_migration_owner;
ALTER TABLE story_source_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_source_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY story_source_checks_member ON story_source_checks FOR SELECT TO cms_authenticated_user USING(app.has_site_access(site_id));
CREATE POLICY story_source_baselines_admin ON story_source_baselines FOR SELECT TO cms_authenticated_user USING(app.can_administer_site(site_id));
REVOKE ALL ON story_source_checks,story_source_baselines FROM PUBLIC,cms_authenticated_user,cms_public_renderer,cms_worker;
GRANT SELECT ON story_source_checks,story_source_baselines TO cms_authenticated_user;

CREATE FUNCTION app.begin_story_source_check(p_site uuid,p_collection uuid,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor(); source record; prior public.story_source_checks; active public.story_source_checks;
BEGIN
 IF NOT app.can_administer_site(p_site) THEN RAISE EXCEPTION 'Site admin access required' USING ERRCODE='CMS02'; END IF;
 SELECT c.id,v.sort INTO source FROM public.collections c JOIN public.collection_schema_versions v ON v.id=c.draft_schema_version_id
  WHERE c.id=p_collection AND c.site_id=p_site AND c.reader_key='stories' FOR UPDATE OF c;
 IF source.id IS NULL THEN RAISE EXCEPTION 'Stories unavailable' USING ERRCODE='CMS03'; END IF;
 IF source.sort#>>'{stories,source}' IS DISTINCT FROM 'sawso' OR p_request IS NULL THEN RAISE EXCEPTION 'Connect the approved story source first' USING ERRCODE='CMS04'; END IF;
 SELECT * INTO prior FROM public.story_source_checks WHERE id=p_request;
 IF prior.id IS NOT NULL THEN
  IF prior.collection_id<>p_collection OR prior.created_by<>actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='CMS03'; END IF;
  IF prior.status='checking' AND prior.lease_until<=clock_timestamp() THEN
   UPDATE public.story_source_checks SET status='error',finished_at=clock_timestamp(),result='{"error":"timeout"}' WHERE id=p_request RETURNING * INTO prior;
  END IF;
  RETURN jsonb_build_object('started',false,'check',to_jsonb(prior));
 END IF;
 UPDATE public.story_source_checks SET status='error',finished_at=clock_timestamp(),result='{"error":"timeout"}'
  WHERE collection_id=p_collection AND status='checking' AND lease_until<=clock_timestamp();
 SELECT * INTO active FROM public.story_source_checks WHERE collection_id=p_collection AND status='checking';
 IF active.id IS NOT NULL THEN RETURN jsonb_build_object('started',false,'check',to_jsonb(active)); END IF;
 INSERT INTO public.story_source_checks(id,site_id,collection_id,created_by) VALUES(p_request,p_site,p_collection,actor) RETURNING * INTO prior;
 RETURN jsonb_build_object('started',true,'check',to_jsonb(prior));
END $$;

-- Called in the same transaction as ordinary draft entry/page commands. A failure rolls all of them back.
CREATE FUNCTION app.finish_story_source_check(p_collection uuid,p_request uuid,p_result jsonb,p_baselines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=app.require_actor(); source record; attempt public.story_source_checks; item jsonb; field_name text; entry uuid;
BEGIN
 SELECT c.id,c.site_id,v.sort INTO source FROM public.collections c JOIN public.collection_schema_versions v ON v.id=c.draft_schema_version_id
  WHERE c.id=p_collection AND c.reader_key='stories' FOR UPDATE OF c;
 IF source.id IS NULL OR NOT app.can_administer_site(source.site_id) THEN RAISE EXCEPTION 'Site admin access required' USING ERRCODE='CMS02'; END IF;
 SELECT * INTO attempt FROM public.story_source_checks WHERE id=p_request AND collection_id=p_collection FOR UPDATE;
 IF attempt.id IS NULL OR attempt.created_by<>actor THEN RAISE EXCEPTION 'Check unavailable' USING ERRCODE='CMS03'; END IF;
 IF attempt.status<>'checking' THEN RETURN to_jsonb(attempt); END IF;
 IF source.sort#>>'{stories,source}' IS DISTINCT FROM 'sawso' OR attempt.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'Check expired or source changed; try again' USING ERRCODE='CMS01'; END IF;
 IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid check result' USING ERRCODE='CMS04'; END IF;
 IF p_result ? 'error' THEN
  IF (p_result-ARRAY['error'])<>'{}'::jsonb OR jsonb_typeof(p_result->'error') IS DISTINCT FROM 'string' OR p_result->>'error' NOT IN ('network','format','save','timeout') OR p_baselines IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'Invalid check failure' USING ERRCODE='CMS04'; END IF;
 ELSE
  IF NOT(p_result ?& ARRAY['added','updated','removed','total','preserved']) OR (p_result-ARRAY['added','updated','removed','total','preserved'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid check counts' USING ERRCODE='CMS04'; END IF;
  FOREACH field_name IN ARRAY ARRAY['added','updated','removed','total','preserved'] LOOP
   IF jsonb_typeof(p_result->field_name) IS DISTINCT FROM 'number' OR COALESCE(p_result->>field_name,'')!~'^[0-9]{1,5}$' OR (p_result->>field_name)::int>10000 THEN RAISE EXCEPTION 'Invalid check count' USING ERRCODE='CMS04'; END IF;
  END LOOP;
  IF jsonb_typeof(p_baselines) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid source records' USING ERRCODE='CMS04'; END IF;
  IF jsonb_array_length(p_baselines)>10000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_baselines) b GROUP BY b->>'sourceId' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_baselines) b GROUP BY b->>'stableKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate or excessive source records' USING ERRCODE='CMS04'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_baselines) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['sourceId','stableKey','fields']) OR (item-ARRAY['sourceId','stableKey','fields'])<>'{}'::jsonb OR jsonb_typeof(item->'sourceId') IS DISTINCT FROM 'string' OR (item->>'sourceId')!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$' OR jsonb_typeof(item->'stableKey') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'fields') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid source record' USING ERRCODE='CMS04'; END IF;
   IF NOT((item->'fields') ?& ARRAY['title','summary','published_date','old_address','image_url']) OR ((item->'fields')-ARRAY['title','summary','published_date','old_address','image_url'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid source fields' USING ERRCODE='CMS04'; END IF;
   FOREACH field_name IN ARRAY ARRAY['title','summary','published_date','old_address','image_url'] LOOP
    IF jsonb_typeof(item#>ARRAY['fields',field_name]) IS DISTINCT FROM 'string' OR char_length(item#>>ARRAY['fields',field_name])>2048 THEN RAISE EXCEPTION 'Invalid source text' USING ERRCODE='CMS04'; END IF;
   END LOOP;
   SELECT id INTO entry FROM public.collection_entries WHERE collection_id=p_collection AND site_id=source.site_id AND stable_key=item->>'stableKey';
   IF entry IS NULL THEN RAISE EXCEPTION 'Source story unavailable' USING ERRCODE='CMS04'; END IF;
   IF EXISTS(SELECT 1 FROM public.story_source_baselines WHERE collection_id=p_collection AND ((source_id=item->>'sourceId' AND entry_id<>entry) OR (entry_id=entry AND source_id<>item->>'sourceId'))) THEN RAISE EXCEPTION 'Source identity cannot change' USING ERRCODE='CMS04'; END IF;
   INSERT INTO public.story_source_baselines(site_id,collection_id,source_id,entry_id,fields) VALUES(source.site_id,p_collection,item->>'sourceId',entry,item->'fields') ON CONFLICT(collection_id,source_id) DO UPDATE SET fields=excluded.fields;
  END LOOP;
 END IF;
 UPDATE public.story_source_checks SET status=CASE WHEN p_result?'error' THEN 'error' ELSE 'ok' END,finished_at=clock_timestamp(),result=p_result WHERE id=p_request RETURNING * INTO attempt;
 PERFORM app.write_audit(source.site_id,'user',actor,'stories.source_checked','collection',p_collection,NULL,NULL,jsonb_build_object('checkId',p_request,'result',p_result));
 RETURN to_jsonb(attempt);
END $$;
REVOKE ALL ON FUNCTION app.begin_story_source_check(uuid,uuid,uuid),app.finish_story_source_check(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
ALTER FUNCTION app.begin_story_source_check(uuid,uuid,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.finish_story_source_check(uuid,uuid,jsonb,jsonb) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.begin_story_source_check(uuid,uuid,uuid),app.finish_story_source_check(uuid,uuid,jsonb,jsonb) TO cms_authenticated_user;
