import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  actorType,
  outboxStatus,
  reviewableType,
  scheduledActionKind,
  scheduledStatus,
  submissionStatus,
} from './enums.ts'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  itemType: reviewableType('item_type').notNull(),
  itemId: uuid('item_id').notNull(),
  // Approval is refused once this stops being the head draft (SPEC §5).
  versionId: uuid('version_id').notNull(),
  status: submissionStatus('status').notNull().default('open'),
  submittedBy: uuid('submitted_by')
    .notNull()
    .references(() => appUsers.id),
  decidedBy: uuid('decided_by').references(() => appUsers.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  note: text('note').notNull().default(''),
  decisionNote: text('decision_note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  itemType: reviewableType('item_type').notNull(),
  itemId: uuid('item_id').notNull(),
  versionId: uuid('version_id'),
  body: text('body').notNull(),
  mentions: jsonb('mentions').notNull().default([]),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => appUsers.id),
})

/**
 * The SHA-256 of a lease capability. Only the digest is ever stored — the token
 * itself is returned by the claim and lives nowhere else (migration 0010) — so
 * nothing that can read this column can act with it.
 */
const leaseTokenHash = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

export const scheduledActions = pgTable('scheduled_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  itemType: reviewableType('item_type').notNull(),
  itemId: uuid('item_id').notNull(),
  versionId: uuid('version_id').notNull(),
  action: scheduledActionKind('action').notNull(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(),
  status: scheduledStatus('status').notNull().default('pending'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => appUsers.id),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lastError: text('last_error'),
  // 'permanent' | 'attempts_exhausted' | 'retryable' — losing authorization is
  // not a transient condition and must not burn every attempt (ADR 0003).
  failureKind: text('failure_kind'),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leasedBy: text('leased_by'),
  leasedUntil: timestamp('leased_until', { withTimezone: true }),
  leaseTokenHash: leaseTokenHash('lease_token_hash'),
  // Pinned when the schedule is made, not read when it fires: the version that
  // judges the page is a decision, the same way the version to publish is
  // (SPEC §6.8).
  readinessPolicyVersion: integer('readiness_policy_version').notNull(),
  // What the worker actually evaluated, kept whether it published or was
  // blocked, so "the scheduler said no" is reviewable.
  readinessReport: jsonb('readiness_report'),
  requestId: uuid('request_id').unique(),
  retryOfId: uuid('retry_of_id')
    .unique()
    .references((): AnyPgColumn => scheduledActions.id),
  overrideReason: text('override_reason'),
  authorizedFindings: jsonb('authorized_findings').notNull().default([]),
  samplesConfirmed: boolean('samples_confirmed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const jobHeartbeats = pgTable('job_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  role: text('role').notNull().default('worker'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  version: text('version').notNull().default(''),
})

// The only two tables public traffic reads, and it reads them through
// public_api functions rather than by name (migrations/0004_public_api.sql).
export const publishedSiteShells = pgTable('published_site_shells', {
  siteId: uuid('site_id')
    .primaryKey()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  payload: jsonb('payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const publishedRoutes = pgTable(
  'published_routes',
  {
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    path: text('path').notNull(),
    pageId: uuid('page_id').notNull(),
    pageVersionId: uuid('page_version_id').notNull(),
    shellRevision: bigint('shell_revision', { mode: 'number' }).notNull(),
    renderManifest: jsonb('render_manifest').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.siteId, t.path] })],
)

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  siteId: uuid('site_id').references(() => sites.id),
  actorType: actorType('actor_type').notNull(),
  actorId: uuid('actor_id').references(() => appUsers.id),
  action: text('action').notNull(),
  itemType: text('item_type').notNull().default(''),
  itemId: uuid('item_id'),
  beforeRef: uuid('before_ref'),
  afterRef: uuid('after_ref'),
  detail: jsonb('detail').notNull().default({}),
  requestId: text('request_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Written in the same transaction as the change it describes, then delivered
// at-least-once with leases, bounded backoff, and dead-lettering (ADR 0003).
export const outbox = pgTable('outbox', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  siteId: uuid('site_id').references(() => sites.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: outboxStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(8),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  leasedBy: text('leased_by'),
  leasedUntil: timestamp('leased_until', { withTimezone: true }),
  leaseTokenHash: leaseTokenHash('lease_token_hash'),
  lastError: text('last_error'),
})
