import 'server-only'
import { asUser } from '@cms/platform'

export type FrameLibraryEntry = {
  id: string
  name: string
  slug: string
  placement: 'header' | 'footer'
  scope: 'global' | 'site'
  status: 'active' | 'hidden' | 'retired'
  version: number
  usedOnSites: number
}

/** Technical library, including retired definitions, only for super admins. */
export function listFrameLibrary(userId: string, siteId: string): Promise<FrameLibraryEntry[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<FrameLibraryEntry>(
          `
    SELECT d.id, d.name, d.slug, d.placement, d.scope, d.status, max(v.version) AS version,
      (SELECT count(DISTINCT g.site_id)::int FROM global_elements g
        JOIN global_element_versions gv ON gv.id IN (g.draft_version_id, g.published_version_id)
        WHERE gv.content->'component'->>'section_def_id' = d.id::text) AS "usedOnSites"
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
    WHERE app.is_super_admin() AND d.placement IN ('header','footer')
      AND (d.scope='global' OR d.site_id=$1)
    GROUP BY d.id ORDER BY d.status='retired', d.name
  `,
          [siteId],
        )
      ).rows,
  )
}
