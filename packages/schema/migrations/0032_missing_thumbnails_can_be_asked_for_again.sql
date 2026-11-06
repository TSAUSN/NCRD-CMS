-- 0032 — a section whose thumbnail request died can ask again.
--
-- 0028 emitted one `section_def.thumbnail_requested` per existing version so the
-- library would not open with blanks where the imported sections are. That is
-- the right idea and it has a deploy-order hazard: the migration runs against a
-- database whose worker is still the previous build, that worker has no handler
-- for an event type it has never heard of, and `drainOutbox` dead-letters an
-- unhandled type rather than guessing. The estate then consists of terminal rows
-- that nothing retries, and every one of those definitions has a blank card
-- forever — which looks exactly like a feature that does not work.
--
-- It happened here, on a development database, which is where a hazard like this
-- is supposed to be found. The permanent answer is not to reorder the deploy: it
-- is for "which versions have no picture" to be a question that can be asked
-- again, by a process that has a screenshotter, at a time of its choosing.
--
-- WHY THIS CANNOT LOOP
--
-- A sweep that emits for every version with no thumbnail would emit again on the
-- next tick for every version still waiting, and a worker restarting in a tight
-- loop would fill the outbox with duplicates of work already queued. So the
-- predicate is "no thumbnail *and* nothing already asking for one", where asking
-- means an outbox row for this event type, naming this version, that has not
-- reached a terminal state. A dead row is terminal and therefore does not
-- suppress a fresh request, which is the case this function exists for; a
-- pending or running one does.
--
-- The count comes back so a caller can log a real number rather than "swept".

CREATE FUNCTION app.request_missing_section_thumbnails() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE requested integer := 0; v RECORD;
BEGIN
  -- The worker's identity, checked the same way every other worker-callable
  -- command checks it. A session-scoped role is not this function's caller.
  PERFORM app.require_worker();

  FOR v IN
    SELECT sv.section_def_id, sv.version, d.slug, d.site_id
      FROM public.section_def_versions sv
      JOIN public.section_defs d ON d.id = sv.section_def_id
     WHERE sv.thumbnail_path IS NULL
       AND d.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.outbox o
          WHERE o.event_type = 'section_def.thumbnail_requested'
            AND o.status IN ('pending', 'running')
            AND o.payload ->> 'section_def_id' = sv.section_def_id::text
            AND (o.payload ->> 'version')::int = sv.version)
     ORDER BY d.slug, sv.version
  LOOP
    PERFORM app.emit_outbox(v.site_id, 'section_def.thumbnail_requested',
                            jsonb_build_object('section_def_id', v.section_def_id,
                                               'version', v.version,
                                               'slug', v.slug));
    requested := requested + 1;
  END LOOP;

  RETURN requested;
END
$$;

REVOKE ALL ON FUNCTION app.request_missing_section_thumbnails() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_missing_section_thumbnails() TO cms_worker;
ALTER FUNCTION app.request_missing_section_thumbnails() OWNER TO cms_migration_owner;
