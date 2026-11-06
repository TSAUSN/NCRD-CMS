-- 0001 — the normalized head/version data model (SPEC §5).
--
-- One pattern throughout: a *head* row owns identity, status, revision, and
-- pointers; immutable *version* rows own content. Three families of constraint
-- turn the prose in §5 into database facts:
--
--   1. Tenant consistency — every version carries site_id and a COMPOSITE
--      foreign key (site_id, head_id) -> head(site_id, id). A version can
--      never be filed under a site its head does not belong to.
--   2. Head/version ownership — every pointer is a COMPOSITE foreign key
--      (id, pointer) -> version(head_id, id). A head can never point at
--      another head's version.
--   3. Revision monotonicity — UNIQUE(head_id, revision) plus a positive
--      check; the commands in 0003 own the increment.

CREATE TYPE user_status        AS ENUM ('active', 'disabled');
CREATE TYPE global_role_name   AS ENUM ('super_admin');
CREATE TYPE site_role_name     AS ENUM ('site_admin', 'editor', 'contributor');
CREATE TYPE site_kind          AS ENUM ('resource', 'event', 'conference', 'campaign', 'general');
CREATE TYPE site_status        AS ENUM ('onboarding', 'in_progress', 'live', 'archived');
CREATE TYPE layout_mode        AS ENUM ('sections', 'freeform');
CREATE TYPE page_status        AS ENUM ('draft', 'published', 'archived');
CREATE TYPE version_kind       AS ENUM ('autosave', 'checkpoint', 'submission', 'publish', 'restore');
CREATE TYPE section_scope      AS ENUM ('global', 'site');
CREATE TYPE section_status     AS ENUM ('active', 'hidden', 'retired');
CREATE TYPE collection_source  AS ENUM ('builtin', 'admin');
CREATE TYPE global_element_kind AS ENUM ('header', 'footer');
CREATE TYPE media_status       AS ENUM ('processing', 'ready', 'failed', 'deleted');
CREATE TYPE domain_kind        AS ENUM ('primary', 'redirect', 'staging');
CREATE TYPE domain_status      AS ENUM ('pending_dns', 'verifying', 'issuing_cert', 'live', 'error', 'removing');
CREATE TYPE reviewable_type    AS ENUM ('page', 'collection_entry', 'global_element', 'site_settings', 'theme', 'navigation');
CREATE TYPE submission_status  AS ENUM ('open', 'approved', 'rejected', 'superseded');
CREATE TYPE scheduled_action_kind AS ENUM ('publish', 'unpublish');
CREATE TYPE scheduled_status   AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE actor_type         AS ENUM ('user', 'system', 'scheduler', 'migration');

-- JSON size bound used on every authored payload. Bytes, not rows: a runaway
-- client cannot turn one page into a multi-megabyte row (SPEC §5).
CREATE OR REPLACE FUNCTION app.json_within(payload jsonb, max_bytes int)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT octet_length(payload::text) <= max_bytes
$$;

-- ---------------------------------------------------------------- identity --

CREATE TABLE app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the verified subject from the auth provider; NULL until an invite is
  -- accepted, which is why the product record can exist before the login does.
  auth_subject  text UNIQUE,
  email         text NOT NULL UNIQUE,
  display_name  text NOT NULL DEFAULT '',
  status        user_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_lower CHECK (email = lower(email))
);

CREATE TABLE global_roles (
  user_id    uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  role       global_role_name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  kind             site_kind NOT NULL,
  status           site_status NOT NULL DEFAULT 'onboarding',
  -- normalized: lowercase, no port, no trailing dot (SPEC §5)
  staging_hostname text UNIQUE,
  created_by       uuid REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CONSTRAINT sites_staging_hostname_normalized
    CHECK (staging_hostname IS NULL OR staging_hostname = lower(staging_hostname))
);

CREATE TABLE site_memberships (
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role       site_role_name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, site_id)
);
CREATE INDEX site_memberships_site ON site_memberships(site_id);

-- ------------------------------------------------------------ site settings --

CREATE TABLE site_settings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  UNIQUE (site_id, id)
);

CREATE TABLE site_setting_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id          uuid NOT NULL,
  site_settings_id uuid NOT NULL,
  revision         bigint NOT NULL CHECK (revision > 0),
  settings         jsonb NOT NULL,
  author_id        uuid REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_settings_id, revision),
  UNIQUE (site_settings_id, id),
  CONSTRAINT site_setting_versions_tenant
    FOREIGN KEY (site_id, site_settings_id) REFERENCES site_settings(site_id, id) ON DELETE CASCADE,
  CONSTRAINT site_setting_versions_size CHECK (app.json_within(settings, 262144))
);

ALTER TABLE site_settings
  ADD CONSTRAINT site_settings_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES site_setting_versions(site_settings_id, id),
  ADD CONSTRAINT site_settings_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES site_setting_versions(site_settings_id, id);

-- -------------------------------------------------------------------- pages --

CREATE TABLE pages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug                 text NOT NULL,
  title                text NOT NULL,
  layout_mode          layout_mode NOT NULL DEFAULT 'sections',
  status               page_status NOT NULL DEFAULT 'draft',
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  editor_label         text NOT NULL DEFAULT '',
  sort_index           integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  UNIQUE (site_id, slug),
  UNIQUE (site_id, id),
  -- Public paths are normalized at the door: leading slash, lowercase, no
  -- trailing slash except the root. Route lookup can then be an equality test.
  -- '' is the root page. Otherwise a bare path with no leading or trailing
  -- slash, so app.page_path() can build the public path by concatenation.
  CONSTRAINT pages_slug_normalized
    CHECK (slug = lower(slug) AND slug !~ '\s' AND slug NOT LIKE '/%' AND slug NOT LIKE '%/')
);
CREATE INDEX pages_site_sort ON pages(site_id, sort_index);

CREATE TABLE page_versions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                  uuid NOT NULL,
  page_id                  uuid NOT NULL,
  revision                 bigint NOT NULL CHECK (revision > 0),
  content                  jsonb NOT NULL,
  meta                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Recomputed server-side from the payload on every save. The client's
  -- opinion is never stored (SPEC §4).
  carries_trusted_code     boolean NOT NULL DEFAULT false,
  -- Set only by a super admin approving the raw markup in this exact version.
  trusted_code_approved_by uuid REFERENCES app_users(id),
  trusted_code_approved_at timestamptz,
  kind                     version_kind NOT NULL,
  note                     text NOT NULL DEFAULT '',
  author_id                uuid REFERENCES app_users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, revision),
  UNIQUE (page_id, id),
  CONSTRAINT page_versions_tenant
    FOREIGN KEY (site_id, page_id) REFERENCES pages(site_id, id) ON DELETE CASCADE,
  CONSTRAINT page_versions_size CHECK (app.json_within(content, 1048576) AND app.json_within(meta, 65536)),
  CONSTRAINT page_versions_approval_pairing
    CHECK ((trusted_code_approved_by IS NULL) = (trusted_code_approved_at IS NULL))
);
CREATE INDEX page_versions_page_created ON page_versions(page_id, created_at DESC);

ALTER TABLE pages
  ADD CONSTRAINT pages_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES page_versions(page_id, id),
  ADD CONSTRAINT pages_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES page_versions(page_id, id);

-- ------------------------------------------------------------------- themes --

CREATE TABLE themes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  UNIQUE (site_id, id)
);

CREATE TABLE theme_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL,
  theme_id   uuid NOT NULL,
  revision   bigint NOT NULL CHECK (revision > 0),
  tokens     jsonb NOT NULL,
  author_id  uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (theme_id, revision),
  UNIQUE (theme_id, id),
  CONSTRAINT theme_versions_tenant
    FOREIGN KEY (site_id, theme_id) REFERENCES themes(site_id, id) ON DELETE CASCADE,
  CONSTRAINT theme_versions_size CHECK (app.json_within(tokens, 131072))
);

ALTER TABLE themes
  ADD CONSTRAINT themes_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES theme_versions(theme_id, id),
  ADD CONSTRAINT themes_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES theme_versions(theme_id, id);

-- ---------------------------------------------------------- global elements --

CREATE TABLE global_elements (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind                 global_element_kind NOT NULL,
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  use_on_live          boolean NOT NULL DEFAULT false,
  UNIQUE (site_id, kind),
  UNIQUE (site_id, id)
);

CREATE TABLE global_element_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL,
  global_element_id uuid NOT NULL,
  revision          bigint NOT NULL CHECK (revision > 0),
  content           jsonb NOT NULL,
  author_id         uuid REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (global_element_id, revision),
  UNIQUE (global_element_id, id),
  CONSTRAINT global_element_versions_tenant
    FOREIGN KEY (site_id, global_element_id) REFERENCES global_elements(site_id, id) ON DELETE CASCADE,
  CONSTRAINT global_element_versions_size CHECK (app.json_within(content, 262144))
);

ALTER TABLE global_elements
  ADD CONSTRAINT global_elements_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES global_element_versions(global_element_id, id),
  ADD CONSTRAINT global_elements_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES global_element_versions(global_element_id, id);

-- --------------------------------------------------------------- navigation --

CREATE TABLE navigations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  UNIQUE (site_id, id)
);

CREATE TABLE navigation_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL,
  navigation_id uuid NOT NULL,
  revision      bigint NOT NULL CHECK (revision > 0),
  tree          jsonb NOT NULL,
  author_id     uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (navigation_id, revision),
  UNIQUE (navigation_id, id),
  CONSTRAINT navigation_versions_tenant
    FOREIGN KEY (site_id, navigation_id) REFERENCES navigations(site_id, id) ON DELETE CASCADE,
  CONSTRAINT navigation_versions_size CHECK (app.json_within(tree, 131072))
);

ALTER TABLE navigations
  ADD CONSTRAINT navigations_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES navigation_versions(navigation_id, id),
  ADD CONSTRAINT navigations_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES navigation_versions(navigation_id, id);

-- ------------------------------------------------------- section definitions --

CREATE TABLE section_defs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope      section_scope NOT NULL DEFAULT 'global',
  site_id    uuid REFERENCES sites(id) ON DELETE CASCADE,
  slug       text NOT NULL,
  name       text NOT NULL,
  category   text NOT NULL DEFAULT '',
  status     section_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A global def has no site; a site def must name one. Slugs are unique
  -- within their scope, so a site may shadow a global slug deliberately.
  CONSTRAINT section_defs_scope_site
    CHECK ((scope = 'global' AND site_id IS NULL) OR (scope = 'site' AND site_id IS NOT NULL))
);
CREATE UNIQUE INDEX section_defs_global_slug ON section_defs(slug) WHERE scope = 'global';
CREATE UNIQUE INDEX section_defs_site_slug   ON section_defs(site_id, slug) WHERE scope = 'site';

CREATE TABLE section_def_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_def_id          uuid NOT NULL REFERENCES section_defs(id) ON DELETE CASCADE,
  version                 integer NOT NULL CHECK (version > 0),
  source_html             text NOT NULL,
  source_css              text NOT NULL DEFAULT '',
  -- What the renderer actually consumes. Public rendering never reparses
  -- arbitrary authored markup per request (SPEC §6.5).
  compiled_ast            jsonb NOT NULL,
  slots                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which policy version checked this. A future policy bump can report which
  -- definitions need revalidation instead of silently changing live output.
  sanitizer_policy_version integer NOT NULL DEFAULT 1,
  render_hash             text NOT NULL,
  carries_trusted_code    boolean NOT NULL DEFAULT false,
  thumbnail_path          text,
  changelog               text NOT NULL DEFAULT '',
  created_by              uuid REFERENCES app_users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_def_id, version),
  CONSTRAINT section_def_versions_size
    CHECK (app.json_within(compiled_ast, 1048576) AND app.json_within(slots, 131072)
           AND octet_length(source_html) <= 524288 AND octet_length(source_css) <= 262144)
);

-- --------------------------------------------------------------- collections --

CREATE TABLE collections (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug                        text NOT NULL,
  name                        text NOT NULL,
  -- the stable key section slots bind to; renaming must not break bindings
  reader_key                  text NOT NULL,
  source                      collection_source NOT NULL DEFAULT 'admin',
  revision                    bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_schema_version_id     uuid,
  published_schema_version_id uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug),
  UNIQUE (site_id, reader_key),
  UNIQUE (site_id, id)
);

CREATE TABLE collection_schema_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL,
  collection_id uuid NOT NULL,
  revision      bigint NOT NULL CHECK (revision > 0),
  fields        jsonb NOT NULL,
  sort          jsonb,
  author_id     uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, revision),
  UNIQUE (collection_id, id),
  CONSTRAINT collection_schema_versions_tenant
    FOREIGN KEY (site_id, collection_id) REFERENCES collections(site_id, id) ON DELETE CASCADE,
  CONSTRAINT collection_schema_versions_size CHECK (app.json_within(fields, 131072))
);

ALTER TABLE collections
  ADD CONSTRAINT collections_draft_schema_owned
    FOREIGN KEY (id, draft_schema_version_id) REFERENCES collection_schema_versions(collection_id, id),
  ADD CONSTRAINT collections_published_schema_owned
    FOREIGN KEY (id, published_schema_version_id) REFERENCES collection_schema_versions(collection_id, id);

CREATE TABLE collection_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id              uuid NOT NULL,
  collection_id        uuid NOT NULL,
  stable_key           text NOT NULL,
  sort_index           integer NOT NULL DEFAULT 0,
  revision             bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  draft_version_id     uuid,
  published_version_id uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  UNIQUE (collection_id, stable_key),
  UNIQUE (site_id, id),
  UNIQUE (id, collection_id),
  CONSTRAINT collection_entries_tenant
    FOREIGN KEY (site_id, collection_id) REFERENCES collections(site_id, id) ON DELETE CASCADE
);
CREATE INDEX collection_entries_collection_sort ON collection_entries(collection_id, sort_index);

CREATE TABLE collection_entry_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    uuid NOT NULL,
  entry_id   uuid NOT NULL,
  revision   bigint NOT NULL CHECK (revision > 0),
  "values"   jsonb NOT NULL,
  author_id  uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, revision),
  UNIQUE (entry_id, id),
  CONSTRAINT collection_entry_versions_tenant
    FOREIGN KEY (site_id, entry_id) REFERENCES collection_entries(site_id, id) ON DELETE CASCADE,
  CONSTRAINT collection_entry_versions_size CHECK (app.json_within("values", 262144))
);

ALTER TABLE collection_entries
  ADD CONSTRAINT collection_entries_draft_owned
    FOREIGN KEY (id, draft_version_id) REFERENCES collection_entry_versions(entry_id, id),
  ADD CONSTRAINT collection_entries_published_owned
    FOREIGN KEY (id, published_version_id) REFERENCES collection_entry_versions(entry_id, id);

-- -------------------------------------------------------------------- media --

CREATE TABLE media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid REFERENCES sites(id) ON DELETE CASCADE,  -- NULL = shared pool
  object_key    text NOT NULL UNIQUE,
  content_hash  text NOT NULL,
  original_name text NOT NULL DEFAULT '',
  alt_text      text NOT NULL DEFAULT '',
  decorative    boolean NOT NULL DEFAULT false,
  focal         jsonb,
  width         integer,
  height        integer,
  bytes         bigint,
  mime_type     text NOT NULL,
  status        media_status NOT NULL DEFAULT 'processing',
  uploaded_by   uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  -- v1's WCAG lesson as a database fact: an image is either described or
  -- explicitly declared decorative before it can leave `processing`.
  CONSTRAINT media_alt_or_decorative
    CHECK (status <> 'ready' OR decorative OR length(btrim(alt_text)) > 0),
  UNIQUE (site_id, id)
);

CREATE TABLE media_variants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id   uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  object_key text NOT NULL UNIQUE,
  width      integer,
  height     integer,
  bytes      bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_id, kind)
);

CREATE TABLE media_usage (
  media_id   uuid NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  site_id    uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_type  reviewable_type NOT NULL,
  item_id    uuid NOT NULL,
  version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_id, version_id)
);
CREATE INDEX media_usage_site ON media_usage(site_id);

-- ------------------------------------------------------------------ domains --

CREATE TABLE domains (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id             uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname_normalized text NOT NULL UNIQUE,
  kind                domain_kind NOT NULL DEFAULT 'primary',
  status              domain_status NOT NULL DEFAULT 'pending_dns',
  dns_records         jsonb,
  verify_token        text,
  provider_ref        text,
  last_checked_at     timestamptz,
  error_code          text,
  error_detail        text,
  redirect_to_domain_id uuid REFERENCES domains(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- lowercase ASCII/punycode, no port, no trailing dot (SPEC §5)
  CONSTRAINT domains_hostname_normalized_shape
    CHECK (hostname_normalized = lower(hostname_normalized)
           AND hostname_normalized !~ '[:/\s]'
           AND hostname_normalized NOT LIKE '%.'),
  CONSTRAINT domains_redirect_pairing
    CHECK (kind <> 'redirect' OR redirect_to_domain_id IS NOT NULL),
  UNIQUE (site_id, id)
);
CREATE INDEX domains_site ON domains(site_id);

-- --------------------------------------------------------- review workflow --

CREATE TABLE submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_type    reviewable_type NOT NULL,
  item_id      uuid NOT NULL,
  -- the exact version reviewed; approval is refused once this stops being the
  -- head draft, which is what makes approval a CAS and not a race (SPEC §5)
  version_id   uuid NOT NULL,
  status       submission_status NOT NULL DEFAULT 'open',
  submitted_by uuid NOT NULL REFERENCES app_users(id),
  decided_by   uuid REFERENCES app_users(id),
  decided_at   timestamptz,
  note         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_decision_pairing
    CHECK ((status IN ('open', 'superseded')) = (decided_at IS NULL))
);
CREATE INDEX submissions_site_status ON submissions(site_id, status);
-- At most one open submission per item: a second submit supersedes, never forks.
CREATE UNIQUE INDEX submissions_one_open ON submissions(item_type, item_id) WHERE status = 'open';

CREATE TABLE comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_type   reviewable_type NOT NULL,
  item_id     uuid NOT NULL,
  version_id  uuid,
  body        text NOT NULL,
  mentions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  author_id   uuid NOT NULL REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT comments_size CHECK (octet_length(body) <= 32768)
);
CREATE INDEX comments_site_item ON comments(site_id, item_type, item_id);

-- ------------------------------------------------------- jobs and schedules --

CREATE TABLE scheduled_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_type     reviewable_type NOT NULL,
  item_id       uuid NOT NULL,
  version_id    uuid NOT NULL,
  action        scheduled_action_kind NOT NULL,
  run_at        timestamptz NOT NULL,
  status        scheduled_status NOT NULL DEFAULT 'pending',
  created_by    uuid NOT NULL REFERENCES app_users(id),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error    text,
  -- lease so two runners cannot execute the same schedule (SPEC §6.8)
  leased_by     text,
  leased_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  CONSTRAINT scheduled_actions_terminal_pairing
    CHECK ((status IN ('succeeded', 'failed', 'cancelled')) = (finished_at IS NOT NULL))
);
CREATE INDEX scheduled_actions_due ON scheduled_actions(run_at) WHERE status = 'pending';

CREATE TABLE job_heartbeats (
  worker_id    text PRIMARY KEY,
  role         text NOT NULL DEFAULT 'worker',
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  version      text NOT NULL DEFAULT ''
);

-- ----------------------------------------------------- published projections --
--
-- The only tables public traffic reads. Public rendering never joins an
-- authoring table (SPEC §5), so a mistake in an authoring-side policy cannot
-- leak a draft to the internet — the draft is not reachable from here at all.

CREATE TABLE published_site_shells (
  site_id    uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  revision   bigint NOT NULL CHECK (revision > 0),
  payload    jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_site_shells_size CHECK (app.json_within(payload, 524288))
);

CREATE TABLE published_routes (
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path            text NOT NULL,
  page_id         uuid NOT NULL,
  page_version_id uuid NOT NULL,
  shell_revision  bigint NOT NULL,
  render_manifest jsonb NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, path),
  -- The projection can only ever cite a page and version of its own site.
  CONSTRAINT published_routes_page_tenant
    FOREIGN KEY (site_id, page_id) REFERENCES pages(site_id, id) ON DELETE CASCADE,
  CONSTRAINT published_routes_version_owned
    FOREIGN KEY (page_id, page_version_id) REFERENCES page_versions(page_id, id),
  CONSTRAINT published_routes_path_shape
    CHECK (path LIKE '/%' AND path = lower(path) AND (path = '/' OR path NOT LIKE '%/')),
  CONSTRAINT published_routes_size CHECK (app.json_within(render_manifest, 2097152))
);

-- ------------------------------------------------------- audit and outbox --

CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id    uuid REFERENCES sites(id) ON DELETE SET NULL,
  actor_type actor_type NOT NULL,
  actor_id   uuid REFERENCES app_users(id),
  action     text NOT NULL,
  item_type  text NOT NULL DEFAULT '',
  item_id    uuid,
  before_ref uuid,
  after_ref  uuid,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A user action must name its user; system/scheduler/migration must not
  -- borrow one. Forging an actor is a shape error, not a policy question.
  CONSTRAINT audit_log_actor_pairing
    CHECK ((actor_type = 'user') = (actor_id IS NOT NULL)),
  CONSTRAINT audit_log_size CHECK (app.json_within(detail, 65536))
);
CREATE INDEX audit_log_site_created ON audit_log(site_id, created_at DESC);
CREATE INDEX audit_log_actor_created ON audit_log(actor_id, created_at DESC);

CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id      uuid REFERENCES sites(id) ON DELETE SET NULL,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  CONSTRAINT outbox_size CHECK (app.json_within(payload, 65536))
);
CREATE INDEX outbox_unprocessed ON outbox(created_at) WHERE processed_at IS NULL;

-- Append-only in the strongest available sense: 0002 revokes UPDATE/DELETE
-- from every application role, and this trigger stops even a mistaken
-- privileged session from rewriting history without a deliberate break-glass.
CREATE OR REPLACE FUNCTION app.audit_log_is_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (attempted % as %)', TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.audit_log_is_append_only();

-- A published pointer may never name a version carrying raw markup that no
-- super admin has approved. The publish command checks this too; the trigger
-- is what makes it true even if a future code path forgets (SPEC §4).
CREATE OR REPLACE FUNCTION app.enforce_trusted_code_publication()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD;
BEGIN
  IF NEW.published_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT carries_trusted_code, trusted_code_approved_by INTO v
    FROM page_versions WHERE id = NEW.published_version_id;
  IF v.carries_trusted_code AND v.trusted_code_approved_by IS NULL THEN
    RAISE EXCEPTION 'page version % carries raw markup and has no super-admin approval', NEW.published_version_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER pages_trusted_code_publication
  BEFORE INSERT OR UPDATE OF published_version_id ON pages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_trusted_code_publication();
