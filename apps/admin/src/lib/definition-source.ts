import 'server-only'
import { asUser } from '@cms/platform'
import type { StructuredDocument } from '@cms/schema'

export type DefinitionSource = {
  id: string
  slug: string
  name: string
  category: string
  scope: 'global' | 'site'
  siteId: string | null
  placement: 'page' | 'header' | 'footer'
  version: number
  kind: 'legacy' | 'structured'
  sourceHtml: string
  sourceCss: string
  slots: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }[]
  structuredDoc: StructuredDocument | null
  changelog: string
  cssPolicyVersion: number | null
}

export function getDefinitionSource(
  userId: string,
  siteId: string,
  definitionId: string,
): Promise<DefinitionSource | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(definitionId))
    return Promise.resolve(null)
  return asUser(
    { userId },
    async client =>
      (
        await client.query<DefinitionSource>(
          `
    SELECT d.id,d.slug,d.name,d.category,d.scope,d.placement,d.site_id AS "siteId",v.version,v.definition_kind AS kind,
      v.source_html AS "sourceHtml",v.source_css AS "sourceCss",v.slots,v.structured_doc AS "structuredDoc",
      v.changelog,v.css_policy_version AS "cssPolicyVersion"
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
    WHERE d.id=$1 AND d.status='active' AND (d.scope='global' OR d.site_id=$2)
    ORDER BY v.version DESC LIMIT 1
  `,
          [definitionId, siteId],
        )
      ).rows[0] ?? null,
  )
}

/** Immutable version history under the reader's normal RLS policy. */
export function listDefinitionVersions(
  userId: string,
  siteId: string,
  definitionId: string,
): Promise<{ version: number; changelog: string; createdAt: string }[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(definitionId)) return Promise.resolve([])
  return asUser(
    { userId },
    async client =>
      (
        await client.query<{ version: number; changelog: string; createdAt: string }>(
          `
  SELECT v.version,v.changelog,v.created_at::text AS "createdAt"
  FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
  WHERE d.id=$1 AND d.status='active' AND (d.scope='global' OR d.site_id=$2)
  ORDER BY v.version DESC`,
          [definitionId, siteId],
        )
      ).rows,
  )
}
