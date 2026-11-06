import { bigint, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { submissionStatus } from './enums.ts'
import { appUsers } from './identity.ts'

// SQL migration 0072 owns the compound foreign keys, checks and RLS policies.
export const collectionReviewSnapshots = pgTable('collection_review_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  schemaVersionId: uuid('schema_version_id').notNull(),
  schemaRevision: bigint('schema_revision', { mode: 'number' }).notNull(),
  entryRevision: bigint('entry_revision', { mode: 'number' }).notNull(),
  submitted: jsonb('submitted').notNull(),
  liveAtSubmission: jsonb('live_at_submission').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const collectionReviews = pgTable('collection_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  snapshotId: uuid('snapshot_id')
    .notNull()
    .unique()
    .references(() => collectionReviewSnapshots.id),
  siteId: uuid('site_id').notNull(),
  collectionId: uuid('collection_id').notNull(),
  status: submissionStatus('status').notNull().default('open'),
  submittedBy: uuid('submitted_by')
    .notNull()
    .references(() => appUsers.id),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedBy: uuid('decided_by').references(() => appUsers.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decisionNote: text('decision_note').notNull().default(''),
})

export const collectionReviewComments = pgTable('collection_review_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => collectionReviews.id),
  body: text('body').notNull(),
  mentions: jsonb('mentions').notNull().default([]),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: uuid('resolved_by').references(() => appUsers.id),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
})
