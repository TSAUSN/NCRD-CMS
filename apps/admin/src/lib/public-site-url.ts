import { normalizeHost } from '@cms/domain'

/** Local ports are a development setting, never part of a deployed site URL. */
export function publicSiteOrigin(
  hostname: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!hostname || normalizeHost(hostname) !== hostname) return null
  const local = env['NODE_ENV'] !== 'production' || env['CMS_LOCAL_TEST_MODE'] === 'true'
  const port = env['PUBLIC_SITE_PORT'] ?? (local ? '3001' : '')
  if (port !== '' && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error('PUBLIC_SITE_PORT must be a valid TCP port or empty')
  }
  return `${local ? 'http' : 'https'}://${hostname}${port ? `:${port}` : ''}`
}
