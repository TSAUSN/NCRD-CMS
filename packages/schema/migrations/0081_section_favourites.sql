-- Personal library choices never change an authored section or page.
CREATE TABLE public.section_favourites (
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  section_def_id uuid NOT NULL REFERENCES public.section_defs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,site_id,section_def_id)
);
ALTER TABLE public.section_favourites OWNER TO cms_migration_owner;
ALTER TABLE public.section_favourites ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_section_favourites ON public.section_favourites FOR SELECT
  USING (user_id=app.current_user_id() AND app.has_site_access(site_id));
GRANT SELECT ON public.section_favourites TO cms_authenticated_user;

CREATE FUNCTION app.set_section_favourite(p_site_id uuid,p_section_def_id uuid,p_favourite boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid := app.current_user_id();
BEGIN
  IF actor IS NULL OR NOT app.has_site_access(p_site_id) THEN
    RAISE EXCEPTION 'this site is not available to you' USING ERRCODE='CMS02';
  END IF;
  IF p_favourite IS NULL THEN
    RAISE EXCEPTION 'choose whether to keep this section in your favourites' USING ERRCODE='CMS04';
  END IF;
  IF p_favourite THEN
    IF NOT EXISTS(SELECT 1 FROM public.section_defs WHERE id=p_section_def_id
      AND status='active' AND (scope='global' OR site_id=p_site_id)) THEN
      RAISE EXCEPTION 'this section is not available on this site' USING ERRCODE='CMS04';
    END IF;
    INSERT INTO public.section_favourites(user_id,site_id,section_def_id)
      VALUES(actor,p_site_id,p_section_def_id) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.section_favourites WHERE user_id=actor AND site_id=p_site_id AND section_def_id=p_section_def_id;
  END IF;
  RETURN p_favourite;
END $$;
ALTER FUNCTION app.set_section_favourite(uuid,uuid,boolean) OWNER TO cms_migration_owner;
REVOKE ALL ON FUNCTION app.set_section_favourite(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_section_favourite(uuid,uuid,boolean) TO cms_authenticated_user;
