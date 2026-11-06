/** Query parameters kept separately from a button's destination. Never accepts
 * a second address, credentials, fragments or script protocols. */
export function trackedLinkUrl(destination: string, tracking: unknown): string {
  if (typeof tracking !== 'string' || !tracking.trim()) return destination
  const query = tracking.trim().replace(/^\?/, '')
  if (
    query.length > 1000 ||
    /[#\\\s]/.test(query) ||
    !query.split('&').every(part => /^[A-Za-z][A-Za-z0-9_.-]{0,79}=[^&]*$/.test(part))
  )
    return destination
  if (!destination.startsWith('/') && !destination.startsWith('https://')) return destination
  try {
    const url = new URL(destination, 'https://cms.invalid')
    if (url.username || url.password || url.protocol !== 'https:') return destination
    for (const [key, value] of new URLSearchParams(query)) url.searchParams.set(key, value)
    return destination.startsWith('/') ? url.pathname + url.search + url.hash : url.href
  } catch {
    return destination
  }
}
export function validTrackingCode(value: string): boolean {
  return !value.trim() || trackedLinkUrl('/tracking-check', value) !== '/tracking-check'
}
