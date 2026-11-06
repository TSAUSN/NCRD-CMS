// Event registration calls to action, decided when the page is rendered.
//
// V1 Echelon shipped every registration link with a `registration-unavailable`
// fail-safe class (`display: none`) and a script that removed it on the public
// site only when the link went somewhere real (src/event-readiness.js): the
// "#register" placeholder is navigation, not registration. Status notes marked
// `data-registration-status` (“Registration details coming soon”) hid once any
// link was real. V2 pages carry no scripts, so the same rule runs here, on the
// rendered page, identically for previews and the public site. It only adds or
// removes that one class token; no stored value becomes markup.

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const TOKEN = 'registration-unavailable'

const hasAttribute = (attributes: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, 'i').test(attributes)
const attributeValue = (attributes: string, name: string) => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i').exec(attributes)
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null
}
const decode = (value: string) =>
  value.replace(
    /&(amp|quot|#39|lt|gt|#x27|#35);/g,
    (_, entity: string) =>
      ({ amp: '&', quot: '"', '#39': "'", lt: '<', gt: '>', '#x27': "'", '#35': '#' })[entity] ?? '',
  )

/** A destination that registers somebody: present, not an in-page anchor, and http(s). */
export function isRealRegistrationUrl(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim()
  // Shared-frame links normalize to /#register during import. They remain
  // placeholder navigation and must not activate registration accidentally.
  if (!raw || raw.startsWith('#') || /^\/(?:\?[^#]*)?#/.test(raw)) return false
  try {
    const url = new URL(raw, 'https://example.invalid/')
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Add or remove the fail-safe class token without touching the rest of the tag. */
function withToken(attributes: string, present: boolean): string {
  const quoted = /(\sclass\s*=\s*)(?:"([^"]*)"|'([^']*)')/i.exec(attributes)
  if (!quoted) return present ? `${attributes} class="${TOKEN}"` : attributes
  const value = quoted[2] ?? quoted[3] ?? ''
  const has = new RegExp(`(^|\\s)${TOKEN}(?=\\s|$)`).test(value)
  if (has === present) return attributes
  const next = present
    ? `${value}${value.trim() ? ' ' : ''}${TOKEN}`
    : value.replace(new RegExp(`(^|\\s+)${TOKEN}(?=\\s|$)`, 'g'), '').trim()
  const quote = quoted[2] !== undefined ? '"' : "'"
  return (
    attributes.slice(0, quoted.index) +
    `${quoted[1]}${quote}${next}${quote}` +
    attributes.slice(quoted.index + quoted[0].length)
  )
}

export function applyRegistrationAvailability(html: string): string {
  if (!html.includes('data-registration-')) return html
  let available = false
  const links = html.replace(START_TAG, (tag, name: string, attributes: string) => {
    if (name.toLowerCase() !== 'a' || !hasAttribute(attributes, 'data-registration-cta')) return tag
    const real = isRealRegistrationUrl(decode(attributeValue(attributes, 'href') ?? ''))
    available ||= real
    const next = withToken(attributes, !real)
    return next === attributes ? tag : `<${name}${next}>`
  })
  return links.replace(START_TAG, (tag, name: string, attributes: string) => {
    if (!hasAttribute(attributes, 'data-registration-status')) return tag
    const next = withToken(attributes, available)
    return next === attributes ? tag : `<${name}${next}>`
  })
}
