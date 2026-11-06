import { bigint, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { globalRoleName, siteRoleName, userStatus } from './enums.ts'
import { sites } from './sites.ts'

export const appUsers = pgTable('app_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // NULL until an invite is accepted: the product record exists before the login
  authSubject: text('auth_subject').unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull().default(''),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  status: userStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const globalRoles = pgTable('global_roles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => appUsers.id),
  role: globalRoleName('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const siteMemberships = pgTable(
  'site_memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    role: siteRoleName('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.userId, t.siteId] })],
)
