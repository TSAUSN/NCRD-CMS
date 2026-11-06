-- Immutable offline-source import journal. Runtime records and identities are
-- never inferred from V1 data: only a current super admin can stage/review it.
CREATE TABLE public.v1_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text UNIQUE NOT NULL CHECK(run_key ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text NOT NULL CHECK(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  bundle jsonb NOT NULL CHECK(app.json_within(bundle,67108864)),
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.v1_import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.v1_import_runs(id),
  source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 1000),
  kind text NOT NULL,
  source_site text,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL,
  issues jsonb NOT NULL CHECK(jsonb_typeof(issues)='array'),
  UNIQUE(run_id,source_key)
);
CREATE TABLE public.v1_import_decisions (
  id uuid PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.v1_import_records(id),
  revision bigint NOT NULL CHECK(revision>0),
  disposition text NOT NULL CHECK(disposition IN ('needs_review','mapped','exception')),
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 20 AND 5000),
  target_page_version uuid REFERENCES public.page_versions(id),
  evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(record_id,revision)
);
CREATE TABLE public.v1_import_targets (
  run_id uuid NOT NULL REFERENCES public.v1_import_runs(id),
  source_key text NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  page_id uuid NOT NULL REFERENCES public.pages(id),
  version_id uuid NOT NULL REFERENCES public.page_versions(id),
  PRIMARY KEY(run_id,source_key),
  FOREIGN KEY(run_id,source_key) REFERENCES public.v1_import_records(run_id,source_key)
);

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['v1_import_runs','v1_import_records','v1_import_decisions','v1_import_targets'] LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO cms_migration_owner',name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO cms_authenticated_user USING(app.is_super_admin())',name||'_read',name);
    EXECUTE format('GRANT SELECT ON public.%I TO cms_authenticated_user',name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only()',name||'_immutable',name);
  END LOOP;
END $$;

CREATE FUNCTION app.stage_v1_import(p_bundle jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; run_id uuid; existing RECORD; entry jsonb; record_id uuid; actual_documents int; actual_parents int;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin can import V1 data' USING ERRCODE='CMS02'; END IF;
  IF p_bundle IS NULL OR NOT app.json_within(p_bundle,67108864) OR p_bundle->>'format' IS DISTINCT FROM 'cms-v1-migration'
    OR p_bundle->>'version' IS DISTINCT FROM '1' OR COALESCE(p_bundle->>'runId','') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_bundle->>'manifestSha256','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_bundle->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_bundle->'records')>10000
    OR jsonb_typeof(p_bundle->'files') IS DISTINCT FROM 'array' OR jsonb_typeof(p_bundle->'counts') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_bundle->'references') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid V1 migration package' USING ERRCODE='CMS04';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_bundle->>'runId',66));
  SELECT * INTO existing FROM public.v1_import_runs WHERE run_key=p_bundle->>'runId';
  IF existing IS NOT NULL THEN
    IF existing.bundle<>p_bundle THEN RAISE EXCEPTION 'this import identity already names different source data' USING ERRCODE='CMS04'; END IF;
    RETURN existing.id;
  END IF;
  SELECT count(*) FILTER(WHERE item->>'key' LIKE 'backup/%' AND item->'payload'<>'null'::jsonb),
    count(*) FILTER(WHERE item->>'key' LIKE 'backup/%' AND item->'payload'='null'::jsonb)
    INTO actual_documents,actual_parents FROM jsonb_array_elements(p_bundle->'records') item;
  IF (p_bundle->'counts'->>'documents')::int IS DISTINCT FROM actual_documents
    OR (p_bundle->'counts'->>'placeholders')::int IS DISTINCT FROM actual_parents THEN
    RAISE EXCEPTION 'source record counts do not reconcile' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.v1_import_runs(run_key,manifest_sha256,bundle,created_by)
    VALUES(p_bundle->>'runId',p_bundle->>'manifestSha256',p_bundle,actor) RETURNING id INTO run_id;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_bundle->'records') LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR NOT entry ? 'payload'
      OR COALESCE(entry->>'key','') !~ '^(backup|catalogue|source)/[^[:cntrl:]]+$'
      OR COALESCE(entry->>'sourceSha256','') !~ '^[0-9a-f]{64}$'
      OR entry->>'kind' IS NULL OR length(entry->>'kind') NOT BETWEEN 1 AND 80
      OR jsonb_typeof(entry->'issues') IS DISTINCT FROM 'array'
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry->'issues') issue WHERE jsonb_typeof(issue)<>'string') THEN
      RAISE EXCEPTION 'invalid V1 source record' USING ERRCODE='CMS04';
    END IF;
    INSERT INTO public.v1_import_records(run_id,source_key,kind,source_site,source_sha256,payload,issues)
      VALUES(run_id,entry->>'key',entry->>'kind',entry->>'sourceSite',entry->>'sourceSha256',entry->'payload',entry->'issues') RETURNING id INTO record_id;
    IF entry->>'kind'='release-note' THEN
      PERFORM app.write_audit(NULL,'migration',NULL,'migration.v1.release_note','v1_import_record',record_id,NULL,NULL,
        jsonb_build_object('run_id',run_id,'source_sha256',entry->>'sourceSha256','source_action',left(entry->'payload'->>'action',200),
          'source_timestamp',entry->'payload'->'timestamp'));
    END IF;
  END LOOP;
  PERFORM app.write_audit(NULL,'migration',NULL,'migration.v1.stage','v1_import_run',run_id,NULL,NULL,
    jsonb_build_object('source_manifest',p_bundle->>'manifestSha256','counts',p_bundle->'counts'));
  RETURN run_id;
END $$;

CREATE FUNCTION app.review_v1_record(p_request_id uuid,p_record_id uuid,p_expected_revision bigint,p_disposition text,p_note text,p_target uuid,p_evidence text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; record RECORD; previous RECORD; revision bigint;
BEGIN
  actor:=app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin reviews V1 imports' USING ERRCODE='CMS02'; END IF;
  SELECT * INTO record FROM public.v1_import_records WHERE id=p_record_id FOR UPDATE;
  IF record IS NULL THEN RAISE EXCEPTION 'source record not found' USING ERRCODE='CMS03'; END IF;
  SELECT * INTO previous FROM public.v1_import_decisions WHERE id=p_request_id;
  IF previous IS NOT NULL THEN
    IF previous.record_id<>p_record_id OR previous.created_by<>actor OR previous.disposition<>p_disposition OR previous.note<>p_note
      OR previous.target_page_version IS DISTINCT FROM p_target OR previous.evidence<>p_evidence OR previous.revision<>p_expected_revision+1 THEN
      RAISE EXCEPTION 'review receipt already used for another decision' USING ERRCODE='CMS04';
    END IF;
    RETURN previous.revision;
  END IF;
  SELECT COALESCE(max(d.revision),0) INTO revision FROM public.v1_import_decisions d WHERE d.record_id=p_record_id;
  IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'source review changed; reload before saving' USING ERRCODE='CMS01'; END IF;
  IF p_disposition='mapped' AND (p_target IS NULL OR NOT EXISTS(SELECT 1 FROM public.page_versions WHERE id=p_target)) THEN
    RAISE EXCEPTION 'mapped source needs an existing immutable V2 page version' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.v1_import_decisions(id,record_id,revision,disposition,note,target_page_version,evidence,created_by)
    VALUES(p_request_id,p_record_id,revision+1,p_disposition,p_note,p_target,p_evidence,actor);
  PERFORM app.write_audit(NULL,'user',actor,'migration.v1.review','v1_import_record',p_record_id,NULL,p_target,
    jsonb_build_object('revision',revision+1,'disposition',p_disposition,'decision_id',p_request_id));
  RETURN revision+1;
END $$;

CREATE FUNCTION app.record_v1_reference_target(p_run_id uuid,p_source_key text,p_site_id uuid,p_page_id uuid,p_version_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF NOT app.is_super_admin() THEN RAISE EXCEPTION 'only a super admin maps V1 reference drafts' USING ERRCODE='CMS02'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.pages p JOIN public.page_versions v ON v.page_id=p.id
    WHERE p.id=p_page_id AND p.site_id=p_site_id AND v.id=p_version_id AND p.draft_version_id=v.id AND p.published_version_id IS NULL) THEN
    RAISE EXCEPTION 'reference target must be the draft of an unpublished page in this site' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.v1_import_targets(run_id,source_key,site_id,page_id,version_id) VALUES(p_run_id,p_source_key,p_site_id,p_page_id,p_version_id);
  PERFORM app.write_audit(p_site_id,'migration',NULL,'migration.v1.reference_draft','page',p_page_id,NULL,p_version_id,
    jsonb_build_object('run_id',p_run_id));
END $$;

DO $$ DECLARE sig text; BEGIN
  FOREACH sig IN ARRAY ARRAY['app.stage_v1_import(jsonb)','app.review_v1_record(uuid,uuid,bigint,text,text,uuid,text)',
    'app.record_v1_reference_target(uuid,text,uuid,uuid,uuid)'] LOOP
    EXECUTE 'ALTER FUNCTION '||sig||' OWNER TO cms_migration_owner';
    EXECUTE 'REVOKE ALL ON FUNCTION '||sig||' FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||sig||' TO cms_authenticated_user';
  END LOOP;
END $$;
