import 'server-only'
import { asUser } from '@cms/platform'
import { LINK_TARGETS_SQL } from '../../lib/link-targets.ts'
import { PAGE_HISTORY_SQL, PAGE_HISTORY_VERSION_SQL } from '../../lib/page-history.ts'
import { UUID_SHAPE } from './record-id.ts'

export type PageRow = {
  id: string
  slug: string
  title: string
  status: string
  revision: string
  draft_version_id: string | null
  published_version_id: string | null
  live_path: string | null
  archived_at: Date | null
}

export type LinkTarget = { id: string; title: string; path: string; anchors?: { id: string; label: string }[] }

export type DraftRow = {
  version_id: string
  revision: string
  content: unknown
  meta: Record<string, string>
  page_title: string
  page_slug: string
  carries_trusted_code: boolean
  trusted_code_approved_by: string | null
}

export type PageHistoryRow = {
  id: string
  revision: string
  kind: string
  note: string
  created_at: Date
  authored_by_me: boolean
  is_current_draft: boolean
  is_live_now: boolean
  was_published: boolean
  was_restored: boolean
}

export function listPages(userId: string, siteId: string): Promise<PageRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow>(
          `SELECT p.id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,
              (SELECT route.path FROM published_routes route
                WHERE route.page_id = p.id ORDER BY route.updated_at DESC LIMIT 1) AS live_path
         FROM pages p WHERE p.site_id = $1 AND p.archived_at IS NULL
        -- A planned order wins; among pages without one the home page leads,
        -- as in V1's site workspace (reference 02).
        ORDER BY p.sort_index, p.slug <> '', p.title`,
          [siteId],
        )
      ).rows,
  )
}

export function listArchivedPages(userId: string, siteId: string): Promise<PageRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow>(
          `SELECT p.id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,
              NULL::text AS live_path
         FROM pages p WHERE p.site_id = $1 AND p.archived_at IS NOT NULL
        ORDER BY p.archived_at DESC, p.title`,
          [siteId],
        )
      ).rows,
  )
}

/** Published pages this reader may safely choose as same-site link targets. */
export function listLinkTargets(userId: string, siteId: string): Promise<LinkTarget[]> {
  return asUser({ userId }, async client => (await client.query<LinkTarget>(LINK_TARGETS_SQL, [siteId])).rows)
}

export function getPage(
  userId: string,
  pageId: string,
): Promise<(PageRow & { site_id: string; is_chapter_page?: boolean }) | null> {
  if (!UUID_SHAPE.test(pageId)) return Promise.resolve(null)
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PageRow & { site_id: string }>(
          `SELECT p.id, p.site_id, p.slug, p.title, p.status, p.revision,
              p.draft_version_id, p.published_version_id, p.archived_at,app.is_chapter_page(p.id) AS is_chapter_page,
              (SELECT route.path FROM published_routes route
                WHERE route.page_id = p.id ORDER BY route.updated_at DESC LIMIT 1) AS live_path
         FROM pages p WHERE p.id = $1 AND p.archived_at IS NULL`,
          [pageId],
        )
      ).rows[0] ?? null,
  )
}

export async function listPageHistory(
  userId: string,
  pageId: string,
  options?: {
    includeAutosaves?: boolean
    beforeRevision?: string | null
    limit?: number
  },
): Promise<{ items: PageHistoryRow[]; nextBefore: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100)
  return asUser({ userId }, async client => {
    const { rows } = await client.query<PageHistoryRow>(PAGE_HISTORY_SQL, [
      pageId,
      options?.includeAutosaves === true,
      options?.beforeRevision ?? null,
      limit + 1,
    ])
    const items = rows.slice(0, limit)
    return {
      items,
      nextBefore: rows.length > limit ? items.at(-1)!.revision : null,
    }
  })
}

export function getPageHistoryVersion(
  userId: string,
  pageId: string,
  versionId: string,
): Promise<PageHistoryRow | null> {
  return asUser(
    { userId },
    async client => (await client.query<PageHistoryRow>(PAGE_HISTORY_VERSION_SQL, [pageId, versionId])).rows[0] ?? null,
  )
}

export function getDraft(userId: string, versionId: string): Promise<DraftRow | null> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<DraftRow>(
          `SELECT id AS version_id, revision, content, meta, page_title, page_slug, carries_trusted_code, trusted_code_approved_by
         FROM page_versions WHERE id = $1`,
          [versionId],
        )
      ).rows[0] ?? null,
  )
}
