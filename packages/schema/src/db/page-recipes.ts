import { bigint, foreignKey, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'
import { appUsers } from './identity.ts'
import { sites } from './sites.ts'
import { pageVersions } from './pages.ts'

export const pageRecipes = pgTable(
  'page_recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id),
    name: text('name').notNull(),
    scope: text('scope').notNull().default('site'),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    currentVersionId: uuid('current_version_id'),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  table => [unique('page_recipes_id_site_id_key').on(table.id, table.siteId)],
)

export const pageRecipeVersions = pgTable(
  'page_recipe_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id').notNull(),
    siteId: uuid('site_id').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    sourceVersionId: uuid('source_version_id').notNull(),
    content: jsonb('content').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => appUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    unique('page_recipe_versions_id_recipe_id_site_id_key').on(table.id, table.recipeId, table.siteId),
    unique('page_recipe_versions_recipe_id_revision_key').on(table.recipeId, table.revision),
    foreignKey({ columns: [table.recipeId, table.siteId], foreignColumns: [pageRecipes.id, pageRecipes.siteId] }),
    foreignKey({
      columns: [table.siteId, table.sourceVersionId],
      foreignColumns: [pageVersions.siteId, pageVersions.id],
    }),
  ],
)
