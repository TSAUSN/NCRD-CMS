import 'server-only'
import { asUser } from '@cms/platform'
import { withDraftListPreview } from '../../lib/draft-list-preview.ts'
import { readSitePreview, type SitePreview } from '../../lib/site-preview.ts'
import type { SitePreviewContext } from '../../lib/preview-context.ts'
import type { RenderManifest, SiteShell } from '@cms/renderer'
import { siteImagePreviews } from '../../lib/site-image-previews.ts'
import { SiteFileBundle } from '@cms/schema'

export function getSiteImagePreviews(
  userId: string,
  siteId: string,
  context: 'draft' | 'published' = 'draft',
): Promise<Record<string, string>> {
  return asUser({ userId }, async client => {
    const pointer = context === 'draft' ? 'draft_version_id' : 'published_version_id'
    const head = (
      await client.query<{ versionId: string; bundle: unknown }>(
        `SELECT v.id AS "versionId",v.bundle FROM site_file_heads h JOIN site_file_versions v ON v.id=h.${pointer} WHERE h.site_id=$1`,
        [siteId],
      )
    ).rows[0]
    const parsed = SiteFileBundle.safeParse(head?.bundle)
    if (!head || !parsed.success) return {}
    const files = (
      await client.query(
        'SELECT id,kind,name,source,bytes::integer,sha256 FROM site_files WHERE site_id=$1 AND id=ANY($2::uuid[])',
        [siteId, parsed.data.files],
      )
    ).rows
    return siteImagePreviews({ ...head, files })
  })
}

/**
 * The preview manifest comes from the same SQL builder the publish command
 * uses, so preview cannot drift from what publishing would produce — the
 * byte-identity problem v1 solved with sync scripts (SPEC §3.3).
 */
export function buildPreview(
  userId: string,
  versionId: string,
  siteId: string,
  siteDrafts?: boolean,
  draftLists = false,
): Promise<{
  manifest: RenderManifest
  shell: SiteShell
  navigationPaths: Record<string, string>
} | null> {
  return asUser({ userId }, async client => {
    const manifest = await client.query<{ manifest: RenderManifest }>(
      'SELECT app.build_initial_preview_manifest(id) AS manifest FROM page_versions WHERE id=$1 AND site_id=$2',
      [versionId, siteId],
    )
    if (!manifest.rows[0]) return null
    const preview = await readSitePreview(
      client,
      siteId,
      siteDrafts === undefined ? undefined : siteDrafts ? 'draft' : 'published',
    )
    if (!preview) return null
    const page = manifest.rows[0].manifest.page
    return {
      manifest: draftLists
        ? await withDraftListPreview(client, manifest.rows[0].manifest, versionId, siteId)
        : manifest.rows[0].manifest,
      ...preview,
      navigationPaths: { ...preview.navigationPaths, [page.id]: page.path },
    }
  })
}

/** Private preview composition shared with the page canvas. */
export function getSiteShell(
  userId: string,
  siteId: string,
  context: SitePreviewContext = 'published',
): Promise<SitePreview | null> {
  return asUser({ userId }, client => readSitePreview(client, siteId, context))
}
