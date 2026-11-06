-- Whole-collection review pins one schema and every draft entry, including
-- order/removals. Review decisions reuse the ordinary publication commands.
CREATE TABLE public.collection_review_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  schema_version_id uuid NOT NULL,
  schema_revision bigint NOT NULL,
  entry_revision bigint NOT NULL,
  submitted jsonb NOT NULL,
  live_at_submission jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(site_id,collection_id) REFERENCES public.collections(site_id,id),
  FOREIGN KEY(collection_id,schema_version_id) REFERENCES public.collection_schema_versions(collection_id,id)
);
CREATE TABLE public.collection_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL UNIQUE REFERENCES public.collection_review_snapshots(id),
  site_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  status public.submission_status NOT NULL DEFAULT 'open',
  submitted_by uuid NOT NULL REFERENCES public.app_users(id),
  note text NOT NULL DEFAULT '' CHECK(octet_length(note)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES public.app_users(id),
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK(octet_length(decision_note)<=4096),
  FOREIGN KEY(site_id,collection_id) REFERENCES public.collections(site_id,id),
  CHECK((status IN ('open','superseded') AND decided_by IS NULL AND decided_at IS NULL)
     OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK(status<>'rejected' OR length(btrim(decision_note))>0)
);
CREATE UNIQUE INDEX collection_reviews_one_open ON public.collection_reviews(collection_id) WHERE status='open';
CREATE INDEX collection_reviews_site_status ON public.collection_reviews(site_id,status,created_at DESC);
CREATE TABLE public.collection_review_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.collection_reviews(id),
  body text NOT NULL CHECK(length(btrim(body))>0 AND octet_length(body)<=4000),
  mentions jsonb NOT NULL DEFAULT '[]',
  author_id uuid NOT NULL REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.app_users(id),
  resolved_at timestamptz,
  CHECK((resolved_by IS NULL)=(resolved_at IS NULL))
);

ALTER TABLE public.collection_review_snapshots OWNER TO cms_migration_owner;
ALTER TABLE public.collection_reviews OWNER TO cms_migration_owner;
ALTER TABLE public.collection_review_comments OWNER TO cms_migration_owner;
ALTER TABLE public.collection_review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_review_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_reviews_read ON public.collection_reviews FOR SELECT TO cms_authenticated_user
  USING(app.has_site_access(site_id) AND (submitted_by=app.current_user_id() OR app.can_review(site_id)));
CREATE POLICY collection_review_snapshots_read ON public.collection_review_snapshots FOR SELECT TO cms_authenticated_user
  USING(EXISTS(SELECT 1 FROM public.collection_reviews r WHERE r.snapshot_id=collection_review_snapshots.id));
CREATE POLICY collection_review_comments_read ON public.collection_review_comments FOR SELECT TO cms_authenticated_user
  USING(EXISTS(SELECT 1 FROM public.collection_reviews r WHERE r.id=collection_review_comments.review_id));
GRANT SELECT ON public.collection_reviews,public.collection_review_snapshots,public.collection_review_comments TO cms_authenticated_user;
CREATE TRIGGER collection_review_snapshots_immutable BEFORE UPDATE OR DELETE ON public.collection_review_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

-- Snapshot display data and pins are obtained together under the collection
-- lock by submit. Read callers only get this through the authorized queue.
CREATE FUNCTION app.collection_review_content(p_collection_id uuid,p_live boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('name',c.name,'schemaId',v.id,'fields',COALESCE(v.fields,'[]'::jsonb),
    'presentation',v.sort,'entries',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',e.id,'versionId',ev.id,'stableKey',e.stable_key,
        'sortIndex',CASE WHEN p_live THEN e.published_sort_index ELSE e.sort_index END,
        'archived',CASE WHEN p_live THEN e.published_archived_at IS NOT NULL ELSE e.archived_at IS NOT NULL END,
        'values',ev."values") ORDER BY CASE WHEN p_live THEN e.published_sort_index ELSE e.sort_index END NULLS LAST,e.id)
      FROM public.collection_entries e LEFT JOIN public.collection_entry_versions ev
        ON ev.id=CASE WHEN p_live THEN e.published_version_id ELSE e.draft_version_id END
      WHERE e.collection_id=c.id AND (NOT p_live OR e.published_version_id IS NOT NULL)
    ),'[]'::jsonb))
  FROM public.collections c LEFT JOIN public.collection_schema_versions v
    ON v.id=CASE WHEN p_live THEN c.published_schema_version_id ELSE c.draft_schema_version_id END
  WHERE c.id=p_collection_id
$$;

CREATE FUNCTION app.submit_collection_for_review(p_collection_id uuid,p_schema_revision bigint,p_entry_revision bigint,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; existing public.collection_reviews%ROWTYPE; snap uuid; result uuid; clean_note text;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.has_site_access(head.site_id) THEN RAISE EXCEPTION 'not permitted to submit this collection' USING ERRCODE='CMS02'; END IF;
  IF EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND status='archived') THEN RAISE EXCEPTION 'restore this site before submitting content' USING ERRCODE='CMS04'; END IF;
  IF p_schema_revision IS NULL OR p_entry_revision IS NULL OR head.revision<>p_schema_revision OR head.entry_revision<>p_entry_revision THEN
    RAISE EXCEPTION 'the collection changed; reload and submit the saved draft again' USING ERRCODE='CMS01';
  END IF;
  IF head.draft_schema_version_id IS NULL THEN RAISE EXCEPTION 'save a collection schema first' USING ERRCODE='CMS04'; END IF;
  clean_note:=btrim(COALESCE(p_note,''));
  IF octet_length(clean_note)>4096 THEN RAISE EXCEPTION 'review note is too long' USING ERRCODE='CMS04'; END IF;
  SELECT * INTO existing FROM public.collection_reviews WHERE collection_id=head.id AND status='open';
  IF FOUND THEN
    IF existing.submitted_by<>actor THEN RAISE EXCEPTION 'this collection is already waiting for review' USING ERRCODE='CMS04'; END IF;
    IF existing.note<>clean_note THEN RAISE EXCEPTION 'this saved draft is already submitted; add context in its discussion' USING ERRCODE='CMS04'; END IF;
    RETURN existing.id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.collection_entries e LEFT JOIN public.collection_entry_versions v ON v.id=e.draft_version_id
    WHERE e.collection_id=head.id AND e.archived_at IS NULL AND (v.id IS NULL OR v.schema_version_id<>head.draft_schema_version_id)) THEN
    RAISE EXCEPTION 'save the entries against the current fields before submitting' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.collection_review_snapshots(site_id,collection_id,schema_version_id,schema_revision,entry_revision,submitted,live_at_submission)
    VALUES(head.site_id,head.id,head.draft_schema_version_id,head.revision,head.entry_revision,
      app.collection_review_content(head.id,false),app.collection_review_content(head.id,true)) RETURNING id INTO snap;
  INSERT INTO public.collection_reviews(snapshot_id,site_id,collection_id,submitted_by,note)
    VALUES(snap,head.site_id,head.id,actor,clean_note) RETURNING id INTO result;
  PERFORM app.write_audit(head.site_id,'user',actor,'collection.review.submitted','collection',head.id,NULL,snap,jsonb_build_object('review_id',result));
  RETURN result;
END $$;

CREATE FUNCTION app.supersede_collection_reviews() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE stale record; actor uuid;
BEGIN
  IF ROW(NEW.revision,NEW.entry_revision,NEW.draft_schema_version_id) IS NOT DISTINCT FROM ROW(OLD.revision,OLD.entry_revision,OLD.draft_schema_version_id) THEN RETURN NEW; END IF;
  actor:=app.current_user_id();
  FOR stale IN UPDATE public.collection_reviews SET status='superseded' WHERE collection_id=NEW.id AND status='open' RETURNING id,snapshot_id LOOP
    PERFORM app.write_audit(NEW.site_id,CASE WHEN actor IS NULL THEN 'system'::public.actor_type ELSE 'user'::public.actor_type END,
      actor,'collection.review.superseded','collection',NEW.id,stale.snapshot_id,NULL,jsonb_build_object('review_id',stale.id));
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER collections_supersede_review AFTER UPDATE OF revision,entry_revision,draft_schema_version_id ON public.collections
  FOR EACH ROW EXECUTE FUNCTION app.supersede_collection_reviews();

-- Keep existing entry/schema validation and transactional invalidation in one
-- implementation. Neither HTTP actions nor whole-site releases bypass review.
ALTER FUNCTION app.publish_collection_entries(uuid,bigint) RENAME TO publish_collection_entries_core;
ALTER FUNCTION app.publish_collection_schema(uuid,bigint) RENAME TO publish_collection_schema_core;
-- PL/pgSQL output variables were qualified by their original function name.
DO $$ BEGIN
  EXECUTE replace(pg_get_functiondef('app.publish_collection_entries_core(uuid,bigint)'::regprocedure),
    'publish_collection_entries.', 'publish_collection_entries_core.');
  EXECUTE replace(pg_get_functiondef('app.publish_collection_schema_core(uuid,bigint)'::regprocedure),
    'publish_collection_schema.', 'publish_collection_schema_core.');
END $$;
REVOKE ALL ON FUNCTION app.publish_collection_entries_core(uuid,bigint),app.publish_collection_schema_core(uuid,bigint) FROM PUBLIC,cms_authenticated_user;
CREATE FUNCTION app.guard_collection_review_publication(p_collection_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE head public.collections%ROWTYPE;
BEGIN
  PERFORM app.require_actor();
  SELECT * INTO head FROM public.collections WHERE id=p_collection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'collection not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_publish(head.site_id) THEN RAISE EXCEPTION 'not permitted to publish this collection' USING ERRCODE='CMS02'; END IF;
  IF EXISTS(SELECT 1 FROM public.sites WHERE id=head.site_id AND status='archived') THEN RAISE EXCEPTION 'restore this site before publishing content' USING ERRCODE='CMS04'; END IF;
  IF EXISTS(SELECT 1 FROM public.collection_reviews WHERE collection_id=head.id AND status='open') THEN
    RAISE EXCEPTION 'this collection is waiting for review; approve or return its submission' USING ERRCODE='CMS04';
  END IF;
END $$;
CREATE FUNCTION app.publish_collection_entries(p_collection_id uuid,p_expected_entry_revision bigint)
RETURNS TABLE(entry_revision bigint,published_entry_revision bigint,published_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.guard_collection_review_publication(p_collection_id);
  RETURN QUERY SELECT * FROM app.publish_collection_entries_core(p_collection_id,p_expected_entry_revision);
END $$;
CREATE FUNCTION app.publish_collection_schema(p_collection_id uuid,p_expected_revision bigint)
RETURNS TABLE(schema_version_id uuid,revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.guard_collection_review_publication(p_collection_id);
  RETURN QUERY SELECT * FROM app.publish_collection_schema_core(p_collection_id,p_expected_revision);
END $$;

CREATE FUNCTION app.decide_collection_review(p_review_id uuid,p_approve boolean,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; head public.collections%ROWTYPE; request public.collection_reviews%ROWTYPE; snap public.collection_review_snapshots%ROWTYPE; clean_reason text;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO request FROM public.collection_reviews WHERE id=p_review_id;
  IF NOT FOUND OR NOT app.has_site_access(request.site_id) THEN RAISE EXCEPTION 'review request not found' USING ERRCODE='CMS03'; END IF;
  IF NOT app.can_review(request.site_id) THEN RAISE EXCEPTION 'an editor must make this decision' USING ERRCODE='CMS02'; END IF;
  -- Lock order matches every collection command: head before request.
  SELECT * INTO head FROM public.collections WHERE id=request.collection_id FOR UPDATE;
  SELECT * INTO request FROM public.collection_reviews WHERE id=p_review_id FOR UPDATE;
  SELECT * INTO snap FROM public.collection_review_snapshots WHERE id=request.snapshot_id;
  clean_reason:=btrim(COALESCE(p_reason,''));
  IF p_approve IS NULL OR octet_length(clean_reason)>4096 OR (NOT p_approve AND clean_reason='') THEN RAISE EXCEPTION 'returning a submission requires feedback (at most 4096 bytes)' USING ERRCODE='CMS04'; END IF;
  IF request.status=(CASE WHEN p_approve THEN 'approved'::public.submission_status ELSE 'rejected'::public.submission_status END)
     AND request.decided_by=actor AND request.decision_note=clean_reason THEN RETURN request.snapshot_id; END IF;
  IF request.status<>'open' OR head.revision<>snap.schema_revision OR head.entry_revision<>snap.entry_revision
     OR head.draft_schema_version_id<>snap.schema_version_id OR app.collection_review_content(head.id,false)<>snap.submitted THEN
    RAISE EXCEPTION 'this submission no longer matches the saved draft; inspect the changes and ask the author to submit again' USING ERRCODE='CMS01';
  END IF;
  UPDATE public.collection_reviews SET status=CASE WHEN p_approve THEN 'approved'::public.submission_status ELSE 'rejected'::public.submission_status END,
    decided_by=actor,decided_at=clock_timestamp(),decision_note=clean_reason WHERE id=request.id;
  IF p_approve THEN
    IF head.published_schema_version_id IS DISTINCT FROM snap.schema_version_id THEN
      PERFORM app.publish_collection_schema(head.id,head.revision);
    END IF;
    PERFORM app.publish_collection_entries(head.id,head.entry_revision);
  END IF;
  PERFORM app.write_audit(request.site_id,'user',actor,CASE WHEN p_approve THEN 'collection.review.approved' ELSE 'collection.review.rejected' END,
    'collection',head.id,NULL,snap.id,jsonb_build_object('review_id',request.id,'reason',clean_reason));
  RETURN snap.id;
END $$;

CREATE FUNCTION app.collection_review_queue(p_site_id uuid DEFAULT NULL,p_review_id uuid DEFAULT NULL,p_collection_id uuid DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid;
BEGIN
  actor:=app.require_actor();
  RETURN QUERY SELECT jsonb_build_object('id',r.id,'siteId',r.site_id,'siteName',site.name,'collectionId',r.collection_id,
    'snapshotId',s.id,'status',r.status,'note',r.note,'decisionNote',r.decision_note,'submittedAt',r.created_at,
    'submittedByName',COALESCE(NULLIF(u.display_name,''),u.email),'decidedAt',r.decided_at,
    'canReview',app.can_review(r.site_id),'canApprove',app.can_review(r.site_id) AND
      (c.published_schema_version_id IS NOT DISTINCT FROM s.schema_version_id OR app.can_administer_site(r.site_id)),
    'isCurrent',app.collection_review_content(c.id,false)=s.submitted,
    'submitted',s.submitted,'live',s.live_at_submission,'current',app.collection_review_content(c.id,false),
    'commentCount',(SELECT count(*) FROM public.collection_review_comments cm WHERE cm.review_id=r.id),
    'unresolvedCount',(SELECT count(*) FROM public.collection_review_comments cm WHERE cm.review_id=r.id AND cm.resolved_at IS NULL))
  FROM public.collection_reviews r JOIN public.collection_review_snapshots s ON s.id=r.snapshot_id
    JOIN public.collections c ON c.id=r.collection_id JOIN public.sites site ON site.id=r.site_id JOIN public.app_users u ON u.id=r.submitted_by
  WHERE app.has_site_access(r.site_id) AND (r.submitted_by=actor OR app.can_review(r.site_id))
    AND (p_site_id IS NULL OR r.site_id=p_site_id) AND (p_review_id IS NULL OR r.id=p_review_id)
    AND (p_collection_id IS NULL OR r.collection_id=p_collection_id)
  ORDER BY (r.status='open') DESC,r.created_at DESC LIMIT 100;
END $$;

CREATE FUNCTION app.add_collection_review_comment(p_review_id uuid,p_body text,p_mentions jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; request public.collection_reviews%ROWTYPE; result uuid;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO request FROM public.collection_reviews WHERE id=p_review_id FOR UPDATE;
  IF NOT FOUND OR NOT app.has_site_access(request.site_id) OR NOT(request.submitted_by=actor OR app.can_review(request.site_id)) THEN
    RAISE EXCEPTION 'review request not found' USING ERRCODE='CMS03'; END IF;
  IF request.status<>'open' THEN RAISE EXCEPTION 'this review has already closed' USING ERRCODE='CMS04'; END IF;
  IF p_body IS NULL OR btrim(p_body)='' OR octet_length(btrim(p_body))>4000 THEN RAISE EXCEPTION 'write a comment of at most 4000 bytes' USING ERRCODE='CMS04'; END IF;
  IF p_mentions IS NULL OR jsonb_typeof(p_mentions)<>'array' OR jsonb_array_length(p_mentions)>20 THEN RAISE EXCEPTION 'choose at most 20 teammates' USING ERRCODE='CMS04'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_mentions) m WHERE jsonb_typeof(m)<>'string' OR (m#>>'{}')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'a mention must name a teammate' USING ERRCODE='CMS04'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_mentions) m WHERE NOT EXISTS(SELECT 1 FROM app.review_people(request.site_id) p WHERE p.id=m::uuid)) THEN
    RAISE EXCEPTION 'a mentioned teammate is not active on this site' USING ERRCODE='CMS04'; END IF;
  INSERT INTO public.collection_review_comments(review_id,body,mentions,author_id) VALUES(request.id,btrim(p_body),p_mentions,actor) RETURNING id INTO result;
  PERFORM app.write_audit(request.site_id,'user',actor,'collection.review.comment_added','comment',result,NULL,request.snapshot_id,jsonb_build_object('review_id',request.id,'mentions',p_mentions));
  RETURN result;
END $$;
CREATE FUNCTION app.resolve_collection_review_comment(p_comment_id uuid,p_resolved boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; request public.collection_reviews%ROWTYPE; comment public.collection_review_comments%ROWTYPE;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO comment FROM public.collection_review_comments WHERE id=p_comment_id FOR UPDATE;
  SELECT * INTO request FROM public.collection_reviews WHERE id=comment.review_id;
  IF request.id IS NULL OR NOT app.has_site_access(request.site_id) OR NOT(request.submitted_by=actor OR app.can_review(request.site_id)) THEN
    RAISE EXCEPTION 'review comment not found' USING ERRCODE='CMS03'; END IF;
  IF NOT(comment.author_id=actor OR app.can_review(request.site_id)) THEN RAISE EXCEPTION 'only the author or an editor can resolve this comment' USING ERRCODE='CMS02'; END IF;
  IF p_resolved IS NULL THEN RAISE EXCEPTION 'choose whether the comment is resolved' USING ERRCODE='CMS04'; END IF;
  IF (comment.resolved_at IS NOT NULL)=p_resolved THEN RETURN request.id; END IF;
  UPDATE public.collection_review_comments SET resolved_at=CASE WHEN p_resolved THEN clock_timestamp() END,
    resolved_by=CASE WHEN p_resolved THEN actor END WHERE id=comment.id;
  PERFORM app.write_audit(request.site_id,'user',actor,CASE WHEN p_resolved THEN 'collection.review.comment_resolved' ELSE 'collection.review.comment_reopened' END,
    'comment',comment.id,NULL,request.snapshot_id,jsonb_build_object('review_id',request.id));
  RETURN request.id;
END $$;
CREATE FUNCTION app.collection_review_comments(p_review_id uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid; request public.collection_reviews%ROWTYPE;
BEGIN
  actor:=app.require_actor();
  SELECT * INTO request FROM public.collection_reviews WHERE id=p_review_id;
  IF NOT FOUND OR NOT app.has_site_access(request.site_id) OR NOT(request.submitted_by=actor OR app.can_review(request.site_id)) THEN RETURN; END IF;
  RETURN QUERY SELECT jsonb_build_object('id',c.id,'body',c.body,'mentions',c.mentions,'authorName',COALESCE(NULLIF(u.display_name,''),u.email),
    'createdAt',c.created_at,'resolvedAt',c.resolved_at,'canResolve',c.author_id=actor OR app.can_review(request.site_id))
    FROM public.collection_review_comments c JOIN public.app_users u ON u.id=c.author_id WHERE c.review_id=request.id ORDER BY c.created_at,c.id;
END $$;

DO $$ DECLARE sig regprocedure; BEGIN
  FOR sig IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND p.proname IN ('collection_review_content','submit_collection_for_review','supersede_collection_reviews',
      'guard_collection_review_publication','publish_collection_entries','publish_collection_schema','decide_collection_review',
      'collection_review_queue','add_collection_review_comment','resolve_collection_review_comment','collection_review_comments') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner',sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',sig);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION app.submit_collection_for_review(uuid,bigint,bigint,text),app.publish_collection_entries(uuid,bigint),
  app.publish_collection_schema(uuid,bigint),app.decide_collection_review(uuid,boolean,text),app.collection_review_queue(uuid,uuid,uuid),
  app.add_collection_review_comment(uuid,text,jsonb),app.resolve_collection_review_comment(uuid,boolean),app.collection_review_comments(uuid)
TO cms_authenticated_user;

ALTER FUNCTION app.inbox_snapshot() RENAME TO inbox_snapshot_without_collection_reviews;
REVOKE ALL ON FUNCTION app.inbox_snapshot_without_collection_reviews() FROM PUBLIC,cms_authenticated_user;
CREATE FUNCTION app.inbox_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE base jsonb; amount integer;
BEGIN
  PERFORM app.require_actor();
  base:=app.inbox_snapshot_without_collection_reviews();
  SELECT count(*)::integer INTO amount FROM public.collection_reviews r WHERE r.status='open'
    AND app.has_site_access(r.site_id) AND (r.submitted_by=app.current_user_id() OR app.can_review(r.site_id));
  RETURN base || jsonb_build_object('collectionReviews',amount,'reviews',(base->>'reviews')::integer+amount);
END $$;
ALTER FUNCTION app.inbox_snapshot() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.inbox_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.inbox_snapshot() TO cms_authenticated_user;
