-- Wrapping the manifest in 0075 recreated its function identity and dropped the
-- worker's execution grant. Scheduled readiness must use the current builder,
-- including assets/appearance, never an older bypass alias.
GRANT EXECUTE ON FUNCTION app.build_render_manifest_internal(uuid) TO cms_worker;
DO $$ DECLARE old_builder RECORD; BEGIN
  FOR old_builder IN SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app' AND p.proname LIKE 'build_render_manifest_before_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM cms_authenticated_user,cms_public_renderer,cms_worker',old_builder.signature);
  END LOOP;
END $$;
