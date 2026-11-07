const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const PAGE = new RegExp(`^/pages/(${ID})/?$`, 'i')
const SITE_FONTS = new RegExp(`^/sites/(${ID})/design/fonts/?$`, 'i')
const SITE_HEADER = new RegExp(`^/sites/(${ID})/(?:header|footer)/?$`, 'i')
const SITE_LOOK = new RegExp(`^/sites/(${ID})/design/?$`, 'i')

// Same route table for document navigation and the server's frame policy.
export function canvasRoute(path: string): { id: string; kind: 'page' | 'site' | 'fonts' } | null {
  const page = PAGE.exec(path)
  if (page) return { id: page[1]!, kind: 'page' }
  const site = SITE_LOOK.exec(path)
  if (site) return { id: site[1]!, kind: 'site' }
  const fonts = SITE_FONTS.exec(path) ?? SITE_HEADER.exec(path)
  return fonts ? { id: fonts[1]!, kind: 'fonts' } : null
}
