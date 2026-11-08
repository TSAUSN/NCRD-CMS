/** Story routes are managed in Stories and kept out of the page-order draft. */
export function isOrdinaryPage(slug: string, storyPaths: ReadonlySet<string>): boolean {
  return !slug.startsWith('stories/') && !storyPaths.has('/' + slug)
}
