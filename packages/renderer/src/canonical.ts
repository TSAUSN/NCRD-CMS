// The canonical URL policy (SPEC §6.8, §6.10).
//
// A canonical link is the one piece of a page that tells every search engine
// which address *is* this document. Everything else in the head describes the
// page; this one reassigns it. So the question "what may an author put here?"
// is not an escaping question — `https://evil.test/x` is a perfectly
// well-formed URL, correctly quoted, and publishing it asks the entire index to
// credit somebody else's host with this page's content. `safeUrl` cannot answer
// it: `safeUrl` knows about schemes, and this is a question about *which site*.
//
// Ordinary canonical metadata is therefore same-site only. A relative reference
// resolves against the page's own address; an absolute URL is accepted only
// when its normalized hostname is the site's verified `canonical_host`. Nothing
// else is emitted, and an authored value that fails is replaced by the page's
// own address rather than published — a canonical naming a host we have not
// verified is not a weaker version of the feature, it is the attack.
//
// Cross-domain canonical (syndication) is a real product need and is not built
// here. SPEC §6.8 records what it will require — super-admin permission, a
// verified external host, a stated reason, an audit event, and invalidation of
// the approval when the canonical changes — because none of that is a default
// anyone should be able to reach by typing a URL into a metadata field.
//
// EVERY comparison below is made on values the WHATWG URL parser produced.
// String surgery on URLs is how `example.test.evil.test` passes a check written
// for `example.test`: a parser knows where the host ends and a `startsWith` or
// `endsWith` does not.

/** Why an authored canonical was refused. Each maps to one rule below. */
export type CanonicalRefusalRule = 'unparsable' | 'not_https' | 'embedded_credentials' | 'other_port' | 'other_host'

export type CanonicalRefusal = {
  rule: CanonicalRefusalRule
  /** Plain language, editor-facing. No jargon (SPEC §7). */
  message: string
  /** What the author actually wrote, so the message can be acted on. */
  authored: string
}

export type CanonicalDecision = {
  /**
   * The absolute https URL to publish, or '' when this site has no address to
   * name at all — no verified domain and no serving origin. A page with no
   * address emits no canonical link, because a canonical link that names
   * nothing is worse than its absence.
   */
  url: string
  /** Which rule produced `url`. */
  source: 'authored' | 'site-address' | 'none'
  /** Present only when an authored value was refused. */
  refusal?: CanonicalRefusal
}

export type CanonicalInput = {
  /** What the author put in the page's canonical field, if anything. */
  authored?: string | undefined
  /**
   * The site's verified live hostname — `SiteShell.canonical_host`, which
   * migration 0003 fills from the site's live *primary* domain and leaves NULL
   * until one exists.
   */
  verifiedHost?: string | null | undefined
  /**
   * The origin this response is being served from, e.g. `https://staging.host`.
   * Only consulted when there is no verified host: a staging page for a site
   * that already has a live domain must name the live URL, not the staging one,
   * or staging accumulates canonical links pointing at an address that is
   * deliberately `noindex` and will be turned off.
   */
  servingBase?: string | undefined
  /** The page's own published path, e.g. `/about`. */
  path: string
}

/** A host and port pair, both already normalized by the URL parser. */
type Origin = { hostname: string; port: string; href: string }

/**
 * A hostname's canonical spelling, or null when the string is not one hostname.
 *
 * Parser-derived rather than lowercased by hand, because three of the ways two
 * spellings of the same host differ are not case: `EXAMPLE.TEST` and
 * `example.test`, `exämple.test` and `xn--exmple-cua.test`, `example.test.` and
 * `example.test` are each one host written two ways, and a comparison that
 * misses any of them refuses a site its own address.
 *
 * The trailing dot is stripped here rather than left to the parser, which keeps
 * it: `example.test.` is the fully qualified spelling of `example.test` and
 * names the same DNS node, so treating them as different hosts would refuse a
 * correct value. Unicode is accepted and encoded, unlike @cms/domain's
 * `normalizeHost`, which refuses it — that function normalizes a *Host header*
 * being matched against stored rows, where refusing is right because the stored
 * value is already ASCII. Here the input is something a person typed.
 */
export function normalizeCanonicalHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(`https://${raw.trim()}`)
  } catch {
    return null
  }
  // `https://a/b` parses happily with hostname `a`, so a string that is not
  // *only* a hostname has to be refused rather than silently truncated to its
  // first label. Same for credentials and a port: none of them is a hostname,
  // and accepting one means comparing against something the caller did not say.
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return null
  if (parsed.username !== '' || parsed.password !== '' || parsed.port !== '') return null
  return stripTrailingDot(parsed.hostname)
}

/** `example.test.` and `example.test` are the same DNS node, so the same host. */
function stripTrailingDot(hostname: string): string {
  return hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
}

/**
 * The site's own origin: its verified domain if it has one, otherwise whatever
 * origin is serving this response.
 *
 * The verified host wins even when a staging host is serving, which is the
 * whole point — see `servingBase` above.
 */
function siteOrigin(input: CanonicalInput): Origin | null {
  const verified = normalizeCanonicalHost(input.verifiedHost)
  if (verified !== null) return { hostname: verified, port: '', href: `https://${verified}` }

  if (!input.servingBase) return null
  let base: URL
  try {
    base = new URL(input.servingBase)
  } catch {
    return null
  }
  // The serving base is our own configuration rather than authored content, but
  // it is still checked: a deployment that mis-set it would otherwise publish
  // whatever it says as this site's identity on every page.
  if (base.protocol !== 'https:') return null
  if (base.username !== '' || base.password !== '') return null
  const hostname = stripTrailingDot(base.hostname)
  if (hostname === '') return null
  const port = base.port
  return { hostname, port, href: port === '' ? `https://${hostname}` : `https://${hostname}:${port}` }
}

/**
 * One reference resolved against the page, if it names this site.
 *
 * Returns the absolute https URL, or the reason it is not one. Both the
 * authored value and the page's own path go through this, so there is exactly
 * one implementation of "does this name our site" and no second, more
 * forgiving one for values we produced ourselves.
 */
function sameSiteUrl(origin: Origin, base: string, reference: string): string | CanonicalRefusal {
  const refuse = (rule: CanonicalRefusalRule, message: string): CanonicalRefusal => ({
    rule,
    message,
    authored: reference,
  })

  let url: URL
  try {
    url = new URL(reference, base)
  } catch {
    return refuse('unparsable', `“${reference}” is not a web address, so it cannot be this page’s canonical link.`)
  }

  // Scheme first. `mailto:`, `tel:`, `javascript:` and `data:` all parse — they
  // simply ignore the base and keep their own scheme — so this one comparison
  // refuses every one of them, and `http:` with them, without a list to keep up
  // to date. A canonical link is followed and re-fetched by crawlers, and an
  // http one invites the answer to be rewritten in transit.
  if (url.protocol !== 'https:') {
    return refuse('not_https', `A canonical link has to be an https address on this site, and “${reference}” is not.`)
  }

  // A canonical link is published to every visitor and every search engine, so
  // a URL carrying userinfo publishes the credentials with it. Refused rather
  // than stripped: silently changing a URL an author wrote is how the value
  // that ships stops being the value anyone reviewed.
  if (url.username !== '' || url.password !== '') {
    return refuse(
      'embedded_credentials',
      'A canonical link cannot contain a username or password. It is published to every ' +
        'visitor and every search engine.',
    )
  }

  // The parser has already dropped `:443`, which is https' default and means
  // the same origin. Anything left is a different origin serving different
  // content, whatever its hostname says.
  if (url.port !== origin.port) {
    return refuse(
      'other_port',
      `A canonical link has to point at ${origin.href}. “${reference}” names a different port.`,
    )
  }

  // The host comparison, on two parsed hostnames. Equality, never a prefix or
  // suffix test: `example.test.evil.test` ends with nothing useful and
  // `notexample.test` contains the verified host as a substring, and both are
  // somebody else's server. A protocol-relative `//evil.test/x` arrives here
  // too — it inherits https from the base and then names the wrong host, so it
  // is refused by this rule rather than by a special case of its own.
  const hostname = stripTrailingDot(url.hostname)
  if (hostname !== origin.hostname) {
    return refuse(
      'other_host',
      `A canonical link has to point at this site (${origin.hostname}), and “${reference}” ` +
        `points at ${hostname}. Cross-site canonical links are not available yet.`,
    )
  }

  // Emit the normalized spelling, not the authored one: the whole purpose of a
  // canonical link is that every page naming this document names it
  // identically, and `EXAMPLE.TEST.` and `example.test` are the same document
  // written two ways.
  url.hostname = hostname
  // A fragment names a place inside the document, not a document. Keeping it
  // would publish two canonical URLs for one page and defeat the deduplication
  // this link exists to perform. A query string is kept, because `?page=2`
  // genuinely is a different document.
  url.hash = ''
  return url.href
}

/**
 * The canonical URL for one page, and why.
 *
 * The order is fixed: work out the site's own address, then the page's own
 * address on it, then let an authored value replace that only if it names the
 * same site.
 */
export function resolveCanonical(input: CanonicalInput): CanonicalDecision {
  const origin = siteOrigin(input)
  if (origin === null) return { url: '', source: 'none' }

  // The page's own path goes through the same check as an authored value. It
  // comes from `published_routes`, which is ours, but `//host/x` is a valid
  // path shape and would resolve to another origin — and a canonical link that
  // names the wrong page is a worse failure than one that is missing, so a page
  // whose own path cannot produce a same-site URL gets no canonical at all.
  const ownAddress = sameSiteUrl(origin, `${origin.href}/`, input.path)
  if (typeof ownAddress !== 'string') return { url: '', source: 'none' }

  const authored = input.authored?.trim()
  if (!authored) return { url: ownAddress, source: 'site-address' }

  // Relative references resolve against the page's own address, which is what
  // a browser reading `<link rel="canonical" href="about">` would do. Anything
  // else would make the same markup mean different things in different places.
  const resolved = sameSiteUrl(origin, ownAddress, authored)
  if (typeof resolved === 'string') return { url: resolved, source: 'authored' }
  return { url: ownAddress, source: 'site-address', refusal: resolved }
}
