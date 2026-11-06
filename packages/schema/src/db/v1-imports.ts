import { bigint, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'
import { pages, pageVersions } from './pages.ts'
import { media } from './content.ts'

export const v1ImportRuns = pgTable('v1_import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runKey: text('run_key').notNull().unique(),
  manifestSha256: text('manifest_sha256').notNull(),
  bundle: jsonb('bundle').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const v1ImportRecords = pgTable('v1_import_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => v1ImportRuns.id),
  sourceKey: text('source_key').notNull(),
  kind: text('kind').notNull(),
  sourceSite: text('source_site'),
  sourceSha256: text('source_sha256').notNull(),
  payload: jsonb('payload').notNull(),
  issues: jsonb('issues').notNull(),
})
export const v1ImportDecisions = pgTable('v1_import_decisions', {
  id: uuid('id').primaryKey(),
  recordId: uuid('record_id')
    .notNull()
    .references(() => v1ImportRecords.id),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  disposition: text('disposition').notNull(),
  note: text('note').notNull(),
  targetPageVersion: uuid('target_page_version').references(() => pageVersions.id),
  evidence: text('evidence').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const v1ImportTargets = pgTable(
  'v1_import_targets',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => v1ImportRuns.id),
    sourceKey: text('source_key').notNull(),
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
  table => [primaryKey({ columns: [table.runId, table.sourceKey] })],
)
export const v1ImportMedia = pgTable(
  'v1_import_media',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => v1ImportRuns.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    sourcePath: text('source_path').notNull(),
    sourceSha256: text('source_sha256').notNull(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id),
  },
  table => [primaryKey({ columns: [table.runId, table.siteId, table.sourcePath] })],
)
