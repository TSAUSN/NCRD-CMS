export function contentCounts(pages: number, stories = 0): string {
  return (
    `${pages} ${pages === 1 ? 'page' : 'pages'}` +
    (stories ? ` · ${stories} ${stories === 1 ? 'story' : 'stories'}` : '')
  )
}

/** Frame destinations include story pages; describe them with the same totals as Home. */
export function contentCountsForPages(pages: readonly { kind?: string }[]): string {
  const stories = pages.filter(page => page.kind === 'story').length
  return contentCounts(pages.length - stories, stories)
}
