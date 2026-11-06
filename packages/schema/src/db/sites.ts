import { bigint, boolean, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { domainKind, domainStatus, globalElementKind, siteKind, siteStatus } from './enums.ts'
import { appUsers } from './identity.ts'

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: siteKind('kind').notNull(),
  status: siteStatus('status').notNull().default('onboarding'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  creationRequestId: uuid('creation_request_id').unique(),
  creationFingerprint: text('creation_fingerprint'),
  initialReleaseRequired: boolean('initial_release_required').notNull().default(true),
  chaptersEnabled: boolean('chapters_enabled').notNull().default(false),
  stagingHostname: text('staging_hostname').unique(),
  createdBy: uuid('created_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})

// Head/version pairs all share one shape: the head owns identity, the revision
// CAS token, and the two pointers; the version owns content and never changes.
export const siteSettings = pgTable('site_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .unique()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  draftVersionId: uuid('draft_version_id'),
  publishedVersionId: uuid('published_version_id'),
})

export const siteSettingVersions = pgTable('site_setting_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  siteSettingsId: uuid('site_settings_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  settings: jsonb('settings').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const themes = pgTable('themes', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .unique()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  draftVersionId: uuid('draft_version_id'),
  publishedVersionId: uuid('published_version_id'),
})

export const themeVersions = pgTable('theme_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  themeId: uuid('theme_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  tokens: jsonb('tokens').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const globalElements = pgTable(
  'global_elements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    kind: globalElementKind('kind').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    draftVersionId: uuid('draft_version_id'),
    publishedVersionId: uuid('published_version_id'),
    useOnLive: boolean('use_on_live').notNull().default(false),
  },
  t => [unique('global_elements_site_id_kind_key').on(t.siteId, t.kind)],
)

export const globalElementVersions = pgTable('global_element_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  globalElementId: uuid('global_element_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  content: jsonb('content').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const navigations = pgTable('navigations', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .unique()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  draftVersionId: uuid('draft_version_id'),
  publishedVersionId: uuid('published_version_id'),
  mode: text('mode').notNull().default('auto'),
})

export const navigationVersions = pgTable('navigation_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  navigationId: uuid('navigation_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  tree: jsonb('tree').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const domains = pgTable('domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  hostnameNormalized: text('hostname_normalized').notNull().unique(),
  kind: domainKind('kind').notNull().default('primary'),
  status: domainStatus('status').notNull().default('pending_dns'),
  dnsRecords: jsonb('dns_records'),
  verifyToken: text('verify_token'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  lastRequestedAt: timestamp('last_requested_at', { withTimezone: true }),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  providerRef: text('provider_ref'),
  lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
  errorCode: text('error_code'),
  errorDetail: text('error_detail'),
  redirectToDomainId: uuid('redirect_to_domain_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const domainEvents = pgTable('domain_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  domainId: uuid('domain_id').notNull(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  status: text('status').notNull(),
  detail: text('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const siteRedirects = pgTable('site_redirects', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  oldPath: text('old_path').notNull(),
  pageId: uuid('page_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
