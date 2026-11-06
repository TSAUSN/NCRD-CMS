/** Fixed approved CSS kit. No arbitrary stylesheet or font origins are accepted. */
export const ADOBE_KIT_URL = 'https://use.typekit.net/euh2hvn.css'
export const ADOBE_STYLE_ORIGINS = ['https://use.typekit.net', 'https://p.typekit.net'] as const
export function adobeFontsEnabled(theme: unknown, host: unknown): boolean {
  if (!theme || typeof theme !== 'object' || typeof host !== 'string') return false
  const fonts = (theme as { fonts?: { adobeKit?: unknown } }).fonts,
    kit = fonts?.adobeKit as { id?: unknown; enabled?: unknown; domains?: unknown } | undefined
  if (kit?.id !== 'euh2hvn' || kit.enabled !== true || !Array.isArray(kit.domains) || kit.domains.length > 10)
    return false
  const match = /^([a-z0-9.-]+)(?::[0-9]{1,5})?$/.exec(host.toLowerCase())
  if (!match) return false
  const hostname = match[1]!
  if (
    !hostname ||
    hostname.length > 253 ||
    !hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return false
  return kit.domains.some(domain => typeof domain === 'string' && domain === hostname)
}
export function adobeKitLink(theme: unknown, host: unknown): string {
  return adobeFontsEnabled(theme, host)
    ? `<link rel="stylesheet" href="${ADOBE_KIT_URL}" data-cms-adobe-kit="euh2hvn">`
    : ''
}
