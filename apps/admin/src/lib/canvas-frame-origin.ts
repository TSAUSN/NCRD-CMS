const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const PAGE = new RegExp(`^/pages/(${ID})/?$`, 'i')
const SITE_FONTS = new RegExp(`^/sites/(${ID})/design/fonts/?$`, 'i')
const SITE_HEADER = new RegExp(`^/sites/(${ID})/(?:header|footer)/?$`, 'i')
const SITE_LOOK = new RegExp(`^/sites/(${ID})/design/?$`, 'i')
/** Only authenticated editor/site-look routes may frame their own site's
 * isolated canvas. All actual content/resource access still uses its ticket. */
export async function canvasFrameOrigin(
  path: string,
  deps: {
    user: () => Promise<string | null>
    hostname: (user: string, id: string, kind: 'page' | 'site' | 'fonts') => Promise<string | null>
    origin: (hostname: string) => string | null
  },
): Promise<string | null> {
  const page = PAGE.exec(path),
    site = SITE_LOOK.exec(path),
    fonts = SITE_FONTS.exec(path) ?? SITE_HEADER.exec(path)
  if (!page && !site && !fonts) return null
  try {
    const user = await deps.user()
    if (!user) return null
    const hostname = await deps.hostname(user, (page ?? site ?? fonts)![1]!, page ? 'page' : fonts ? 'fonts' : 'site')
    return hostname ? deps.origin(hostname) : null
  } catch {
    return null
  }
}
