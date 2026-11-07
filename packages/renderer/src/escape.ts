// Sink-specific escaping. One function per sink, because "escape
// the value" is not one operation: what is safe in text is not safe in an
// attribute, and neither is safe in a URL position.

export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

const SAFE_URL_SCHEME = /^(https?:|mailto:|tel:)/i
// Control characters are stripped before the scheme test, because the URL
// parser strips them too: "java\nscript:alert(1)" is `javascript:` to a
// browser, and that is the classic way past a naive prefix check.
//
// Only the control range, though. Stripping U+0020 as well — which this did —
// deleted the spaces *inside* a value, and some of the attributes this policy
// is applied to are space-delimited lists rather than one URL. `srcset` and
// `ping` came out silently welded together, and `/a.png 1x, //evil.test/x 2x`
// became `/a.png1x,//evil.test/x2x`: one string starting with `/`, so the
// protocol-relative check waved it through and the browser then split it back
// into two candidates, one of them off-site. Internal spaces cannot invent a
// scheme — a space ends one — so they stay, and lists are handled as lists.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/**
 * A URL is only emitted if it is same-site-relative or uses a scheme that
 * cannot execute. `javascript:`, `data:`, and anything unrecognised become
 * '#', so a hostile stored value degrades to a dead link rather than a script.
 */
export function safeUrl(value: string): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, '').trim()
  if (cleaned === '') return '#'
  // The URL parser treats a backslash as a slash for every special scheme, so
  // `/\evil.test/x` and `\\evil.test/x` reach the same host `//evil.test/x`
  // does. The decision is made on a normalised copy and the original is what
  // ships, because normalising the emitted value would change a path that
  // legitimately contains a backslash.
  const authority = cleaned.replaceAll('\\', '/')
  if (authority.startsWith('//')) return '#' // protocol-relative: off-site by stealth
  if (authority.startsWith('/') || cleaned.startsWith('#') || cleaned.startsWith('?')) return cleaned
  if (!SAFE_URL_SCHEME.test(cleaned)) return '#'
  if (/^https?:/i.test(cleaned)) {
    try {
      const url = new URL(cleaned)
      if (url.username || url.password) return '#'
    } catch {
      return '#'
    }
  }
  return cleaned
}

/**
 * Every attribute the tokenizer classifies as `url-attribute`, and what its
 * value actually is.
 *
 * `safeUrl` answers a question about one URL. The set it was being applied to
 * is not a set of single URLs — it holds two space-separated lists, one
 * comma-separated candidate grammar, and five attributes that are not URLs at
 * all. Asking the single-URL question about those gets an answer about the
 * first few characters of something else.
 *
 *   single      href, src, action, formaction, poster, data, cite, background,
 *               longdesc, manifest, profile, icon, usemap, xlink:href
 *   space-list  ping, archive
 *   srcset      srcset
 *   refused     xmlns, xmlns:xlink, from, to, values
 *
 * The refused five are deliberate. `xmlns` chooses a namespace, which decides
 * whether the surrounding markup is HTML or SVG; `from`, `to` and `values` are
 * SMIL animation values, which can retarget another attribute over time and are
 * semicolon-separated lists of arbitrary values rather than URLs. None of them
 * has a safe single-value reading, none appears in the V1 catalogue, and the
 * interpolation compiler is frozen — so a slot in one renders nothing rather
 * than growing this policy a fourth grammar for a case nobody has.
 */
export type UrlAttributeForm = 'single' | 'space-list' | 'srcset' | 'refused'

const URL_ATTRIBUTE_FORM: Record<string, UrlAttributeForm> = {
  href: 'single',
  src: 'single',
  action: 'single',
  formaction: 'single',
  poster: 'single',
  data: 'single',
  cite: 'single',
  background: 'single',
  longdesc: 'single',
  manifest: 'single',
  profile: 'single',
  icon: 'single',
  usemap: 'single',
  codebase: 'single',
  'xlink:href': 'single',
  ping: 'space-list',
  archive: 'space-list',
  srcset: 'srcset',
  xmlns: 'refused',
  'xmlns:xlink': 'refused',
  from: 'refused',
  to: 'refused',
  values: 'refused',
}

export const URL_ATTRIBUTE_FORMS: Readonly<Record<string, UrlAttributeForm>> = URL_ATTRIBUTE_FORM

export function urlAttributeForm(attribute: string | undefined): UrlAttributeForm {
  if (attribute === undefined) return 'single'
  return URL_ATTRIBUTE_FORM[attribute.toLowerCase()] ?? 'single'
}

/** `2x`, `1.5x`, `640w`, or nothing at all. */
const SRCSET_DESCRIPTOR = /^\d+(\.\d+)?[xw]$/

/**
 * Every URL in a list, or nothing.
 *
 * One bad entry rejects the whole value rather than being dropped quietly: a
 * `srcset` missing its 2x candidate is a rendering bug someone will notice and
 * report, whereas a `srcset` silently missing the entry that was attacking is a
 * defence nobody ever hears about.
 */
export function safeUrlList(value: string, form: 'srcset' | 'space-list'): string {
  const cleaned = value.replace(CONTROL_CHARACTERS, '').trim()
  if (cleaned === '') return ''

  if (form === 'space-list') {
    const urls = cleaned.split(/\s+/)
    return urls.every(url => safeUrl(url) === url) ? urls.join(' ') : ''
  }

  const candidates = cleaned
    .split(',')
    .map(candidate => candidate.trim())
    .filter(c => c !== '')
  if (candidates.length === 0) return ''
  const rebuilt: string[] = []
  for (const candidate of candidates) {
    // A candidate is a URL, then optional whitespace, then at most one
    // descriptor. Anything with more parts than that is not a shape this
    // understands, and not understanding it is a reason to refuse it.
    const parts = candidate.split(/\s+/)
    if (parts.length > 2) return ''
    const [url, descriptor] = parts as [string, string | undefined]
    if (safeUrl(url) !== url) return ''
    if (descriptor !== undefined && !SRCSET_DESCRIPTOR.test(descriptor)) return ''
    rebuilt.push(descriptor === undefined ? url : `${url} ${descriptor}`)
  }
  return rebuilt.join(', ')
}

/**
 * The URL policy for a named attribute: one URL, or a list, as that attribute
 * actually works.
 */
export function safeUrlAttribute(attribute: string | undefined, value: string): string {
  const form = urlAttributeForm(attribute)
  if (form === 'refused') return ''
  return form === 'single' ? safeUrl(value) : safeUrlList(value, form)
}
