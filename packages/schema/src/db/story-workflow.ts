import { sql } from 'drizzle-orm'
import { bigint, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { pageVersions } from './pages.ts'
import { submissions } from './workflow.ts'

// Migrations 0181 and 0193 own compound tenancy keys, checks, grants and RLS.
export const storyDraftReceipts = pgTable(
  'story_draft_receipts',
  {
    siteId: uuid('site_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    requestId: uuid('request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    entryId: uuid('entry_id').notNull(),
    pageId: uuid('page_id').notNull(),
    entryRevision: bigint('entry_revision', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  table => [primaryKey({ columns: [table.siteId, table.createdBy, table.requestId] })],
)

export const storyReviewPins = pgTable('story_review_pins', {
  submissionId: uuid('submission_id')
    .primaryKey()
    .references(() => submissions.id),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  entryVersionId: uuid('entry_version_id').notNull(),
  schemaVersionId: uuid('schema_version_id').notNull(),
  pageVersionId: uuid('page_version_id')
    .notNull()
    .unique()
    .references(() => pageVersions.id),
  liveValues: jsonb('live_values'),
  manifest: jsonb('manifest').notNull(),
})
