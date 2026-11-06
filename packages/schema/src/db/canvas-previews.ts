import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sites } from './sites.ts'
import { appUsers } from './identity.ts'
import { pages, pageVersions } from './pages.ts'
/** Ephemeral, read-only, page-bound capabilities; never session credentials. */
export const canvasPreviewTickets = pgTable(
  'canvas_preview_tickets',
  {
    id: uuid('id').primaryKey(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    versionId: uuid('version_id')
      .notNull()
      .references(() => pageVersions.id),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => appUsers.id),
    tokenHash: text('token_hash').notNull().unique(),
    snapshot: jsonb('snapshot').notNull(),
    assetRefs: jsonb('asset_refs').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  table => [
    index('canvas_tickets_expiry').on(table.expiresAt),
    index('canvas_tickets_actor').on(table.actorId, table.createdAt),
  ],
)
