-- 0033 — every section picture is retaken, because the frame changed shape.
--
-- The thumbnail frame was 1200×750 with the section centred in it. A page band
-- is 180–500 pixels tall, so the typical capture was a strip of content adrift
-- in white, and the library rendered it into a card a few hundred pixels wide —
-- which is how a picture meant to help somebody choose a section became a
-- picture in which nothing could be read. `THUMBNAIL_VIEWPORT` is now 1200×480,
-- close to what a band actually is, and the card's frame is the same 5:2 so
-- nothing has to be cropped to fit.
--
-- WHY THIS HAS TO BE A MIGRATION AND NOT A REDEPLOY
--
-- The thumbnail job is `guarded`, and its guard is the object key: a version
-- whose `thumbnail_path` already sits under the prefix derived from its current
-- `render_hash` has been photographed and the handler returns having launched
-- nothing. That is exactly right for redelivery and exactly wrong here — the
-- *artifacts* have not changed, so the prefix has not changed, so every existing
-- picture would be kept forever while every picture taken from now on used the
-- new frame. A library with two generations of thumbnail in it is worse than one
-- with either.
--
-- Clearing the column is what makes those versions unphotographed again. This is
-- not destructive: a thumbnail is a cache of a definition that is still there,
-- and the stored objects the old paths named are content-addressed, so nothing
-- is overwritten and an operator can still find them.
--
-- The request is emitted here rather than left to the worker's start-up sweep,
-- because that sweep runs once per process and a worker that is already up when
-- this migration lands would not run it again — the library would stay blank
-- until somebody happened to restart something. Emitting directly is what 0028
-- did for the same reason. The hazard 0032 was written about does not apply: the
-- event type is one every current worker handles, and if a stale one did
-- dead-letter these rows, `app.request_missing_section_thumbnails()` on the next
-- start is exactly the recovery it was built to be.
--
-- Forward-only, like every migration here. Rolling back would mean putting back
-- paths this statement did not record, which is precisely the kind of reversal
-- the forward-only rule exists to refuse.

UPDATE public.section_def_versions SET thumbnail_path = NULL WHERE thumbnail_path IS NOT NULL;

DO $$
DECLARE v RECORD;
BEGIN
  FOR v IN
    SELECT sv.section_def_id, sv.version, d.slug, d.site_id
      FROM public.section_def_versions sv
      JOIN public.section_defs d ON d.id = sv.section_def_id
     WHERE d.status = 'active'
     ORDER BY d.slug, sv.version
  LOOP
    PERFORM app.emit_outbox(v.site_id, 'section_def.thumbnail_requested',
                            jsonb_build_object('section_def_id', v.section_def_id,
                                               'version', v.version,
                                               'slug', v.slug));
  END LOOP;
END
$$;
