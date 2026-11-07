import { echelonSiteMedia, echelonSectionStartingValues } from '../../lib/echelon-media.ts'
import 'server-only'
import { supportsImageFocus } from '../../lib/image-focus-support.ts'
import { asUser } from '@cms/platform'
import { CURRENT_SECTION_USES_SQL, SECTION_USAGE_SQL, type SectionUsageRow } from '../../lib/section-usage.ts'
import { sectionAppearanceSupport, type AppearanceSupport } from '@cms/renderer'
import { UUID_SHAPE } from './record-id.ts'

export type LibraryEntry = {
  starting_values?: Record<string, unknown>
  section_def_id: string
  slug: string
  name: string
  category: string
  version: number
  slots: { id: string; kind: string; label: string; constraints?: Record<string, unknown> }[]
  /** Where a pre-rendered thumbnail lives, or null while one has not been made. */
  thumbnail_path: string | null
  /** `structured` or `legacy`; the editor tells an author which model it is. */
  definition_kind: string
  /** Adding this needs a super admin's approval before the page can go live. */
  carries_trusted_code: boolean
  /** How many pages, across how many sites, already use this definition. */
  used_on_pages: number
  used_on_sites: number
  scope: 'global' | 'site'
  site_id: string | null
  /** page, header or footer (ADR 0010). Only page definitions are inserted into pages. */
  placement?: 'page' | 'header' | 'footer'
  image_focus_supported?: boolean
  appearance_support?: AppearanceSupport
  is_favourite?: boolean
}

type AppearanceLibraryRow = LibraryEntry & { css?: string; structured_doc?: unknown; compiled_ast?: unknown }

function withAppearanceSupport({ css, structured_doc, compiled_ast, ...row }: AppearanceLibraryRow): LibraryEntry {
  return {
    ...row,
    image_focus_supported: supportsImageFocus(row.definition_kind, compiled_ast),
    appearance_support: sectionAppearanceSupport({ ...row, css, structured_doc }),
  }
}

/**
 * The section library, each definition at its newest version, with the two facts
 * a card needs beyond its name.
 *
 * **Usage counts are counts of what this reader can see.** They come out of a
 * query running as the reader's own database role, so RLS has already removed
 * every site they are not a member of. That makes "Used on 14 pages across 3
 * sites" true for the person reading it and *not* a global figure — which is the
 * honest version, since a contributor being told a definition is used on a site
 * they cannot open is being told about a page they cannot go and check. The
 * copy beside the number says so rather than leaving it to be inferred.
 *
 * Count distinct pages across their current draft and published versions. This
 * includes an addition waiting to publish and a removal still present live;
 * historical-only placements and archived pages do not inflate the count.
 */
export function listSectionLibrary(userId: string, siteId: string): Promise<LibraryEntry[]> {
  return asUser({ userId }, async client => {
    const rows = (
      await client.query<AppearanceLibraryRow>(
        `WITH newest AS (
         SELECT DISTINCT ON (d.id)
                d.id AS section_def_id, d.slug, d.name, d.category, d.scope, d.site_id, d.placement,
                v.version, v.slots, v.thumbnail_path, v.definition_kind, v.carries_trusted_code,
                v.compiled_css AS css, v.structured_doc, v.compiled_ast
           FROM section_defs d
           JOIN section_def_versions v ON v.section_def_id = d.id
          WHERE d.status = 'active' AND (d.scope = 'global' OR d.site_id = $1)
          ORDER BY d.id, v.version DESC
       ),
       current_uses AS (${CURRENT_SECTION_USES_SQL}),
       usage AS (
         SELECT section_def_id,
                count(DISTINCT page_id) AS used_on_pages,
                count(DISTINCT site_id) AS used_on_sites
           FROM current_uses
          GROUP BY 1
       )
       SELECT newest.*,
              EXISTS(SELECT 1 FROM section_favourites f WHERE f.site_id=$1
                AND f.section_def_id=newest.section_def_id) AS is_favourite,
              COALESCE(usage.used_on_pages, 0)::int AS used_on_pages,
              COALESCE(usage.used_on_sites, 0)::int AS used_on_sites
         FROM newest
         LEFT JOIN usage ON usage.section_def_id = newest.section_def_id::text
        ORDER BY newest.category, newest.name`,
        [siteId],
      )
    ).rows.map(withAppearanceSupport)
    const media = await echelonSiteMedia(client, siteId)
    return media
      ? rows.map(entry => ({ ...entry, starting_values: echelonSectionStartingValues(entry.slots, media, entry.slug) }))
      : rows
  })
}

export function listSectionUsage(userId: string, definitionId: string, after?: string) {
  if (!UUID_SHAPE.test(definitionId) || (after && !UUID_SHAPE.test(after)))
    return Promise.resolve({ rows: [] as SectionUsageRow[], next: null as string | null })
  return asUser({ userId }, async client => {
    const { rows } = await client.query<SectionUsageRow>(SECTION_USAGE_SQL, [definitionId, after ?? null])
    return { rows: rows.slice(0, 50), next: rows.length > 50 ? rows[49]!.page_id : null }
  })
}

/** Exact definitions pinned by this page, including versions no longer offered
 * in the insertion library. A newer template must not change an old inspector. */
export function listPageSectionVersions(userId: string, pageId: string): Promise<LibraryEntry[]> {
  return asUser({ userId }, async client =>
    (
      await client.query<AppearanceLibraryRow>(
        `
    SELECT DISTINCT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,
      v.version,v.slots,v.thumbnail_path,v.definition_kind,v.carries_trusted_code,v.compiled_css AS css,v.structured_doc,v.compiled_ast,
      0::int AS used_on_pages,0::int AS used_on_sites
    FROM pages p JOIN page_versions pv ON pv.id IN (p.draft_version_id,p.published_version_id)
    CROSS JOIN LATERAL jsonb_array_elements(pv.content) section
    JOIN section_defs d ON d.id=(section->>'section_def_id')::uuid
    JOIN section_def_versions v ON v.section_def_id=d.id AND v.version=(section->>'section_def_version')::int
    WHERE p.id=$1
  `,
        [pageId],
      )
    ).rows.map(withAppearanceSupport),
  )
}
