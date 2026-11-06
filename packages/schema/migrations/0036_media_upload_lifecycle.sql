-- 0036 — media is admitted by inspection, not by assertion (SPEC §6.11, §8).
--
-- An upload is not a media row.  A media row says that bytes were decoded,
-- hashed, dimension-checked and made ready for use; inserting a `processing`
-- row before any of that would make each of its non-null object identity fields
-- a lie.  The private intent table below is the short-lived upload capability.
-- Only a successful worker inspection creates the durable, ready media row.
--
-- The browser gets two capabilities over the course of a PUT.  `begin` returns
-- an upload token once.  The receiver exchanges it, before reading a body, for
-- a receipt token and the server-owned bounds.  Only digests are stored.  This
-- makes the first exchange a real one-time claim: two requests cannot both
-- stream into the same temporary key.  The receipt token then settles either
-- received or failed after storage I/O.

-- ======================================================== governed metadata ==

CREATE OR REPLACE FUNCTION app.media_focal_is_valid(p_focal jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE x numeric; y numeric;
BEGIN
  IF p_focal IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p_focal) <> 'object'
     OR NOT (p_focal ? 'x' AND p_focal ? 'y')
     OR (SELECT count(*) FROM jsonb_object_keys(p_focal)) <> 2
     OR jsonb_typeof(p_focal->'x') <> 'number'
     OR jsonb_typeof(p_focal->'y') <> 'number' THEN
    RETURN false;
  END IF;
  x := (p_focal->>'x')::numeric;
  y := (p_focal->>'y')::numeric;
  RETURN x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION app.media_tags_are_valid(p_tags text[])
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT p_tags IS NOT NULL
     AND COALESCE(array_ndims(p_tags), 1) = 1
     AND cardinality(p_tags) <= 24
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p_tags) AS t
        WHERE t IS NULL OR t <> btrim(t) OR t <> lower(t)
           OR char_length(t) NOT BETWEEN 1 AND 48
           OR t !~ '^[a-z0-9][a-z0-9 -]*$')
     AND (SELECT count(DISTINCT t) FROM unnest(p_tags) AS t) = cardinality(p_tags)
$$;

CREATE OR REPLACE FUNCTION app.media_authoring_metadata_is_valid(
  p_alt_text text, p_decorative boolean, p_focal jsonb, p_folder text,
  p_attribution text, p_source text, p_tags text[]
) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $$
  SELECT p_alt_text IS NOT NULL AND p_alt_text = btrim(p_alt_text)
     AND char_length(p_alt_text) <= 1000 AND p_alt_text !~ '[[:cntrl:]]'
     AND p_decorative IS NOT NULL
     AND ((p_decorative AND p_alt_text = '') OR (NOT p_decorative AND p_alt_text <> ''))
     AND app.media_focal_is_valid(p_focal)
     AND p_folder IS NOT NULL AND p_folder = btrim(p_folder)
     AND char_length(p_folder) <= 200
     AND (p_folder = '' OR p_folder ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}(/[A-Za-z0-9][A-Za-z0-9 _-]{0,63})*$')
     AND p_attribution IS NOT NULL AND p_attribution = btrim(p_attribution)
     AND char_length(p_attribution) <= 500 AND p_attribution !~ '[[:cntrl:]]'
     AND p_source IS NOT NULL AND p_source = btrim(p_source)
     AND char_length(p_source) <= 1000 AND p_source !~ '[[:cntrl:]]'
     AND app.media_tags_are_valid(p_tags)
$$;

CREATE OR REPLACE FUNCTION app.media_original_name_is_valid(p_name text, p_mime text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT p_name IS NOT NULL AND p_name = btrim(p_name)
     AND char_length(p_name) BETWEEN 1 AND 255
     AND p_name !~ '[[:cntrl:]/\\]'
     AND p_name NOT IN ('.', '..')
     AND CASE p_mime
       WHEN 'image/jpeg' THEN lower(p_name) ~ '\.(jpg|jpeg)$'
       WHEN 'image/png'  THEN lower(p_name) ~ '\.png$'
       WHEN 'image/webp' THEN lower(p_name) ~ '\.webp$'
       ELSE false
     END
$$;

CREATE OR REPLACE FUNCTION app.media_extension(p_mime text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT CASE p_mime
    WHEN 'image/jpeg' THEN 'jpg'
    WHEN 'image/png' THEN 'png'
    WHEN 'image/webp' THEN 'webp'
    ELSE NULL
  END
$$;

ALTER TABLE public.media
  ADD COLUMN revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN folder text NOT NULL DEFAULT '',
  ADD COLUMN attribution text NOT NULL DEFAULT '',
  ADD COLUMN source text NOT NULL DEFAULT '',
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN purged_at timestamptz;

ALTER TABLE public.media
  ADD CONSTRAINT media_revision_positive CHECK (revision > 0),
  ADD CONSTRAINT media_authoring_metadata_shape CHECK (
    app.media_authoring_metadata_is_valid(
      alt_text, decorative, focal, folder, attribution, source, tags)) NOT VALID,
  -- NOT VALID preserves honest provenance for any pre-M5 row.  PostgreSQL
  -- still checks every new or changed row; a legacy row is not silently called
  -- inspected merely because this migration was installed.
  ADD CONSTRAINT media_ready_is_inspected CHECK (
    status <> 'ready'
    OR (content_hash ~ '^[0-9a-f]{64}$'
        AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
        AND bytes BETWEEN 1 AND 26214400
        AND width BETWEEN 1 AND 32768 AND height BETWEEN 1 AND 32768
        AND width::bigint * height::bigint <= 100000000
        AND deleted_at IS NULL)) NOT VALID,
  ADD CONSTRAINT media_deleted_pairing CHECK (
    (status = 'deleted') = (deleted_at IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT media_purge_follows_delete CHECK (
    purged_at IS NULL OR (status = 'deleted' AND deleted_at IS NOT NULL
                          AND purged_at >= deleted_at + interval '30 days')) NOT VALID;

ALTER TABLE public.media_variants
  ADD COLUMN mime_type text,
  ADD COLUMN content_hash text;

ALTER TABLE public.media_variants
  ADD CONSTRAINT media_variant_inspected_shape CHECK (
    (mime_type IS NULL AND content_hash IS NULL)
    OR (mime_type = 'image/webp' AND content_hash ~ '^[0-9a-f]{64}$'
        AND bytes > 0 AND width > 0 AND height > 0)) NOT VALID;

CREATE INDEX media_site_library
  ON public.media(site_id, status, folder, created_at DESC);
CREATE INDEX media_tags_search ON public.media USING gin(tags);

-- =========================================================== upload intent ==

CREATE TABLE app.media_upload_intents (
  id                    uuid PRIMARY KEY,
  site_id               uuid REFERENCES public.sites(id) ON DELETE CASCADE,
  uploaded_by           uuid NOT NULL REFERENCES public.app_users(id),
  upload_object_key     text NOT NULL UNIQUE,
  final_key_prefix      text NOT NULL UNIQUE,
  upload_token_hash     bytea,
  receipt_token_hash    bytea,
  original_name         text NOT NULL,
  declared_mime_type    text NOT NULL,
  declared_bytes        bigint NOT NULL,
  alt_text              text NOT NULL,
  decorative            boolean NOT NULL,
  focal                 jsonb,
  folder                text NOT NULL,
  attribution           text NOT NULL,
  source                text NOT NULL,
  tags                  text[] NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  received_content_type text,
  received_bytes        bigint,
  received_at           timestamptz,
  failure_code          text,
  media_id              uuid REFERENCES public.media(id),
  created_at            timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at            timestamptz NOT NULL,
  completed_at          timestamptz,
  CONSTRAINT media_upload_intent_status
    CHECK (status IN ('pending', 'receiving', 'uploaded', 'ready', 'failed')),
  CONSTRAINT media_upload_intent_expiry
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CONSTRAINT media_upload_intent_declared_shape
    CHECK (declared_mime_type IN ('image/jpeg', 'image/png', 'image/webp')
       AND declared_bytes BETWEEN 1 AND 10485760
       AND app.media_original_name_is_valid(original_name, declared_mime_type)
       AND app.media_authoring_metadata_is_valid(
         alt_text, decorative, focal, folder, attribution, source, tags)),
  CONSTRAINT media_upload_intent_failure_code
    CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT media_upload_intent_state_shape CHECK (
    (status = 'pending' AND upload_token_hash IS NOT NULL AND receipt_token_hash IS NULL
       AND received_at IS NULL AND completed_at IS NULL AND failure_code IS NULL AND media_id IS NULL)
    OR (status = 'receiving' AND upload_token_hash IS NULL AND receipt_token_hash IS NOT NULL
       AND received_at IS NULL AND completed_at IS NULL AND failure_code IS NULL AND media_id IS NULL)
    OR (status = 'uploaded' AND upload_token_hash IS NULL AND receipt_token_hash IS NULL
       AND received_at IS NOT NULL AND completed_at IS NULL AND failure_code IS NULL AND media_id IS NULL)
    OR (status = 'ready' AND upload_token_hash IS NULL AND receipt_token_hash IS NULL
       AND received_at IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL AND media_id IS NOT NULL)
    OR (status = 'failed' AND upload_token_hash IS NULL AND receipt_token_hash IS NULL
       AND completed_at IS NOT NULL AND failure_code IS NOT NULL AND media_id IS NULL))
);

CREATE INDEX media_upload_intents_expiry
  ON app.media_upload_intents(expires_at) WHERE status IN ('pending', 'receiving');
CREATE INDEX media_upload_intents_site_created
  ON app.media_upload_intents(site_id, created_at DESC);

-- A cleanup crosses a database transaction and object-store I/O.  This row is
-- the durable fact that deletion of the exact media revision has begun, so a
-- restore cannot race between "return keys" and "remove objects".  Authority
-- still comes from the outbox lease capability; no second raw token exists to
-- be lost in a crash.
CREATE TABLE app.media_cleanup_claims (
  event_id          bigint PRIMARY KEY REFERENCES public.outbox(id) ON DELETE CASCADE,
  media_id          uuid NOT NULL UNIQUE REFERENCES public.media(id) ON DELETE CASCADE,
  deleted_revision  bigint NOT NULL CHECK (deleted_revision > 0),
  started_at        timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_claimed_at   timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at      timestamptz,
  CONSTRAINT media_cleanup_claim_time
    CHECK (completed_at IS NULL OR completed_at >= started_at)
);

ALTER TABLE app.media_upload_intents OWNER TO cms_migration_owner;
ALTER TABLE app.media_cleanup_claims OWNER TO cms_migration_owner;
REVOKE ALL ON TABLE app.media_upload_intents
  FROM PUBLIC, cms_authenticated_user, cms_worker, cms_public_renderer;
REVOKE ALL ON TABLE app.media_cleanup_claims
  FROM PUBLIC, cms_authenticated_user, cms_worker, cms_public_renderer;

CREATE OR REPLACE FUNCTION app.media_upload_token_digest(p_token uuid)
RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT sha256(convert_to(p_token::text, 'UTF8'))
$$;

CREATE OR REPLACE FUNCTION app.media_upload_token_matches(p_stored bytea, p_offered uuid)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT p_stored IS NOT NULL AND p_offered IS NOT NULL
     AND p_stored = app.media_upload_token_digest(p_offered)
$$;

-- ========================================================== upload commands ==

CREATE OR REPLACE FUNCTION app.begin_media_upload(
  p_site_id uuid, p_original_name text, p_declared_mime_type text,
  p_declared_bytes bigint, p_alt_text text, p_decorative boolean, p_focal jsonb,
  p_folder text, p_attribution text, p_source text, p_tags text[]
) RETURNS TABLE (
  intent_id uuid, upload_token uuid, upload_object_key text,
  final_key_prefix text, expires_at timestamptz, max_bytes bigint,
  allowed_content_type text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  actor uuid; token uuid; new_id uuid; tenant_segment text; expiry timestamptz;
  upload_key text; final_prefix text; site_state site_status;
BEGIN
  actor := app.require_actor();

  IF p_site_id IS NULL THEN
    IF NOT app.is_super_admin() THEN
      RAISE EXCEPTION 'only a super admin may add media to the shared pool'
        USING ERRCODE = 'CMS02';
    END IF;
  ELSE
    IF NOT app.has_site_access(p_site_id) THEN
      RAISE EXCEPTION 'not permitted to upload media for this site'
        USING ERRCODE = 'CMS02';
    END IF;
    SELECT s.status INTO site_state FROM public.sites s WHERE s.id = p_site_id;
    IF site_state IS NULL THEN
      RAISE EXCEPTION 'not permitted to upload media for this site'
        USING ERRCODE = 'CMS02';
    END IF;
    IF site_state = 'archived' THEN
      RAISE EXCEPTION 'cannot upload media for an archived site'
        USING ERRCODE = 'CMS04';
    END IF;
  END IF;

  IF p_declared_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
     OR NOT app.media_original_name_is_valid(p_original_name, p_declared_mime_type) THEN
    RAISE EXCEPTION 'the filename and content type are not a supported image'
      USING ERRCODE = 'CMS04';
  END IF;
  IF p_declared_bytes IS NULL OR p_declared_bytes NOT BETWEEN 1 AND 10485760 THEN
    RAISE EXCEPTION 'declared upload size must be between 1 byte and 10 MiB'
      USING ERRCODE = 'CMS04';
  END IF;
  IF NOT app.media_authoring_metadata_is_valid(
      p_alt_text, p_decorative, p_focal, p_folder, p_attribution, p_source, p_tags) THEN
    RAISE EXCEPTION 'media metadata is invalid; supply alt text or mark the image decorative'
      USING ERRCODE = 'CMS04';
  END IF;

  new_id := gen_random_uuid();
  token := gen_random_uuid();
  tenant_segment := COALESCE(p_site_id::text, 'shared');
  upload_key := 'media/uploads/' || tenant_segment || '/' || new_id::text;
  final_prefix := 'media/objects/' || tenant_segment || '/' || new_id::text || '/';
  expiry := statement_timestamp() + interval '15 minutes';

  INSERT INTO app.media_upload_intents (
    id, site_id, uploaded_by, upload_object_key, final_key_prefix,
    upload_token_hash, original_name, declared_mime_type, declared_bytes,
    alt_text, decorative, focal, folder, attribution, source, tags, expires_at)
  VALUES (
    new_id, p_site_id, actor, upload_key, final_prefix,
    app.media_upload_token_digest(token), p_original_name, p_declared_mime_type,
    p_declared_bytes, p_alt_text, p_decorative, p_focal, p_folder,
    p_attribution, p_source, p_tags, expiry);

  PERFORM app.write_audit(
    p_site_id, 'user', actor, 'media.upload.begin', 'media_upload_intent', new_id,
    NULL, new_id,
    jsonb_build_object('original_name', p_original_name,
      'declared_mime_type', p_declared_mime_type,
      'declared_bytes', p_declared_bytes, 'expires_at', expiry));

  RETURN QUERY SELECT new_id, token, upload_key, final_prefix, expiry,
                      p_declared_bytes, p_declared_mime_type;
END
$$;

CREATE OR REPLACE FUNCTION app.media_upload_for_receipt(
  p_intent_id uuid, p_upload_token uuid
) RETURNS TABLE (
  receipt_token uuid, upload_object_key text, declared_bytes bigint,
  max_bytes bigint, allowed_content_type text, expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE intent app.media_upload_intents%ROWTYPE; token uuid;
BEGIN
  SELECT * INTO intent FROM app.media_upload_intents i
   WHERE i.id = p_intent_id FOR UPDATE;
  IF intent.id IS NULL OR intent.status <> 'pending'
     OR intent.expires_at <= statement_timestamp()
     OR NOT app.media_upload_token_matches(intent.upload_token_hash, p_upload_token) THEN
    RAISE EXCEPTION 'upload capability is invalid, expired, or already used'
      USING ERRCODE = 'CMS04';
  END IF;

  token := gen_random_uuid();
  UPDATE app.media_upload_intents
     SET status = 'receiving', upload_token_hash = NULL,
         receipt_token_hash = app.media_upload_token_digest(token)
   WHERE id = p_intent_id;

  PERFORM app.write_audit(
    intent.site_id, 'system', NULL, 'media.upload.receipt_claim',
    'media_upload_intent', intent.id, intent.id, intent.id,
    jsonb_build_object('expires_at', intent.expires_at));

  RETURN QUERY SELECT token, intent.upload_object_key, intent.declared_bytes,
                      intent.declared_bytes, intent.declared_mime_type, intent.expires_at;
END
$$;

CREATE OR REPLACE FUNCTION app.mark_media_upload_received(
  p_intent_id uuid, p_receipt_token uuid, p_upload_object_key text,
  p_content_type text, p_bytes bigint
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE intent app.media_upload_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM app.media_upload_intents i
   WHERE i.id = p_intent_id FOR UPDATE;
  IF intent.id IS NULL OR intent.status <> 'receiving'
     OR NOT app.media_upload_token_matches(intent.receipt_token_hash, p_receipt_token) THEN
    RAISE EXCEPTION 'receipt capability is invalid or already used'
      USING ERRCODE = 'CMS04';
  END IF;
  IF intent.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'upload capability expired before the body was received'
      USING ERRCODE = 'CMS04';
  END IF;
  IF p_upload_object_key IS DISTINCT FROM intent.upload_object_key
     OR p_content_type IS DISTINCT FROM intent.declared_mime_type
     OR p_bytes IS DISTINCT FROM intent.declared_bytes THEN
    RAISE EXCEPTION 'received upload does not match its server-issued key, type, and size bounds'
      USING ERRCODE = 'CMS04';
  END IF;

  UPDATE app.media_upload_intents
     SET status = 'uploaded', receipt_token_hash = NULL,
         received_content_type = p_content_type, received_bytes = p_bytes,
         received_at = statement_timestamp()
   WHERE id = intent.id;

  PERFORM app.write_audit(
    intent.site_id, 'system', NULL, 'media.upload.received',
    'media_upload_intent', intent.id, intent.id, intent.id,
    jsonb_build_object('content_type', p_content_type, 'bytes', p_bytes));
  PERFORM app.emit_outbox(intent.site_id, 'media.upload_received',
    jsonb_build_object('intent_id', intent.id));
  RETURN intent.id;
END
$$;

CREATE OR REPLACE FUNCTION app.fail_media_upload_receipt(
  p_intent_id uuid, p_receipt_token uuid, p_upload_object_key text,
  p_failure_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE intent app.media_upload_intents%ROWTYPE;
BEGIN
  SELECT * INTO intent FROM app.media_upload_intents i
   WHERE i.id = p_intent_id FOR UPDATE;
  IF intent.id IS NULL OR intent.status <> 'receiving'
     OR NOT app.media_upload_token_matches(intent.receipt_token_hash, p_receipt_token)
     OR p_upload_object_key IS DISTINCT FROM intent.upload_object_key THEN
    RAISE EXCEPTION 'receipt capability is invalid or already used'
      USING ERRCODE = 'CMS04';
  END IF;
  IF p_failure_code IS NULL OR p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'upload receipt failure needs a stable code'
      USING ERRCODE = 'CMS04';
  END IF;

  UPDATE app.media_upload_intents
     SET status = 'failed', receipt_token_hash = NULL,
         failure_code = p_failure_code, completed_at = statement_timestamp()
   WHERE id = intent.id;
  PERFORM app.write_audit(
    intent.site_id, 'system', NULL, 'media.upload.receipt_failed',
    'media_upload_intent', intent.id, intent.id, NULL,
    jsonb_build_object('failure_code', p_failure_code));
END
$$;

CREATE OR REPLACE FUNCTION app.media_upload_for_inspection(p_intent_id uuid)
RETURNS TABLE (
  intent_id uuid, site_id uuid, upload_object_key text, final_key_prefix text,
  declared_mime_type text, declared_bytes bigint, status text, media_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_worker();
  RETURN QUERY
  SELECT i.id, i.site_id, i.upload_object_key, i.final_key_prefix,
         i.declared_mime_type, i.declared_bytes, i.status, i.media_id
    FROM app.media_upload_intents i WHERE i.id = p_intent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no such media upload intent' USING ERRCODE = 'CMS03';
  END IF;
END
$$;

-- Validate the worker's entire immutable result before inserting any row.
CREATE OR REPLACE FUNCTION app.finalize_media_upload(
  p_intent_id uuid, p_upload_object_key text, p_final_object_key text,
  p_sha256 text, p_inspected_mime_type text, p_bytes bigint,
  p_width integer, p_height integer, p_variants jsonb
) RETURNS TABLE (media_id uuid, object_key text, status media_status)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE
  intent app.media_upload_intents%ROWTYPE; existing public.media%ROWTYPE;
  expected_key text; extension text; new_media uuid; variant jsonb;
  kind text; variant_hash text; variant_key text; variant_mime text;
  variant_width integer; variant_height integer; variant_bytes bigint;
  kinds text[] := '{}'::text[]; card_count integer := 0; inserted_variants integer := 0;
BEGIN
  PERFORM app.require_worker();
  SELECT * INTO intent FROM app.media_upload_intents i
   WHERE i.id = p_intent_id FOR UPDATE;
  IF intent.id IS NULL THEN
    RAISE EXCEPTION 'no such media upload intent' USING ERRCODE = 'CMS03';
  END IF;
  IF p_upload_object_key IS DISTINCT FROM intent.upload_object_key THEN
    RAISE EXCEPTION 'worker named an object key not issued for this upload'
      USING ERRCODE = 'CMS04';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
     OR p_inspected_mime_type IS DISTINCT FROM intent.declared_mime_type
     OR p_inspected_mime_type NOT IN ('image/jpeg', 'image/png', 'image/webp')
     -- Inspection strips metadata and normalizes orientation by re-encoding.
     -- Those honest output bytes need not equal (or be smaller than) the PUT;
     -- they are independently bounded by the same server maximum.
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 26214400
     OR p_width IS NULL OR p_height IS NULL
     OR p_width NOT BETWEEN 1 AND 32768 OR p_height NOT BETWEEN 1 AND 32768
     OR p_width::bigint * p_height::bigint > 100000000 THEN
    RAISE EXCEPTION 'inspected media metadata does not match the declared, bounded upload'
      USING ERRCODE = 'CMS04';
  END IF;

  extension := app.media_extension(p_inspected_mime_type);
  expected_key := intent.final_key_prefix || p_sha256 || '.' || extension;
  IF p_final_object_key IS DISTINCT FROM expected_key THEN
    RAISE EXCEPTION 'final media key is not the content-addressed key for this upload'
      USING ERRCODE = 'CMS04';
  END IF;

  IF jsonb_typeof(p_variants) <> 'array'
     OR jsonb_array_length(p_variants) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'finalized media needs one to three governed variants'
      USING ERRCODE = 'CMS04';
  END IF;

  FOR variant IN SELECT value FROM jsonb_array_elements(p_variants)
  LOOP
    IF jsonb_typeof(variant) <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(variant)) <> 7
       OR NOT (variant ? 'kind' AND variant ? 'object_key' AND variant ? 'width'
               AND variant ? 'height' AND variant ? 'bytes' AND variant ? 'sha256'
               AND variant ? 'mime_type')
       OR jsonb_typeof(variant->'kind') <> 'string'
       OR jsonb_typeof(variant->'object_key') <> 'string'
       OR jsonb_typeof(variant->'sha256') <> 'string'
       OR jsonb_typeof(variant->'mime_type') <> 'string'
       OR jsonb_typeof(variant->'width') <> 'number'
       OR jsonb_typeof(variant->'height') <> 'number'
       OR jsonb_typeof(variant->'bytes') <> 'number'
       OR variant->>'width' !~ '^[0-9]+$'
       OR variant->>'height' !~ '^[0-9]+$'
       OR variant->>'bytes' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'variant metadata has an invalid shape' USING ERRCODE = 'CMS04';
    END IF;

    kind := variant->>'kind';
    variant_key := variant->>'object_key';
    variant_hash := variant->>'sha256';
    variant_mime := variant->>'mime_type';
    variant_width := (variant->>'width')::integer;
    variant_height := (variant->>'height')::integer;
    variant_bytes := (variant->>'bytes')::bigint;

    IF kind NOT IN ('thumbnail', 'card', 'wide') OR kind = ANY(kinds)
       OR variant_mime <> 'image/webp'
       OR variant_hash !~ '^[0-9a-f]{64}$'
       OR variant_key <> intent.final_key_prefix || 'variants/' || kind || '/' || variant_hash || '.webp'
       OR variant_width NOT BETWEEN 1 AND p_width
       OR variant_height NOT BETWEEN 1 AND p_height
       OR variant_bytes < 1
       OR (kind = 'thumbnail' AND (variant_width > 400 OR variant_bytes > 102400))
       OR (kind = 'card' AND (variant_width > 1200 OR variant_bytes > 204800))
       OR (kind = 'wide' AND (variant_width > 2400 OR variant_bytes > 524288)) THEN
      RAISE EXCEPTION 'variant is not a bounded, content-addressed governed image'
        USING ERRCODE = 'CMS04';
    END IF;
    kinds := array_append(kinds, kind);
    IF kind = 'card' THEN card_count := card_count + 1; END IF;
  END LOOP;
  IF card_count <> 1 THEN
    RAISE EXCEPTION 'finalized media needs exactly one card variant'
      USING ERRCODE = 'CMS04';
  END IF;

  IF intent.status = 'ready' THEN
    SELECT * INTO existing FROM public.media m WHERE m.id = intent.media_id;
    IF existing.id IS NULL OR existing.object_key <> p_final_object_key
       OR existing.content_hash <> p_sha256 OR existing.mime_type <> p_inspected_mime_type
       OR existing.bytes <> p_bytes OR existing.width <> p_width OR existing.height <> p_height
       OR (SELECT count(*) FROM public.media_variants mv WHERE mv.media_id = existing.id)
            <> jsonb_array_length(p_variants)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(p_variants) v
          WHERE NOT EXISTS (
            SELECT 1 FROM public.media_variants mv
             WHERE mv.media_id = existing.id AND mv.kind = v->>'kind'
               AND mv.object_key = v->>'object_key'
               AND mv.content_hash = v->>'sha256'
               AND mv.mime_type = v->>'mime_type'
               AND mv.width = (v->>'width')::integer
               AND mv.height = (v->>'height')::integer
               AND mv.bytes = (v->>'bytes')::bigint)) THEN
      RAISE EXCEPTION 'finalization was already settled with different artifacts'
        USING ERRCODE = 'CMS04';
    END IF;
    RETURN QUERY SELECT existing.id, existing.object_key, existing.status;
    RETURN;
  END IF;
  IF intent.status <> 'uploaded' THEN
    RAISE EXCEPTION 'media upload is not awaiting inspection'
      USING ERRCODE = 'CMS04';
  END IF;

  new_media := gen_random_uuid();
  INSERT INTO public.media (
    id, site_id, object_key, content_hash, original_name, alt_text, decorative,
    focal, width, height, bytes, mime_type, status, uploaded_by,
    revision, folder, attribution, source, tags)
  VALUES (
    new_media, intent.site_id, p_final_object_key, p_sha256,
    intent.original_name, intent.alt_text, intent.decorative, intent.focal,
    p_width, p_height, p_bytes, p_inspected_mime_type, 'ready',
    intent.uploaded_by, 1, intent.folder, intent.attribution, intent.source, intent.tags);

  FOR variant IN SELECT value FROM jsonb_array_elements(p_variants)
  LOOP
    INSERT INTO public.media_variants (
      media_id, kind, object_key, width, height, bytes, mime_type, content_hash)
    VALUES (
      new_media, variant->>'kind', variant->>'object_key',
      (variant->>'width')::integer, (variant->>'height')::integer,
      (variant->>'bytes')::bigint, variant->>'mime_type', variant->>'sha256');
    inserted_variants := inserted_variants + 1;
  END LOOP;

  UPDATE app.media_upload_intents
     SET status = 'ready', media_id = new_media, completed_at = statement_timestamp()
   WHERE id = intent.id;

  PERFORM app.write_audit(
    intent.site_id, 'system', NULL, 'media.upload.finalize', 'media', new_media,
    intent.id, new_media,
    jsonb_build_object('mime_type', p_inspected_mime_type, 'bytes', p_bytes,
      'width', p_width, 'height', p_height, 'variant_kinds', to_jsonb(kinds)));
  PERFORM app.emit_outbox(intent.site_id, 'media.ready',
    jsonb_build_object('media_id', new_media, 'revision', 1,
      'variant_kinds', to_jsonb(kinds)));

  RETURN QUERY SELECT new_media, p_final_object_key, 'ready'::media_status;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN
  RAISE EXCEPTION 'variant numeric metadata is outside its bounded integer shape'
    USING ERRCODE = 'CMS04';
END
$$;

CREATE OR REPLACE FUNCTION app.fail_media_upload(
  p_intent_id uuid, p_upload_object_key text, p_failure_code text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE intent app.media_upload_intents%ROWTYPE;
BEGIN
  PERFORM app.require_worker();
  SELECT * INTO intent FROM app.media_upload_intents i
   WHERE i.id = p_intent_id FOR UPDATE;
  IF intent.id IS NULL THEN
    RAISE EXCEPTION 'no such media upload intent' USING ERRCODE = 'CMS03';
  END IF;
  IF p_upload_object_key IS DISTINCT FROM intent.upload_object_key
     OR p_failure_code IS NULL OR p_failure_code !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'upload failure does not name its issued key and a stable code'
      USING ERRCODE = 'CMS04';
  END IF;
  IF intent.status = 'failed' AND intent.failure_code = p_failure_code THEN RETURN; END IF;
  IF intent.status <> 'uploaded' THEN
    RAISE EXCEPTION 'media upload is not awaiting inspection'
      USING ERRCODE = 'CMS04';
  END IF;

  UPDATE app.media_upload_intents
     SET status = 'failed', failure_code = p_failure_code,
         completed_at = statement_timestamp()
   WHERE id = intent.id;
  PERFORM app.write_audit(
    intent.site_id, 'system', NULL, 'media.upload.failed',
    'media_upload_intent', intent.id, intent.id, NULL,
    jsonb_build_object('failure_code', p_failure_code));
END
$$;

-- =========================================================== media editing ==

CREATE OR REPLACE FUNCTION app.update_media_metadata(
  p_media_id uuid, p_expected_revision bigint, p_alt_text text,
  p_decorative boolean, p_focal jsonb, p_folder text, p_attribution text,
  p_source text, p_tags text[]
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; row public.media%ROWTYPE; next_revision bigint; before_value jsonb;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.has_site_access(row.site_id)) THEN
    RAISE EXCEPTION 'not permitted to edit this media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'ready' THEN
    RAISE EXCEPTION 'only ready media can be edited' USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;
  IF NOT app.media_authoring_metadata_is_valid(
      p_alt_text, p_decorative, p_focal, p_folder, p_attribution, p_source, p_tags) THEN
    RAISE EXCEPTION 'media metadata is invalid; supply alt text or mark the image decorative'
      USING ERRCODE = 'CMS04';
  END IF;

  before_value := jsonb_build_object(
    'alt_text', row.alt_text, 'decorative', row.decorative, 'focal', row.focal,
    'folder', row.folder, 'attribution', row.attribution,
    'source', row.source, 'tags', row.tags, 'revision', row.revision);
  next_revision := row.revision + 1;
  UPDATE public.media
     SET alt_text = p_alt_text, decorative = p_decorative, focal = p_focal,
         folder = p_folder, attribution = p_attribution, source = p_source,
         tags = p_tags, revision = next_revision
   WHERE id = row.id;

  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.metadata.update', 'media', row.id,
    row.id, row.id,
    jsonb_build_object('before', before_value, 'after', jsonb_build_object(
      'alt_text', p_alt_text, 'decorative', p_decorative, 'focal', p_focal,
      'folder', p_folder, 'attribution', p_attribution,
      'source', p_source, 'tags', p_tags, 'revision', next_revision)));
  RETURN next_revision;
END
$$;

CREATE OR REPLACE FUNCTION app.soft_delete_media(
  p_media_id uuid, p_expected_revision bigint,
  p_break_references boolean, p_reason text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid; row public.media%ROWTYPE; usage_count bigint;
  next_revision bigint; deleted timestamptz; retention_until timestamptz; event_id bigint;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.can_administer_site(row.site_id)) THEN
    RAISE EXCEPTION 'only a site admin may delete media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'ready' THEN
    RAISE EXCEPTION 'only ready media can be deleted' USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;

  SELECT count(*) INTO usage_count FROM public.media_usage u WHERE u.media_id = row.id;
  IF p_reason IS NOT NULL AND p_reason <> ''
     AND (p_reason <> btrim(p_reason) OR char_length(p_reason) > 1000
          OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'media deletion reason is invalid' USING ERRCODE = 'CMS04';
  END IF;
  IF usage_count > 0 AND NOT COALESCE(p_break_references, false) THEN
    RAISE EXCEPTION 'media is referenced by % immutable page version(s)', usage_count
      USING ERRCODE = 'CMS04', DETAIL = usage_count::text;
  END IF;
  IF usage_count > 0 AND (p_reason IS NULL OR p_reason <> btrim(p_reason)
      OR char_length(p_reason) NOT BETWEEN 8 AND 1000 OR p_reason ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'breaking media references requires a bounded reason'
      USING ERRCODE = 'CMS04';
  END IF;

  deleted := statement_timestamp();
  retention_until := deleted + interval '30 days';
  next_revision := row.revision + 1;
  UPDATE public.media SET status = 'deleted', deleted_at = deleted, purged_at = NULL,
                          revision = next_revision WHERE id = row.id;

  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.delete', 'media', row.id,
    row.id, NULL,
    jsonb_build_object('revision', next_revision, 'usage_count', usage_count,
      'break_references', COALESCE(p_break_references, false),
      'reason', COALESCE(p_reason, ''), 'deleted_at', deleted,
      'retention_until', retention_until));
  PERFORM app.emit_outbox(row.site_id, 'media.deleted',
    jsonb_build_object('media_id', row.id, 'revision', next_revision));
  event_id := app.emit_outbox(row.site_id, 'media.cleanup_requested',
    jsonb_build_object('media_id', row.id, 'deleted_revision', next_revision,
      'not_before', retention_until));
  UPDATE public.outbox SET next_attempt_at = retention_until WHERE id = event_id;
  RETURN next_revision;
END
$$;

CREATE OR REPLACE FUNCTION app.restore_media(
  p_media_id uuid, p_expected_revision bigint
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid; row public.media%ROWTYPE; next_revision bigint;
BEGIN
  actor := app.require_actor();
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'no such media' USING ERRCODE = 'CMS03'; END IF;
  IF (row.site_id IS NULL AND NOT app.is_super_admin())
     OR (row.site_id IS NOT NULL AND NOT app.can_administer_site(row.site_id)) THEN
    RAISE EXCEPTION 'only a site admin may restore media' USING ERRCODE = 'CMS02';
  END IF;
  IF row.status <> 'deleted' OR row.deleted_at IS NULL THEN
    RAISE EXCEPTION 'media is not deleted' USING ERRCODE = 'CMS04';
  END IF;
  IF row.purged_at IS NOT NULL THEN
    RAISE EXCEPTION 'media objects have already left retention'
      USING ERRCODE = 'CMS04';
  END IF;
  IF EXISTS (SELECT 1 FROM app.media_cleanup_claims c
              WHERE c.media_id = row.id AND c.completed_at IS NULL) THEN
    RAISE EXCEPTION 'media object cleanup has already begun'
      USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale revision: expected %, media is at %', p_expected_revision, row.revision
      USING ERRCODE = 'CMS01', DETAIL = row.revision::text;
  END IF;
  IF row.deleted_at + interval '30 days' <= statement_timestamp() THEN
    RAISE EXCEPTION 'media retention window has elapsed' USING ERRCODE = 'CMS04';
  END IF;

  next_revision := row.revision + 1;
  UPDATE public.media SET status = 'ready', deleted_at = NULL,
                          revision = next_revision WHERE id = row.id;
  PERFORM app.write_audit(
    row.site_id, 'user', actor, 'media.restore', 'media', row.id,
    NULL, row.id, jsonb_build_object('revision', next_revision));
  PERFORM app.emit_outbox(row.site_id, 'media.restored',
    jsonb_build_object('media_id', row.id, 'revision', next_revision));
  RETURN next_revision;
END
$$;

-- The cleanup event contains identities, never storage paths.  Its existing
-- lease capability is also the cleanup capability: a retry receives a fresh
-- lease token from `claim_outbox`, renews the same durable claim, and can
-- idempotently remove any paths a crashed attempt already removed.
CREATE OR REPLACE FUNCTION app.require_media_cleanup_lease(
  p_event_id bigint, p_lease_token uuid, p_media_id uuid, p_deleted_revision bigint
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE event RECORD;
BEGIN
  PERFORM app.require_worker();
  SELECT o.id, o.event_type, o.payload, o.status, o.lease_token_hash, o.leased_until
    INTO event FROM public.outbox o WHERE o.id = p_event_id FOR UPDATE;
  IF event.id IS NULL OR event.event_type <> 'media.cleanup_requested'
     OR event.status <> 'running'
     OR NOT app.lease_matches(event.lease_token_hash, p_lease_token)
     OR event.leased_until IS NULL OR event.leased_until < statement_timestamp()
     OR event.payload->>'media_id' IS DISTINCT FROM p_media_id::text
     OR event.payload->>'deleted_revision' IS DISTINCT FROM p_deleted_revision::text THEN
    RAISE EXCEPTION 'media cleanup is not held by this outbox lease'
      USING ERRCODE = 'CMS04';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app.media_for_cleanup(
  p_event_id bigint, p_lease_token uuid, p_media_id uuid, p_deleted_revision bigint
) RETURNS TABLE (kind text, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
#variable_conflict use_column
DECLARE row public.media%ROWTYPE; claim app.media_cleanup_claims%ROWTYPE;
BEGIN
  -- Locks the outbox row.  The media lock below then serializes this claim with
  -- restore, without holding either transaction across object-store I/O.
  PERFORM app.require_media_cleanup_lease(
    p_event_id, p_lease_token, p_media_id, p_deleted_revision);
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;

  -- Restored, re-deleted at another revision, not due yet, or already purged:
  -- settle the stale event without revealing any storage path.
  IF row.id IS NULL OR row.revision <> p_deleted_revision
     OR row.status <> 'deleted' OR row.deleted_at IS NULL
     OR row.purged_at IS NOT NULL
     OR row.deleted_at + interval '30 days' > statement_timestamp() THEN
    RETURN;
  END IF;

  SELECT * INTO claim FROM app.media_cleanup_claims c
   WHERE c.event_id = p_event_id OR c.media_id = p_media_id FOR UPDATE;
  IF claim.event_id IS NOT NULL
     AND (claim.event_id <> p_event_id OR claim.media_id <> p_media_id
          OR claim.deleted_revision <> p_deleted_revision) THEN
    RAISE EXCEPTION 'a different cleanup already owns this media revision'
      USING ERRCODE = 'CMS04';
  END IF;

  INSERT INTO app.media_cleanup_claims (
    event_id, media_id, deleted_revision, started_at, last_claimed_at)
  VALUES (
    p_event_id, p_media_id, p_deleted_revision,
    statement_timestamp(), statement_timestamp())
  ON CONFLICT (event_id) DO UPDATE
    SET last_claimed_at = EXCLUDED.last_claimed_at;

  RETURN QUERY
  SELECT objects.kind, objects.object_key
    FROM (
      SELECT 'original'::text AS kind, row.object_key
      UNION ALL
      SELECT mv.kind, mv.object_key FROM public.media_variants mv
       WHERE mv.media_id = row.id
    ) objects
   ORDER BY CASE WHEN objects.kind = 'original' THEN 0 ELSE 1 END, objects.kind;
END
$$;

CREATE OR REPLACE FUNCTION app.finalize_media_cleanup(
  p_event_id bigint, p_lease_token uuid, p_media_id uuid, p_deleted_revision bigint
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE row public.media%ROWTYPE; claim app.media_cleanup_claims%ROWTYPE; purged timestamptz;
BEGIN
  PERFORM app.require_media_cleanup_lease(
    p_event_id, p_lease_token, p_media_id, p_deleted_revision);
  SELECT * INTO row FROM public.media m WHERE m.id = p_media_id FOR UPDATE;
  SELECT * INTO claim FROM app.media_cleanup_claims c
   WHERE c.event_id = p_event_id AND c.media_id = p_media_id FOR UPDATE;

  IF claim.event_id IS NULL OR claim.deleted_revision <> p_deleted_revision THEN
    RAISE EXCEPTION 'media cleanup was not durably claimed'
      USING ERRCODE = 'CMS04';
  END IF;
  IF row.revision = p_deleted_revision AND row.status = 'deleted'
     AND row.purged_at IS NOT NULL AND claim.completed_at IS NOT NULL THEN
    RETURN row.purged_at;
  END IF;
  IF row.revision <> p_deleted_revision OR row.status <> 'deleted'
     OR row.deleted_at IS NULL OR row.purged_at IS NOT NULL
     OR row.deleted_at + interval '30 days' > statement_timestamp()
     OR claim.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'media is not an eligible claimed cleanup at this delete revision'
      USING ERRCODE = 'CMS04';
  END IF;

  purged := statement_timestamp();
  UPDATE public.media SET purged_at = purged WHERE id = row.id;
  UPDATE app.media_cleanup_claims SET completed_at = purged
   WHERE event_id = claim.event_id;
  PERFORM app.write_audit(
    row.site_id, 'system', NULL, 'media.cleanup.finalize', 'media', row.id,
    row.id, NULL,
    jsonb_build_object('deleted_revision', row.revision,
      'outbox_event_id', p_event_id, 'purged_at', purged));
  RETURN purged;
END
$$;

-- ============================================= immutable version references ==

CREATE OR REPLACE FUNCTION app.media_references_in_page_content(p_content jsonb)
RETURNS TABLE (media_id uuid, variant text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE reference RECORD;
BEGIN
  FOR reference IN
    SELECT DISTINCT slot_value->>'media_id' AS candidate,
                    slot_value->>'variant' AS governed_variant
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_content) = 'array' THEN p_content ELSE '[]'::jsonb END)
        AS sections(section_value),
      LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(section_value->'values') = 'object'
             THEN section_value->'values' ELSE '{}'::jsonb END)
        AS slots(slot_key, slot_value)
     WHERE jsonb_typeof(slot_value) = 'object' AND slot_value ? 'media_id'
  LOOP
    IF reference.candidate IS NULL
       OR reference.candidate !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'page content contains an invalid media reference'
        USING ERRCODE = 'CMS04';
    END IF;
    IF reference.governed_variant IS NULL
       OR reference.governed_variant NOT IN ('original', 'thumbnail', 'card', 'wide') THEN
      RAISE EXCEPTION 'page content contains an unsupported media variant'
        USING ERRCODE = 'CMS04';
    END IF;
    media_id := reference.candidate::uuid;
    variant := reference.governed_variant;
    RETURN NEXT;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.index_page_version_media(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version_row RECORD; reference RECORD; media_row RECORD;
BEGIN
  SELECT pv.id, pv.site_id, pv.page_id, pv.content INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;

  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
  LOOP
    SELECT m.id, m.site_id, m.status, m.deleted_at INTO media_row
      FROM public.media m WHERE m.id = reference.media_id;
    IF media_row.id IS NULL
       OR media_row.site_id IS DISTINCT FROM version_row.site_id
       OR media_row.status <> 'ready' OR media_row.deleted_at IS NOT NULL
       OR (reference.variant <> 'original' AND NOT EXISTS (
         SELECT 1 FROM public.media_variants mv
          WHERE mv.media_id = reference.media_id AND mv.kind = reference.variant
            AND mv.mime_type IS NOT NULL AND mv.content_hash IS NOT NULL)) THEN
      RAISE EXCEPTION 'page content contains media or a variant that is unresolved, deleted, or belongs to another site'
        USING ERRCODE = 'CMS04';
    END IF;
    INSERT INTO public.media_usage (media_id, site_id, item_type, item_id, version_id)
    VALUES (reference.media_id, version_row.site_id, 'page', version_row.page_id, version_row.id)
    ON CONFLICT (media_id, version_id) DO NOTHING;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.index_new_page_version_media()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM app.index_page_version_media(NEW.id);
  RETURN NEW;
END
$$;

CREATE TRIGGER page_versions_index_media
  AFTER INSERT ON public.page_versions
  FOR EACH ROW EXECUTE FUNCTION app.index_new_page_version_media();

-- Backfill every immutable version written before media references became an
-- indexed database fact.  If one contains a cross-tenant or unresolved id, the
-- migration fails rather than blessing a broken publication.
DO $$
DECLARE version_id uuid;
BEGIN
  FOR version_id IN SELECT id FROM public.page_versions
  LOOP
    PERFORM app.index_page_version_media(version_id);
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.assert_page_version_media_ready(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE version_row RECORD; reference RECORD; ok boolean;
BEGIN
  SELECT pv.id, pv.site_id, pv.content INTO version_row
    FROM public.page_versions pv WHERE pv.id = p_version_id;
  IF version_row.id IS NULL THEN
    RAISE EXCEPTION 'no such page version' USING ERRCODE = 'CMS03';
  END IF;
  FOR reference IN SELECT * FROM app.media_references_in_page_content(version_row.content)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.media m
       WHERE m.id = reference.media_id AND m.site_id = version_row.site_id
         AND m.status = 'ready' AND m.deleted_at IS NULL
         AND (reference.variant = 'original' OR EXISTS (
           SELECT 1 FROM public.media_variants mv
            WHERE mv.media_id = m.id AND mv.kind = reference.variant
              AND mv.mime_type IS NOT NULL AND mv.content_hash IS NOT NULL))
         AND EXISTS (SELECT 1 FROM public.media_usage u
                      WHERE u.media_id = m.id AND u.version_id = version_row.id))
      INTO ok;
    IF NOT ok THEN
      RAISE EXCEPTION 'page version contains media that is no longer publishable'
        USING ERRCODE = 'CMS04';
    END IF;
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION app.enforce_page_media_publication()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.published_version_id IS DISTINCT FROM OLD.published_version_id
     AND NEW.published_version_id IS NOT NULL THEN
    PERFORM app.assert_page_version_media_ready(NEW.published_version_id);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER pages_media_ready_before_publish
  BEFORE UPDATE OF published_version_id ON public.pages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_page_media_publication();

-- ================================================================ resolvers ==

CREATE OR REPLACE FUNCTION app.resolve_media(p_media_id uuid, p_variant text)
RETURNS TABLE (
  media_id uuid, variant text, object_key text, mime_type text,
  bytes bigint, width integer, height integer, content_hash text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor uuid;
BEGIN
  actor := app.require_actor();
  IF p_variant NOT IN ('original', 'thumbnail', 'card', 'wide') THEN
    RAISE EXCEPTION 'unsupported media variant' USING ERRCODE = 'CMS04';
  END IF;
  RETURN QUERY
  SELECT m.id, p_variant,
         CASE WHEN p_variant = 'original' THEN m.object_key ELSE v.object_key END,
         CASE WHEN p_variant = 'original' THEN m.mime_type ELSE v.mime_type END,
         CASE WHEN p_variant = 'original' THEN m.bytes ELSE v.bytes END,
         CASE WHEN p_variant = 'original' THEN m.width ELSE v.width END,
         CASE WHEN p_variant = 'original' THEN m.height ELSE v.height END,
         CASE WHEN p_variant = 'original' THEN m.content_hash ELSE v.content_hash END
    FROM public.media m
    LEFT JOIN public.media_variants v
      ON v.media_id = m.id AND v.kind = p_variant AND p_variant <> 'original'
   WHERE m.id = p_media_id AND m.status = 'ready' AND m.deleted_at IS NULL
     AND ((m.site_id IS NULL AND actor IS NOT NULL) OR app.has_site_access(m.site_id))
     AND (p_variant = 'original' OR v.id IS NOT NULL);
END
$$;

CREATE OR REPLACE FUNCTION public_api.resolve_media(
  p_host text, p_media_id uuid, p_variant text
) RETURNS TABLE (
  media_id uuid, variant text, object_key text, mime_type text,
  bytes bigint, width integer, height integer, content_hash text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT m.id, p_variant,
         CASE WHEN p_variant = 'original' THEN m.object_key ELSE v.object_key END,
         CASE WHEN p_variant = 'original' THEN m.mime_type ELSE v.mime_type END,
         CASE WHEN p_variant = 'original' THEN m.bytes ELSE v.bytes END,
         CASE WHEN p_variant = 'original' THEN m.width ELSE v.width END,
         CASE WHEN p_variant = 'original' THEN m.height ELSE v.height END,
         CASE WHEN p_variant = 'original' THEN m.content_hash ELSE v.content_hash END
    FROM public_api.resolve_host(p_host) h
    JOIN public.media m ON m.site_id = h.site_id
    LEFT JOIN public.media_variants v
      ON v.media_id = m.id AND v.kind = p_variant AND p_variant <> 'original'
   WHERE p_variant IN ('original', 'thumbnail', 'card', 'wide')
     AND m.id = p_media_id AND m.status = 'ready' AND m.deleted_at IS NULL
     AND (p_variant = 'original' OR v.id IS NOT NULL)
$$;

-- ======================================================= grants + ownership ==

-- Remove the inherited table-level grants from 0002.  A future object identity
-- column must not become browser-readable merely because media grew a column.
REVOKE ALL ON public.media, public.media_variants, public.media_usage
  FROM cms_authenticated_user;
GRANT SELECT (
  id, site_id, original_name, alt_text, decorative, focal, width, height, bytes,
  mime_type, status, uploaded_by, created_at, deleted_at, purged_at, revision, folder,
  attribution, source, tags
) ON public.media TO cms_authenticated_user;
GRANT SELECT (id, media_id, kind, width, height, bytes, mime_type, created_at)
  ON public.media_variants TO cms_authenticated_user;
GRANT SELECT (media_id, site_id, item_type, item_id, version_id, created_at)
  ON public.media_usage TO cms_authenticated_user;

REVOKE ALL ON FUNCTION app.media_focal_is_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_tags_are_valid(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_authoring_metadata_is_valid(text,boolean,jsonb,text,text,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_original_name_is_valid(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_extension(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_upload_token_digest(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_upload_token_matches(bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.begin_media_upload(uuid,text,text,bigint,text,boolean,jsonb,text,text,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_upload_for_receipt(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_media_upload_received(uuid,uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_media_upload_receipt(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_upload_for_inspection(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finalize_media_upload(uuid,text,text,text,text,bigint,integer,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_media_upload(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.update_media_metadata(uuid,bigint,text,boolean,jsonb,text,text,text,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.soft_delete_media(uuid,bigint,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.restore_media(uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.require_media_cleanup_lease(bigint,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_for_cleanup(bigint,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finalize_media_cleanup(bigint,uuid,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.media_references_in_page_content(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.index_page_version_media(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.index_new_page_version_media() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.assert_page_version_media_ready(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.enforce_page_media_publication() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_media(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_api.resolve_media(text,uuid,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  app.begin_media_upload(uuid,text,text,bigint,text,boolean,jsonb,text,text,text,text[]),
  app.media_upload_for_receipt(uuid,uuid),
  app.mark_media_upload_received(uuid,uuid,text,text,bigint),
  app.fail_media_upload_receipt(uuid,uuid,text,text),
  app.update_media_metadata(uuid,bigint,text,boolean,jsonb,text,text,text,text[]),
  app.soft_delete_media(uuid,bigint,boolean,text),
  app.restore_media(uuid,bigint),
  app.resolve_media(uuid,text)
TO cms_authenticated_user;

GRANT EXECUTE ON FUNCTION
  app.media_upload_for_inspection(uuid),
  app.finalize_media_upload(uuid,text,text,text,text,bigint,integer,integer,jsonb),
  app.fail_media_upload(uuid,text,text),
  app.media_for_cleanup(bigint,uuid,uuid,bigint),
  app.finalize_media_cleanup(bigint,uuid,uuid,bigint)
TO cms_worker;

GRANT EXECUTE ON FUNCTION public_api.resolve_media(text,uuid,text)
  TO cms_public_renderer, cms_authenticated_user;

DO $$
DECLARE obj RECORD;
BEGIN
  FOR obj IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('app', 'public_api')
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO cms_migration_owner', obj.sig);
  END LOOP;
END
$$;
