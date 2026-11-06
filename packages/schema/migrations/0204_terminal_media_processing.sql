-- A permanently stopped processing delivery must not leave its upload polling
-- forever. Keep completed media and other tenants untouched.
CREATE FUNCTION app.fail_dead_media_upload(p_event_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE stopped public.outbox%ROWTYPE; failed_id uuid;
BEGIN
  SELECT * INTO stopped FROM public.outbox
   WHERE id = p_event_id AND event_type = 'media.upload_received' AND status = 'dead';
  IF stopped.id IS NULL THEN RETURN; END IF;

  UPDATE app.media_upload_intents intent
     SET status = 'failed', failure_code = 'media_processing_interrupted',
         completed_at = statement_timestamp()
   WHERE intent.id::text = stopped.payload->>'intent_id'
     AND intent.site_id IS NOT DISTINCT FROM stopped.site_id
     AND intent.status = 'uploaded'
     AND NOT EXISTS (
       SELECT 1 FROM public.outbox active
        WHERE active.event_type = 'media.upload_received'
          AND active.site_id IS NOT DISTINCT FROM stopped.site_id
          AND active.payload->>'intent_id' = intent.id::text
          AND active.status IN ('pending', 'running'))
  RETURNING intent.id INTO failed_id;

  IF failed_id IS NOT NULL THEN
    PERFORM app.write_audit(stopped.site_id, 'system', NULL, 'media.upload.failed',
      'media_upload_intent', failed_id, failed_id, NULL,
      jsonb_build_object('failure_code', 'media_processing_interrupted',
                        'failed_delivery_id', stopped.id));
  END IF;
END $$;
ALTER FUNCTION app.fail_dead_media_upload(bigint) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.fail_dead_media_upload(bigint) FROM PUBLIC;

CREATE FUNCTION app.fail_media_after_dead_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM app.fail_dead_media_upload(NEW.id);
  RETURN NEW;
END $$;
ALTER FUNCTION app.fail_media_after_dead_delivery() OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.fail_media_after_dead_delivery() FROM PUBLIC;

CREATE TRIGGER media_processing_delivery_stopped
AFTER UPDATE OF status ON public.outbox
FOR EACH ROW WHEN (NEW.status = 'dead' AND OLD.status IS DISTINCT FROM NEW.status
                  AND NEW.event_type = 'media.upload_received')
EXECUTE FUNCTION app.fail_media_after_dead_delivery();

-- Reconcile deliveries that had already stopped before this rule was installed.
DO $$
DECLARE stopped record;
BEGIN
  FOR stopped IN SELECT id FROM public.outbox
    WHERE event_type = 'media.upload_received' AND status = 'dead'
  LOOP
    PERFORM app.fail_dead_media_upload(stopped.id);
  END LOOP;
END $$;
