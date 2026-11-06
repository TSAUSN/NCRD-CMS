-- Redact named credentials at the only audit writer. Existing immutable rows
-- are not rewritten; the activity reader applies the same defence to them.
CREATE FUNCTION app.redact_audit_detail(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; field RECORD; part jsonb; message text;
BEGIN
  IF jsonb_typeof(p_value)='object' THEN
    result:='{}';
    FOR field IN SELECT key,value FROM jsonb_each(p_value) LOOP
      result:=result||jsonb_build_object(field.key,CASE WHEN regexp_replace(lower(field.key),'[^a-z0-9]','','g') ~ '(password|secret|credential|authorization|cookie|token$|^token|apikey|privatekey|connectionstring|databaseurl)'
        THEN '"[redacted]"'::jsonb ELSE app.redact_audit_detail(field.value) END);
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(p_value)='array' THEN
    result:='[]';
    FOR part IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      result:=result||jsonb_build_array(app.redact_audit_detail(part));
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(p_value)='string' THEN
    message:=p_value#>>'{}';
    message:=regexp_replace(message,'Bearer[[:space:]]+[A-Za-z0-9._~+/=-]+','Bearer [redacted]','gi');
    message:=regexp_replace(message,'(postgres(ql)?://)[^/@[:space:]]+@','\1[redacted]@','gi');
    message:=regexp_replace(message,'sb_secret_[A-Za-z0-9_-]+','[redacted]','g');
    RETURN to_jsonb(message);
  END IF;
  RETURN p_value;
END $$;

CREATE OR REPLACE FUNCTION app.write_audit(
  p_site_id uuid,p_actor_type actor_type,p_actor_id uuid,p_action text,
  p_item_type text,p_item_id uuid,p_before uuid,p_after uuid,p_detail jsonb
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE new_id bigint;
BEGIN
  INSERT INTO public.audit_log(site_id,actor_type,actor_id,action,item_type,item_id,before_ref,after_ref,detail,request_id)
  VALUES(p_site_id,p_actor_type,p_actor_id,p_action,p_item_type,p_item_id,p_before,p_after,
    app.redact_audit_detail(COALESCE(p_detail,'{}')),app.current_request_id()) RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE INDEX audit_log_created_id ON public.audit_log(created_at DESC,id DESC);
CREATE INDEX audit_log_action_created ON public.audit_log(action,created_at DESC,id DESC);

-- Actor names are joined only after site visibility is established. This does
-- not widen app_users RLS or expose the installation's user directory.
CREATE FUNCTION app.activity_feed(p_site_id uuid,p_actor_id uuid,p_actor_type text,p_action text,
  p_from timestamptz,p_until timestamptz,p_before_time timestamptz,p_before_id bigint,p_limit int)
RETURNS TABLE(id text,site_id uuid,site_name text,actor_id uuid,actor_type text,actor_name text,
  action text,item_type text,item_id uuid,before_ref uuid,after_ref uuid,detail jsonb,created_at timestamptz,cursor_time text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM app.require_actor();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 101
     OR (p_before_time IS NULL)<>(p_before_id IS NULL)
     OR (p_from IS NOT NULL AND p_until IS NOT NULL AND p_from>=p_until) THEN
    RAISE EXCEPTION 'invalid activity filters' USING ERRCODE='CMS04';
  END IF;
  RETURN QUERY SELECT a.id::text,a.site_id,s.name,a.actor_id,a.actor_type::text,
    CASE WHEN a.actor_type='user' THEN COALESCE(NULLIF(u.display_name,''),'Member') ELSE initcap(a.actor_type::text) END,
    a.action,a.item_type,a.item_id,a.before_ref,a.after_ref,app.redact_audit_detail(a.detail),a.created_at,
    to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  FROM public.audit_log a LEFT JOIN public.sites s ON s.id=a.site_id LEFT JOIN public.app_users u ON u.id=a.actor_id
  WHERE ((a.site_id IS NULL AND app.is_super_admin()) OR app.has_site_access(a.site_id))
    AND (p_site_id IS NULL OR a.site_id=p_site_id)
    AND (p_actor_id IS NULL OR a.actor_id=p_actor_id)
    AND (p_actor_type IS NULL OR a.actor_type::text=p_actor_type)
    AND (p_action IS NULL OR a.action=p_action)
    AND (p_from IS NULL OR a.created_at>=p_from) AND (p_until IS NULL OR a.created_at<p_until)
    AND (p_before_time IS NULL OR (a.created_at,a.id)<(p_before_time,p_before_id))
  ORDER BY a.created_at DESC,a.id DESC LIMIT p_limit;
END $$;

CREATE FUNCTION app.activity_options(p_site_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.require_actor();
  WITH visible AS MATERIALIZED (
    SELECT a.actor_id,a.action FROM public.audit_log a
    WHERE ((a.site_id IS NULL AND app.is_super_admin()) OR app.has_site_access(a.site_id))
      AND (p_site_id IS NULL OR a.site_id=p_site_id)
  ) SELECT jsonb_build_object(
    'actors',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',COALESCE(NULLIF(u.display_name,''),'Member')) ORDER BY u.display_name,u.id)
      FROM public.app_users u WHERE u.id IN(SELECT actor_id FROM visible)),'[]'),
    'actions',COALESCE((SELECT jsonb_agg(action ORDER BY action) FROM(SELECT DISTINCT action FROM visible) actions),'[]')
  ) INTO result;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app.redact_audit_detail(jsonb),app.activity_feed(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,bigint,int),app.activity_options(uuid) FROM PUBLIC;
ALTER FUNCTION app.redact_audit_detail(jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.write_audit(uuid,actor_type,uuid,text,text,uuid,uuid,uuid,jsonb) OWNER TO cms_migration_owner;
ALTER FUNCTION app.activity_feed(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,bigint,int) OWNER TO cms_migration_owner;
ALTER FUNCTION app.activity_options(uuid) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.activity_feed(uuid,uuid,text,text,timestamptz,timestamptz,timestamptz,bigint,int),app.activity_options(uuid) TO cms_authenticated_user;
