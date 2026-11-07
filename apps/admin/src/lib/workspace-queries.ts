import 'server-only'
import { releasePresentations } from './release-presentation.ts'
import { asUser } from '@cms/platform'
import { NavTree } from '@cms/schema'
import { pageInMenu } from './page-details.ts'
import type { PageRow } from './queries.ts'
export type WorkspacePage = PageRow & {
  site_id: string
  site_name: string
  parent_page_id: string | null
  in_menu: boolean
  edited_at: string
  edited_by: string
  live_samples: boolean
  no_visible_changes?: boolean
}
export const WORKSPACE_PAGES_SQL = `SELECT p.id,p.site_id,s.name AS site_name,p.slug,p.title,p.status,p.revision,p.parent_page_id,
 p.draft_version_id,p.published_version_id,p.archived_at,
 (SELECT path FROM published_routes WHERE page_id=p.id ORDER BY updated_at DESC LIMIT 1) AS live_path,
 COALESCE(v.created_at,p.created_at)::text AS edited_at,
 CASE WHEN v.author_id=app.current_user_id() THEN 'You' ELSE 'Another editor' END AS edited_by,
 COALESCE(jsonb_path_exists(live.content, '$[*].values.__cms_sample_fields[*]'),false) AS live_samples,
 CASE WHEN row_number() OVER(PARTITION BY p.site_id ORDER BY p.id)=1 THEN
   COALESCE((SELECT nv.tree FROM navigations n JOIN navigation_versions nv ON nv.id=n.draft_version_id WHERE n.site_id=p.site_id),'[]'::jsonb) END AS menu_tree
 FROM pages p JOIN sites s ON s.id=p.site_id LEFT JOIN page_versions v ON v.id=p.draft_version_id
 LEFT JOIN page_versions live ON live.id=p.published_version_id
 WHERE p.archived_at IS NULL AND s.status<>'archived' AND ($1::uuid IS NULL OR p.site_id=$1)
 ORDER BY p.sort_index,p.slug<>'',p.title`
export async function listWorkspacePages(userId: string, siteId: string | null = null): Promise<WorkspacePage[]> {
  const pages = await asUser({ userId }, async client => {
    const { rows } = await client.query<Omit<WorkspacePage, 'in_menu'> & { menu_tree: unknown }>(WORKSPACE_PAGES_SQL, [
      siteId,
    ])
    // The query sends each visible site's draft menu once, in the same read
    // snapshot as its pages. Parse it once even when a site has many pages.
    const menus = new Map<string, ReturnType<typeof NavTree.parse>>()
    for (const row of rows) {
      if (row.menu_tree !== null) menus.set(row.site_id, NavTree.parse(row.menu_tree))
    }
    return rows.map(({ menu_tree: _menu, ...row }) => ({
      ...row,
      edited_at: new Date(row.edited_at).toISOString(),
      in_menu: pageInMenu(menus.get(row.site_id)!, row.id),
    }))
  })
  const sites = [
    ...new Set(
      pages
        .filter(
          page =>
            page.published_version_id && page.draft_version_id && page.draft_version_id !== page.published_version_id,
        )
        .map(page => page.site_id),
    ),
  ]
  await Promise.all(
    sites.map(async id => {
      const changed = pages.filter(
        page =>
          page.site_id === id &&
          page.published_version_id &&
          page.draft_version_id &&
          page.draft_version_id !== page.published_version_id,
      )
      const summaries = await releasePresentations(
        userId,
        id,
        changed.map(page => ({
          key: 'page:' + page.id,
          type: 'page',
          id: page.id,
          label: page.title,
          revision: page.revision,
          versionId: page.draft_version_id!,
        })),
      )
      for (const page of changed) page.no_visible_changes = summaries['page:' + page.id]?.noVisibleChanges === true
    }),
  )
  return pages
}
