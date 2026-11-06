/** One XML representation for the public sitemap and authenticated previews. */
export function sitemapXml(origin: string, routes: readonly { path: string; updatedAt: Date | string }[]): string {
  const base = new URL(origin)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Use a site origin for the sitemap.')
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return (
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    routes
      .map(route => {
        if (!route.path.startsWith('/') || route.path.startsWith('//') || /[\\\u0000-\u001f]/.test(route.path))
          throw new Error('Use a local page path for the sitemap.')
        return (
          '<url><loc>' +
          escape(base.origin + route.path) +
          '</loc><lastmod>' +
          new Date(route.updatedAt).toISOString() +
          '</lastmod></url>'
        )
      })
      .join('') +
    '</urlset>'
  )
}
