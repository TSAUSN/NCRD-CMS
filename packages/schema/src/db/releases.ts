import { boolean, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import {
  globalElementVersions,
  navigationVersions,
  sites,
  siteSettings,
  siteSettingVersions,
  themeVersions,
} from './sites.ts'
import { pageVersions, pages } from './pages.ts'
import { collectionEntryVersions, collectionSchemaVersions } from './content.ts'
import { siteFileVersions } from './site-files.ts'

export const siteReleases = pgTable(
  'site_releases',
  {
    id: uuid('id').primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    status: text('status').notNull().default('planned'),
    snapshot: jsonb('snapshot').notNull(),
    contextHash: text('context_hash').notNull(),
    afterHash: text('after_hash').notNull(),
    previewReport: jsonb('preview_report').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    finishedBy: uuid('finished_by').references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  table => [unique('site_releases_site_id_id_key').on(table.siteId, table.id)],
)
export const siteReleasePages = pgTable(
  'site_release_pages',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => siteReleases.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => pageVersions.id),
  },
  table => [primaryKey({ columns: [table.releaseId, table.versionId] })],
)
export const siteReleaseFilePins = pgTable(
  'site_release_file_pins',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => siteReleases.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    versionId: uuid('version_id').notNull(),
  },
  table => [
    primaryKey({ columns: [table.releaseId, table.versionId] }),
    foreignKey({
      columns: [table.siteId, table.versionId],
      foreignColumns: [siteFileVersions.siteId, siteFileVersions.id],
    }),
  ],
)

// Migration 0102: a release retains its exact pre-apply state so recovery can
// prepare ordinary drafts. Writes happen only through the release commands.
export const siteReleaseRecoveryCaptures = pgTable('site_release_recovery_captures', {
  releaseId: uuid('release_id')
    .primaryKey()
    .references(() => siteReleases.id),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  beforeItems: jsonb('before_items').notNull(),
  afterItems: jsonb('after_items'),
  wasPrivate: boolean('was_private').notNull(),
})
export const siteReleaseVersionPins = pgTable(
  'site_release_version_pins',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => siteReleases.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind').notNull(),
    versionId: uuid('version_id').notNull(),
    themeVersionId: uuid('theme_version_id').references(() => themeVersions.id),
    navigationVersionId: uuid('navigation_version_id').references(() => navigationVersions.id),
    frameVersionId: uuid('frame_version_id').references(() => globalElementVersions.id),
    schemaVersionId: uuid('schema_version_id').references(() => collectionSchemaVersions.id),
    entryVersionId: uuid('entry_version_id').references(() => collectionEntryVersions.id),
  },
  table => [primaryKey({ columns: [table.releaseId, table.kind, table.versionId] })],
)
export const siteReleaseRecoveries = pgTable('site_release_recoveries', {
  id: uuid('id').primaryKey(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  sourceReleaseId: uuid('source_release_id')
    .notNull()
    .references(() => siteReleaseRecoveryCaptures.releaseId),
  expectedState: jsonb('expected_state').notNull(),
  items: jsonb('items').notNull().default([]),
  preparedState: jsonb('prepared_state').notNull().default([]),
  preservedDrafts: jsonb('preserved_drafts').notNull().default([]),
  preparedBy: uuid('prepared_by')
    .notNull()
    .references(() => appUsers.id),
  preparedAt: timestamp('prepared_at', { withTimezone: true }).notNull().defaultNow(),
  applying: boolean('applying').notNull().default(false),
  appliedReleaseId: uuid('applied_release_id').references(() => siteReleases.id),
})

// Migrations 0180 and 0187 retain the exact Story scope and Settings pins.
export const siteReleaseStoryScopes = pgTable(
  'site_release_story_scopes',
  {
    releaseId: uuid('release_id')
      .primaryKey()
      .references(() => siteReleases.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    beforeHash: text('before_hash').notNull(),
    afterHash: text('after_hash').notNull(),
  },
  table => [
    foreignKey({ columns: [table.siteId, table.releaseId], foreignColumns: [siteReleases.siteId, siteReleases.id] }),
  ],
)

export const siteReleaseSettingsPins = pgTable(
  'site_release_settings_pins',
  {
    releaseId: uuid('release_id')
      .notNull()
      .references(() => siteReleases.id),
    siteId: uuid('site_id').notNull(),
    siteSettingsId: uuid('site_settings_id').notNull(),
    versionId: uuid('version_id').notNull(),
  },
  table => [
    primaryKey({ columns: [table.releaseId, table.versionId] }),
    foreignKey({
      columns: [table.siteId, table.siteSettingsId],
      foreignColumns: [siteSettings.siteId, siteSettings.id],
    }),
    foreignKey({
      columns: [table.siteSettingsId, table.versionId],
      foreignColumns: [siteSettingVersions.siteSettingsId, siteSettingVersions.id],
    }),
  ],
)
