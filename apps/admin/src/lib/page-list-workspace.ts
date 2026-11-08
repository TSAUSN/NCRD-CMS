import 'server-only'
import { asUser, type Queryable } from '@cms/platform'
import { FooterConfig, NavTree } from '@cms/schema'
import { footerPageMembership } from './page-list-links.ts'
import { isOrdinaryPage } from './ordinary-page.ts'
export type PageListControls = {
  headerRevision: number
  footerRevision: number
  menuRevision: number
  menu: NavTree
  inFooter: Record<string, boolean | null>
  order: string[]
  orderToken: string
  stories: { id: string; title: string; path: string }[]
}
export async function readPageListControls(client: Queryable, siteId: string): Promise<PageListControls> {
  const heads = (
      await client.query(
        'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1',
        [siteId],
      )
    ).rows,
    header = heads.find(row => row.kind === 'header'),
    footer = heads.find(row => row.kind === 'footer'),
    nav = (
      await client.query(
        'SELECT n.revision,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
        [siteId],
      )
    ).rows[0]
  if (!header || !footer || !nav) throw Error('The page links are unavailable. Reload, or open Header & menu.')
  const stories = (
    await client.query<{ id: string; title: string; path: string }>(
      "SELECT e.id,v.values->>'title' AS title,v.values->>'story_url' AS path FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE c.site_id=$1 AND c.reader_key='stories' AND e.archived_at IS NULL ORDER BY e.sort_index,e.id",
      [siteId],
    )
  ).rows
  const pages = (
    await client.query<{ id: string; title: string; slug: string; sort_index: number }>(
      "SELECT id,title,slug,sort_index FROM pages WHERE site_id=$1 AND archived_at IS NULL ORDER BY sort_index,slug<>'',title,id",
      [siteId],
    )
  ).rows
  const storyPaths = new Set(stories.map(story => story.path))
  const normal = pages.filter(page => isOrdinaryPage(page.slug, storyPaths))
  const config = FooterConfig.parse(footer.content)
  return {
    headerRevision: Number(header.revision),
    footerRevision: Number(footer.revision),
    menuRevision: Number(nav.revision),
    menu: NavTree.parse(nav.tree),
    inFooter: Object.fromEntries(normal.map(page => [page.id, footerPageMembership(config, page)])),
    order: normal.map(page => page.id),
    orderToken: JSON.stringify(normal.map(page => [page.id, page.sort_index])),
    stories,
  }
}
export function getPageListControls(userId: string, siteId: string) {
  return asUser({ userId }, client => readPageListControls(client, siteId))
}
