import { bigint, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { sites } from './sites.ts'
import { appUsers } from './identity.ts'
import { media } from './content.ts'
export const siteFiles = pgTable(
  'site_files',
  {
    id: uuid('id').primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    source: text('source').notNull(),
    objectKey: text('object_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [unique('site_files_site_id_id_key').on(table.siteId, table.id)],
)
export const siteFileVersions = pgTable(
  'site_file_versions',
  {
    id: uuid('id').primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    version: bigint('version', { mode: 'number' }).notNull(),
    bundle: jsonb('bundle').notNull(),
    reviewedBy: uuid('reviewed_by')
      .notNull()
      .references(() => appUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('site_file_versions_site_id_id_key').on(table.siteId, table.id),
    unique('site_file_versions_site_id_version_key').on(table.siteId, table.version),
  ],
)
export const siteFileHeads = pgTable('site_file_heads', {
  siteId: uuid('site_id')
    .primaryKey()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  draftVersionId: uuid('draft_version_id').references(() => siteFileVersions.id),
  publishedVersionId: uuid('published_version_id').references(() => siteFileVersions.id),
})
export const siteFileMediaUsage = pgTable(
  'site_file_media_usage',
  {
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id),
    siteId: uuid('site_id').notNull(),
    versionId: uuid('version_id').notNull(),
  },
  table => [
    primaryKey({ columns: [table.mediaId, table.versionId] }),
    foreignKey({
      columns: [table.siteId, table.versionId],
      foreignColumns: [siteFileVersions.siteId, siteFileVersions.id],
    }),
  ],
)
