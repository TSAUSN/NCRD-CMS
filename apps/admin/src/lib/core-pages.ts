import type { Queryable } from '@cms/platform'
import { coreTemplateContent, type CorePageDefinition } from '@cms/seeds/core-templates'
export async function corePageContent(
  client: Queryable,
  template: string,
  title: string,
  intro?: string,
  body?: string,
) {
  return coreTemplateContent(template, await corePageDefinitions(client), title, intro, body)
}
export async function corePageDefinitions(client: Queryable): Promise<CorePageDefinition[]> {
  return (
    await client.query<CorePageDefinition>(`SELECT d.id,d.slug,d.name,v.version,v.slots FROM section_defs d
    JOIN LATERAL (SELECT version,slots FROM section_def_versions WHERE section_def_id=d.id ORDER BY version DESC LIMIT 1) v ON true
    WHERE d.scope='global' AND d.status='active' AND d.slug LIKE 'core-%'`)
  ).rows
}
