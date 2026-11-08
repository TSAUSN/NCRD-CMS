// The words for publishing a page together with what it needs to go live
// (publish-together.ts). Kept apart from the database code so the editor, which
// runs in the browser, can use them.

export type TogetherPage = { id: string; title: string; path: string }
/** What goes live with the page: other pages, the content lists they show, and
 * on a first publish the site-wide parts. */
export type PublishTogether = { siteId: string; pages: TogetherPage[]; siteWide: boolean; collections: boolean }

/** Whether the plan includes what only a site administrator may publish. */
export function needsAdministrator(plan: PublishTogether): boolean {
  return plan.siteWide || plan.collections
}

/** What an editor without administrator rights is told instead. */
export function administratorNeededMessage(plan: PublishTogether): string {
  if (plan.siteWide)
    return "This would be the site's first publish, which also puts its design, header, footer and menu live. A site administrator does that: ask one to publish this page, or the whole site from Publishing."
  const titles = plan.pages.map(page => page.title)
  const named = titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`
  return `This page links to ${named}, which ${titles.length === 1 ? 'shows a list' : 'show lists'} nobody has published yet. A site administrator publishes a list for the first time: ask one to publish ${titles.length === 1 ? 'it' : 'them'}, then publish this page.`
}

/** What the editor says, naming what goes live with the page. */
export function publishTogetherMessage(plan: PublishTogether): string {
  const titles = plan.pages.map(page => page.title)
  const named = titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`
  const lists = plan.collections ? ' The lists those pages show go live with them.' : ''
  if (plan.siteWide) {
    return titles.length
      ? `This is the site's first publish. Its design, header, footer and menu go live with this page, together with ${named}, so links in the page and shared navigation work.${lists}`
      : "This is the site's first publish, so its design, header, footer and menu go live with this page."
  }
  return `This page links to ${named}, which ${titles.length === 1 ? "isn't" : "aren't"} live yet. Publish ${titles.length === 1 ? 'both' : 'them'} together so visitors never meet a missing page.${lists}`
}

/** Review every affected page, including its samples, through the shared Publish workspace. */
export function publishTogetherReviewHref(pageId: string, plan: PublishTogether): string {
  const params = new URLSearchParams({ pages: [pageId, ...plan.pages.map(page => page.id)].join(',') })
  if (plan.siteWide) params.set('siteLook', '1')
  if (plan.collections) params.set('lists', '1')
  return `/sites/${plan.siteId}/publishing?${params}`
}
