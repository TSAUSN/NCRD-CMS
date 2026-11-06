import { sql } from 'drizzle-orm'
import { jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
// Migration0172 owns compound tenancy keys, checks, indexes, grants and RLS.
export const storySourceChecks = pgTable('story_source_checks', {
  id: uuid('id').primaryKey(),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => appUsers.id),
  startedAt: timestamp('started_at', { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`),
  leaseUntil: timestamp('lease_until', { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()+interval '2 minutes'`),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('checking'),
  result: jsonb('result').notNull().default({}),
})
export const storySourceBaselines = pgTable(
  'story_source_baselines',
  {
    siteId: uuid('site_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    sourceId: text('source_id').notNull(),
    entryId: uuid('entry_id').notNull(),
    fields: jsonb('fields').notNull(),
  },
  table => [
    primaryKey({ columns: [table.collectionId, table.sourceId] }),
    unique().on(table.collectionId, table.entryId),
  ],
)
