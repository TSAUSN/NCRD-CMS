import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'

export const sectionRequests = pgTable('section_requests', {
  id: uuid('id').primaryKey(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  status: text('status').notNull().default('open'),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => appUsers.id),
  response: text('response').notNull().default(''),
  respondedBy: uuid('responded_by').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
