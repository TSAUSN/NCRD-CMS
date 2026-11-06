import { bigint, boolean, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sites } from './sites.ts'
import { appUsers } from './identity.ts'
import { pages, pageVersions } from './pages.ts'
export const siteAssets = pgTable('site_assets', {
  id: uuid('id').primaryKey(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  kind: text('kind').notNull(),
  objectKey: text('object_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  contentHash: text('content_hash').notNull(),
  originalName: text('original_name').notNull(),
  fontKey: text('font_key'),
  provenance: jsonb('provenance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => appUsers.id),
})
export const siteAssetUsage = pgTable(
  'site_asset_usage',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => siteAssets.id),
    siteId: uuid('site_id').notNull(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => pageVersions.id),
  },
  table => [primaryKey({ columns: [table.assetId, table.versionId] })],
)
export const siteDocumentMetadata = pgTable('site_document_metadata', {
  assetId: uuid('asset_id')
    .primaryKey()
    .references(() => siteAssets.id),
  siteId: uuid('site_id').notNull(),
  category: text('category').notNull().default(''),
  archived: boolean('archived').notNull().default(false),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
})
