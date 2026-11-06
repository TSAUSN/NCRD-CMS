import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'
import { sectionDefs } from './pages.ts'

export const sectionFavourites = pgTable(
  'section_favourites',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    sectionDefId: uuid('section_def_id')
      .notNull()
      .references(() => sectionDefs.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [primaryKey({ columns: [table.userId, table.siteId, table.sectionDefId] })],
)
