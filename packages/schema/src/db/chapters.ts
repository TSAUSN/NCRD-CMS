import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { pages } from './pages.ts'
import { sites } from './sites.ts'
import { appUsers } from './identity.ts'
export const chapters = pgTable('chapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  slug: text('slug').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
  draftVersionId: uuid('draft_version_id'),
  publishedVersionId: uuid('published_version_id'),
})
export const chapterVersions = pgTable('chapter_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  config: jsonb('config').notNull(),
  authorId: uuid('author_id').references(() => appUsers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const contactMessages = pgTable('contact_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  pageId: uuid('page_id').notNull(),
  message: jsonb('message').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
export const chapterPageVersions = pgTable('chapter_page_versions', {
  pageVersionId: uuid('page_version_id').primaryKey(),
  chapterVersionId: uuid('chapter_version_id').notNull(),
  siteId: uuid('site_id').notNull(),
  chapterId: uuid('chapter_id').notNull(),
})
export const siteReleaseChapterPins = pgTable(
  'site_release_chapter_pins',
  {
    releaseId: uuid('release_id').notNull(),
    siteId: uuid('site_id').notNull(),
    versionId: uuid('version_id').notNull(),
  },
  table => [primaryKey({ columns: [table.releaseId, table.versionId] })],
)

export const chapterDivisions = pgTable('chapter_divisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id),
  name: text('name').notNull(),
})
export const chapterDivisionMemberships = pgTable(
  'chapter_division_memberships',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => chapterDivisions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id),
  },
  table => [primaryKey({ columns: [table.divisionId, table.userId] })],
)
export const chapterDivisionAssignments = pgTable('chapter_division_assignments', {
  chapterId: uuid('chapter_id')
    .primaryKey()
    .references(() => chapters.id),
  divisionId: uuid('division_id')
    .notNull()
    .references(() => chapterDivisions.id),
})
export const pageMemberships = pgTable(
  'page_memberships',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUsers.id),
  },
  table => [primaryKey({ columns: [table.pageId, table.userId] })],
)
export const chapterSharedSections = pgTable(
  'chapter_shared_sections',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id),
    part: text('part').notNull(),
    position: integer('position').notNull(),
    instance: jsonb('instance').notNull(),
  },
  table => [primaryKey({ columns: [table.pageId, table.part] })],
)

export const chapterSiteSettings = pgTable('chapter_site_settings', {
  siteId: uuid('site_id')
    .primaryKey()
    .references(() => sites.id),
  revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  defaultUpdateMode: text('default_update_mode').notNull().default('division'),
  checksEnabled: boolean('checks_enabled').notNull().default(true),
  reviewRemindersEnabled: boolean('review_reminders_enabled').notNull().default(true),
})
