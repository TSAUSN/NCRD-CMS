import 'server-only'
import { asUser, type Queryable } from '@cms/platform'
import { dataValueBindings, siteDataValues, resolveDataValueFields } from '@cms/schema'
export async function dataValueUsage(client: Queryable, siteId: string) {
  const usage: Record<string, { id: string; title: string }[]> = {}
  const rows = (
    await client.query(
      'SELECT p.id,p.title,v.content FROM pages p JOIN page_versions v ON v.id IN(p.draft_version_id,p.published_version_id) WHERE p.site_id=$1 AND p.archived_at IS NULL',
      [siteId],
    )
  ).rows
  for (const row of rows)
    for (const section of row.content)
      for (const binding of Object.values(dataValueBindings(section.values ?? {})))
        for (const part of binding.parts)
          if ('valueId' in part) {
            const pages = (usage[part.valueId] ??= [])
            if (!pages.some(page => page.id === row.id)) pages.push({ id: row.id, title: row.title })
          }
  return usage
}
export function getDataValueUsage(userId: string, siteId: string) {
  return asUser({ userId }, client => dataValueUsage(client, siteId))
}
export function pageDataValues(userId: string, pageId: string) {
  return asUser({ userId }, async client =>
    siteDataValues({
      dataValues: (await client.query('SELECT app.page_data_values($1) AS numbers', [pageId])).rows[0]?.numbers,
    }),
  )
}

export function resolvedDataSections<
  T extends { section_def_id: string; section_def_version?: number; values: Record<string, unknown> },
>(
  content: T[],
  forms: Record<string, { slots: readonly { id: string; kind: string; constraints?: Record<string, unknown> }[] }>,
  settings: unknown,
): T[] {
  return content.map(section => ({
    ...section,
    values: resolveDataValueFields(
      section.values,
      settings,
      forms[section.section_def_id + ':' + section.section_def_version]?.slots ?? [],
    ),
  }))
}
