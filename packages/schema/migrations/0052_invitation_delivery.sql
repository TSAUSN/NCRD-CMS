-- Durable delivery receipts, with bounded provider-idempotency retries.
CREATE TABLE public.email_deliveries (
  event_id bigint PRIMARY KEY REFERENCES public.outbox(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  provider_id text,
  delivered_at timestamptz,
  cancelled boolean NOT NULL DEFAULT false,
  CHECK (char_length(subject)<=200 AND octet_length(body)<=20000),
  CHECK ((provider_id IS NULL)=(delivered_at IS NULL))
);
ALTER TABLE public.email_deliveries OWNER TO cms_migration_owner;
ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.email_deliveries TO cms_authenticated_user;
CREATE POLICY email_deliveries_super_read ON public.email_deliveries FOR SELECT TO cms_authenticated_user USING(app.is_super_admin());

CREATE FUNCTION app.require_invitation_lease(p_event_id bigint,p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE event RECORD;
BEGIN
  PERFORM app.require_worker();
  SELECT * INTO event FROM public.outbox WHERE id=p_event_id FOR UPDATE;
  IF event IS NULL OR event.event_type<>'user.invited' OR event.status<>'running'
     OR NOT app.lease_matches(event.lease_token_hash,p_token) OR event.leased_until IS NULL OR event.leased_until<statement_timestamp() THEN
    RAISE EXCEPTION 'invitation is not held by this worker lease' USING ERRCODE='CMS04';
  END IF;
  RETURN event.payload;
END $$;

CREATE FUNCTION app.prepare_invitation_email(p_event_id bigint,p_token uuid,p_subject text,p_body text,p_key text)
RETURNS TABLE(recipient text,subject text,body text,idempotency_key text,provider_id text,expires_at timestamptz,cancelled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE payload jsonb; person RECORD; cancellation boolean;
BEGIN
  payload:=app.require_invitation_lease(p_event_id,p_token);
  SELECT * INTO person FROM public.app_users WHERE id=(payload->>'user_id')::uuid;
  cancellation:=person IS NULL OR person.status<>'active' OR NOT(
    EXISTS(SELECT 1 FROM public.site_memberships WHERE user_id=person.id)
    OR EXISTS(SELECT 1 FROM public.global_roles WHERE user_id=person.id));
  IF char_length(COALESCE(p_key,'')) NOT BETWEEN 1 AND 256 OR p_key !~ '^[a-zA-Z0-9_/-]+$' THEN
    RAISE EXCEPTION 'invalid email idempotency key' USING ERRCODE='CMS04';
  END IF;
  INSERT INTO public.email_deliveries(event_id,recipient,subject,body,idempotency_key,cancelled)
    VALUES(p_event_id,COALESCE(person.email,payload->>'email'),p_subject,p_body,p_key,cancellation)
    ON CONFLICT(event_id) DO NOTHING;
  IF cancellation THEN UPDATE public.email_deliveries SET cancelled=true WHERE event_id=p_event_id AND provider_id IS NULL; END IF;
  RETURN QUERY SELECT e.recipient,e.subject,e.body,e.idempotency_key,e.provider_id,e.started_at+interval '23 hours',e.cancelled
    FROM public.email_deliveries e WHERE e.event_id=p_event_id;
END $$;

CREATE FUNCTION app.record_invitation_delivery(p_event_id bigint,p_token uuid,p_provider_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM app.require_invitation_lease(p_event_id,p_token);
  IF COALESCE(p_provider_id,'')='' OR char_length(p_provider_id)>512 THEN RAISE EXCEPTION 'invalid email receipt' USING ERRCODE='CMS04'; END IF;
  UPDATE public.email_deliveries SET provider_id=p_provider_id,delivered_at=now()
    WHERE event_id=p_event_id AND provider_id IS NULL AND NOT cancelled;
END $$;

REVOKE ALL ON FUNCTION app.require_invitation_lease(bigint,uuid),
  app.prepare_invitation_email(bigint,uuid,text,text,text),app.record_invitation_delivery(bigint,uuid,text) FROM PUBLIC;
ALTER FUNCTION app.require_invitation_lease(bigint,uuid) OWNER TO cms_migration_owner;
ALTER FUNCTION app.prepare_invitation_email(bigint,uuid,text,text,text) OWNER TO cms_migration_owner;
ALTER FUNCTION app.record_invitation_delivery(bigint,uuid,text) OWNER TO cms_migration_owner;
GRANT EXECUTE ON FUNCTION app.prepare_invitation_email(bigint,uuid,text,text,text),app.record_invitation_delivery(bigint,uuid,text) TO cms_worker;
