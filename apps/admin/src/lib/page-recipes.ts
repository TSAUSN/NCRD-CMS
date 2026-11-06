import { asUser } from '@cms/platform'

export type RecipeSection = {
  section_def_id: string
  section_def_version: number
  label?: string
  values: Record<string, unknown>
  hidden?: boolean
  hidden_at?: string[]
}
export type PageRecipe = {
  id: string
  site_id: string
  scope: 'site' | 'global'
  name: string
  revision: string
  current_version_id: string
  retired_at: string | null
  content: RecipeSection[]
}
export type RecipeSource = {
  id: string
  title: string
  revision: string
  draft_version_id: string | null
  content: RecipeSection[]
}
export async function readPageRecipes(userId: string, siteId: string) {
  return asUser(
    { userId },
    async client => {
      const recipes = (
        await client.query<PageRecipe>(
          `SELECT r.id,r.site_id,r.scope,r.name,r.revision::text,r.current_version_id,
      r.retired_at::text,v.content FROM page_recipes r JOIN page_recipe_versions v ON v.id=r.current_version_id
      WHERE r.site_id=$1 OR r.scope='global' ORDER BY r.retired_at NULLS FIRST,lower(r.name),r.id`,
          [siteId],
        )
      ).rows
      const pages = (
        await client.query<RecipeSource>(
          `SELECT p.id,p.title,p.revision::text,p.draft_version_id,
      COALESCE(v.content,'[]'::jsonb) AS content FROM pages p LEFT JOIN page_versions v ON v.id=p.draft_version_id
      WHERE p.site_id=$1 AND p.archived_at IS NULL ORDER BY lower(p.title),p.id`,
          [siteId],
        )
      ).rows
      const definitions = (
        await client.query<{ id: string; name: string }>(
          "SELECT id,name FROM section_defs WHERE scope='global' OR site_id=$1",
          [siteId],
        )
      ).rows
      return { recipes, pages, names: Object.fromEntries(definitions.map(d => [d.id, d.name])) }
    },
    { isolation: 'repeatable read' },
  )
}
