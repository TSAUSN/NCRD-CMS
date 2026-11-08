const host = 'sawso.org'
const path = '/sawso/story/symphony/json'

export const SAWSO_STORIES_FEED = `https://${host}${path}?start=0&limit=999`

/** Keep the designated story feed out of number-file imports, including redirects. */
export function isStorySourceEndpoint(url: URL): boolean {
  const hostname = url.hostname.replace(/\.+$/, '').toLowerCase()
  if (hostname !== host && !hostname.endsWith('.' + host)) return false
  const pathname = decodeURIComponent(url.pathname).toLowerCase()
  return pathname === path || pathname.startsWith(path + '/')
}
