import 'server-only'
import { asUser } from '@cms/platform'
import { NavTree, type NavTree as NavigationTree } from '@cms/schema'

export type NavigationPage = {
  id: string
  title: string
  path: string
  published: boolean
}

export type NavigationWorkspace = {
  id: string
  revision: number
  mode: 'auto' | 'manual'
  draftVersionId: string
  publishedVersionId: string | null
  draft: NavigationTree
  published: NavigationTree
  pages: NavigationPage[]
}

/**
 * One read model for the navigation screen: the editable draft, what visitors
 * currently get, and the pages a menu item may point at. Both trees are parsed
 * at the server boundary. A corrupt stored artifact therefore fails visibly
 * instead of becoming an empty menu that an author might accidentally publish.
 */
export function getNavigationWorkspace(userId: string, siteId: string): Promise<NavigationWorkspace | null> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{
      id: string
      revision: string
      mode: 'auto' | 'manual'
      draft_version_id: string
      published_version_id: string | null
      draft: unknown
      published: unknown
    }>(
      `SELECT n.id, n.revision, n.mode, n.draft_version_id, n.published_version_id,
              draft.tree AS draft, live.tree AS published
         FROM navigations n
         JOIN navigation_versions draft ON draft.id = n.draft_version_id
         LEFT JOIN navigation_versions live ON live.id = n.published_version_id
        WHERE n.site_id = $1`,
      [siteId],
    )
    const head = rows[0]
    if (!head) return null
    const pages = await client.query<{
      id: string
      title: string
      slug: string
      published: boolean
    }>(
      `SELECT id, title, slug, published_version_id IS NOT NULL AS published
         FROM pages WHERE site_id = $1 AND archived_at IS NULL
        ORDER BY sort_index, slug <> '', title`,
      [siteId],
    )
    return {
      id: head.id,
      revision: Number(head.revision),
      mode: head.mode,
      draftVersionId: head.draft_version_id,
      publishedVersionId: head.published_version_id,
      draft: NavTree.parse(head.draft),
      published: NavTree.parse(head.published ?? []),
      pages: pages.rows.map(page => ({
        id: page.id,
        title: page.title,
        path: page.slug ? `/${page.slug}` : '/',
        published: page.published,
      })),
    }
  })
}

/** The same capability predicate the navigation commands enforce. */
export function canManageNavigation(userId: string, siteId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client =>
      (await client.query<{ allowed: boolean }>('SELECT app.can_publish($1) AS allowed', [siteId])).rows[0]?.allowed ===
      true,
  )
}
