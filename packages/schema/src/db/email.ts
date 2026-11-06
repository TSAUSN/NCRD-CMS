import { bigint, boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { pages } from './pages.ts'
import { sites } from './sites.ts'
import { chapters } from './chapters.ts'
import { outbox } from './workflow.ts'

export const emailDeliveries = pgTable('email_deliveries', {
  eventId: bigint('event_id', { mode: 'number' })
    .primaryKey()
    .references(() => outbox.id, { onDelete: 'cascade' }),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  providerId: text('provider_id'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  cancelled: boolean('cancelled').notNull().default(false),
})

export const localChapterOutbox = pgTable('local_chapter_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  chapterId: uuid('chapter_id')
    .notNull()
    .references(() => chapters.id),
  relatedChapters: uuid('related_chapters').array(),
  kind: text('kind').notNull(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  dedupeKey: text('dedupe_key').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const localChapterSignInLinks = pgTable('local_chapter_sign_in_links', {
  digest: text('digest').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => appUsers.id),
  pageId: uuid('page_id')
    .notNull()
    .references(() => pages.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
