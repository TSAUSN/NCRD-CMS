'use server'

import { asUser } from '@cms/platform'
import { PageContent } from '@cms/schema'
import { sectionAppearanceSupport } from '@cms/renderer'
import { currentSession } from '../../../../lib/session.ts'
import { readPageRecipes } from '../../../../lib/page-recipes.ts'
import { readRecipeTargets } from '../../../../lib/recipe-targets.ts'
import type { RecipeBindings } from '../../../../lib/recipe-reuse-model.ts'
import type { LibraryEntry } from '../../../../lib/queries.ts'

export async function loadRecipePicker(siteId: string) {
  const session = await currentSession()
  if (!session) return null
  const targets = await readRecipeTargets(session.principal.userId, siteId)
  if (!targets[0]) return null
  const { recipes, names } = await readPageRecipes(session.principal.userId, siteId)
  const offered = recipes.filter(recipe => !recipe.retired_at)
  // Only the layouts the offered recipes use, so a card can name its sections.
  const used = new Set(offered.flatMap(recipe => recipe.content.map(section => section.section_def_id)))
  return {
    recipes: offered,
    target: targets[0],
    names: Object.fromEntries(Object.entries(names).filter(([id]) => used.has(id))),
  }
}

export async function prepareRecipeInsertion(
  siteId: string,
  recipeId: string,
  revision: string,
  bindings: RecipeBindings,
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in before inserting a template.' }
  try {
    return await asUser({ userId: session.principal.userId }, async client => {
      const raw = (
        await client.query<{ content: unknown }>('SELECT app.prepare_page_recipe($1,$2,$3,$4) AS content', [
          recipeId,
          revision,
          siteId,
          JSON.stringify(bindings),
        ])
      ).rows[0]!.content
      const content = PageContent.parse(raw)
      const definitions = (
        await client.query<LibraryEntry & { css: string; structured_doc: unknown }>(
          `
        SELECT DISTINCT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,d.placement,
          v.version,v.slots,v.thumbnail_path,v.definition_kind,v.carries_trusted_code,v.compiled_css AS css,v.structured_doc,
          0::int AS used_on_pages,0::int AS used_on_sites FROM jsonb_array_elements($1::jsonb) section
          JOIN section_defs d ON d.id=(section->>'section_def_id')::uuid
          JOIN section_def_versions v ON v.section_def_id=d.id AND v.version=(section->>'section_def_version')::int`,
          [JSON.stringify(content)],
        )
      ).rows.map(({ css, structured_doc, ...definition }) => ({
        ...definition,
        appearance_support: sectionAppearanceSupport({ ...definition, css, structured_doc }),
      }))
      return { ok: true as const, content, definitions }
    })
  } catch (error) {
    const code = (error as { code?: string }).code
    return {
      ok: false as const,
      message:
        code === 'CMS04'
          ? (error as Error).message
          : code === 'CMS01'
            ? 'This template changed. Close and reopen the picker before inserting it.'
            : 'That template is not available for this site.',
    }
  }
}
