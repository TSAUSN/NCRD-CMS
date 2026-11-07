import { canvasRoute } from './canvas-route.ts'

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
  const route = canvasRoute(path)
  if (!route) return null
  try {
    const user = await deps.user()
    if (!user) return null
    const hostname = await deps.hostname(user, route.id, route.kind)
    return hostname ? deps.origin(hostname) : null
  } catch {
    return null
  }
}
