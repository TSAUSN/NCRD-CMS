// The canonical URL policy (SPEC §6.8, §6.10).
//
// Two kinds of case here, and the second is the one that matters. The first is
// the obvious hostile input — another host, an executable scheme. The second is
// the pile of ways one host can be spelled: ports that are the default, case,
// a trailing dot, Unicode against punycode. A policy that gets those wrong does
// not fail loudly; it refuses a site its own correct canonical link, and the
// author's fix for that is to stop using the field.
import { describe, expect, it } from 'vitest'
import { normalizeCanonicalHost, resolveCanonical } from './canonical.ts'
import { renderPage, type RenderManifest, type SiteShell } from './render.ts'

const VERIFIED = 'example.test'

/** One page at /p on a site whose verified host is example.test. */
const decide = (authored?: string) => resolveCanonical({ authored, verifiedHost: VERIFIED, path: '/p' })

describe('a relative canonical becomes an absolute https URL on the verified host', () => {
  it.each([
    ['a root-relative path', '/about', 'https://example.test/about'],
    ['the site root', '/', 'https://example.test/'],
    ['a path relative to the page', 'about', 'https://example.test/about'],
    ['an explicitly current-directory path', './about', 'https://example.test/about'],
    ['a query string alone', '?page=2', 'https://example.test/p?page=2'],
  ])('resolves %s', (_label, authored, expected) => {
    expect(decide(authored)).toEqual({ url: expected, source: 'authored' })
  })

  it('uses the page’s own address when nothing was authored', () => {
    expect(decide()).toEqual({ url: 'https://example.test/p', source: 'site-address' })
  })

  it('uses the page’s own address when the field was cleared to whitespace', () => {
    expect(decide('   ')).toEqual({ url: 'https://example.test/p', source: 'site-address' })
  })
})

describe('an absolute canonical is accepted only on the verified host', () => {
  it('keeps a URL that names the verified host', () => {
    expect(decide('https://example.test/other')).toEqual({ url: 'https://example.test/other', source: 'authored' })
  })

  it.each([
    ['an explicit :443, which is https’ own default port', 'https://example.test:443/x', 'https://example.test/x'],
    ['an uppercase host', 'https://EXAMPLE.TEST/x', 'https://example.test/x'],
    ['a mixed-case host', 'https://ExAmPlE.TeSt/x', 'https://example.test/x'],
    ['a mixed-case scheme', 'HTTPS://example.test/x', 'https://example.test/x'],
    ['a trailing dot, which is the same DNS node', 'https://example.test./x', 'https://example.test/x'],
    ['a trailing dot with an explicit :443', 'https://example.test.:443/x', 'https://example.test/x'],
    ['a query string, which is a different document', 'https://example.test/x?page=2', 'https://example.test/x?page=2'],
  ])('accepts %s and emits the normalized spelling', (_label, authored, expected) => {
    expect(decide(authored)).toEqual({ url: expected, source: 'authored' })
  })

  it('drops a fragment, which names a place in the document rather than a document', () => {
    expect(decide('https://example.test/x#section-two')).toEqual({ url: 'https://example.test/x', source: 'authored' })
  })

  it('drops a fragment on a relative reference too', () => {
    expect(decide('#section-two')).toEqual({ url: 'https://example.test/p', source: 'authored' })
  })

  it('preserves path case, because a path is case-sensitive and a host is not', () => {
    expect(decide('https://EXAMPLE.TEST/Case/Matters')).toEqual({
      url: 'https://example.test/Case/Matters',
      source: 'authored',
    })
  })
})

describe('Unicode and punycode are one host, not two', () => {
  it('accepts the Unicode spelling when the verified host is punycode', () => {
    expect(
      resolveCanonical({
        authored: 'https://exämple.test/x',
        verifiedHost: 'xn--exmple-cua.test',
        path: '/p',
      }),
    ).toEqual({ url: 'https://xn--exmple-cua.test/x', source: 'authored' })
  })

  it('accepts the punycode spelling when the verified host is Unicode', () => {
    // The verified host arrives from `domains.hostname_normalized`, which is
    // already ASCII — but the comparison must not depend on that, because a
    // policy that only works on pre-normalized input is a policy that breaks
    // the first time it is handed something else.
    expect(
      resolveCanonical({
        authored: 'https://xn--exmple-cua.test/x',
        verifiedHost: 'exämple.test',
        path: '/p',
      }),
    ).toEqual({ url: 'https://xn--exmple-cua.test/x', source: 'authored' })
  })

  it('emits punycode, which is what a DNS lookup and a crawler both use', () => {
    expect(resolveCanonical({ verifiedHost: 'exämple.test', path: '/p' }).url).toBe('https://xn--exmple-cua.test/p')
  })
})

describe('a canonical naming anywhere else is refused', () => {
  it.each([
    ['a protocol-relative host', '//evil.test/hijack', 'other_host'],
    ['a backslash authority, which the parser reads as slashes', '/\\evil.test/hijack', 'other_host'],
    ['a plainly different host', 'https://evil.test/hijack', 'other_host'],
    ['a deceptive subdomain suffix', 'https://example.test.evil.test/x', 'other_host'],
    ['a deceptive prefix', 'https://notexample.test/x', 'other_host'],
    ['a host that merely contains the verified one', 'https://wwwexample.test/x', 'other_host'],
    ['an IP literal', 'https://93.184.216.34/x', 'other_host'],
    ['a non-default port', 'https://example.test:8443/x', 'other_port'],
    ['plain http, which a crawler can have rewritten in transit', 'http://example.test/x', 'not_https'],
    ['mailto:', 'mailto:someone@example.test', 'not_https'],
    ['tel:', 'tel:+15550100', 'not_https'],
    ['javascript:', 'javascript:alert(1)', 'not_https'],
    ['a javascript: URL split by a control character', 'java\nscript:alert(1)', 'not_https'],
    ['data:', 'data:text/html,<h1>x', 'not_https'],
    ['embedded credentials', 'https://user:pass@example.test/', 'embedded_credentials'],
    ['a username with no password', 'https://user@example.test/', 'embedded_credentials'],
    ['a host with a space in it', 'https://exa mple.test/x', 'unparsable'],
  ])('refuses %s', (_label, authored, rule) => {
    const decision = decide(authored)
    expect(decision.refusal?.rule).toBe(rule)
  })

  it('falls back to the page’s own address rather than publishing the refused value', () => {
    const decision = decide('https://evil.test/hijack')
    expect(decision.url).toBe('https://example.test/p')
    expect(decision.source).toBe('site-address')
  })

  it('says what was wrong in language an author can act on', () => {
    const decision = decide('https://evil.test/hijack')
    expect(decision.refusal?.message).toContain('example.test')
    expect(decision.refusal?.message).toContain('evil.test')
    expect(decision.refusal?.authored).toBe('https://evil.test/hijack')
  })

  it('never repeats embedded credentials back in its own message', () => {
    // The message is editor-facing and ends up in logs and audit entries; a
    // refusal that quotes the password has published it to a second place.
    const decision = decide('https://user:hunter2@example.test/')
    expect(decision.refusal?.message).not.toContain('hunter2')
  })
})

describe('the verified host decides, even when a staging host is serving', () => {
  it('names the live address on a staging render', () => {
    expect(
      resolveCanonical({
        verifiedHost: 'example.test',
        servingBase: 'https://demo.staging.test',
        path: '/p',
      }),
    ).toEqual({ url: 'https://example.test/p', source: 'site-address' })
  })

  it('accepts an authored canonical on the live host from a staging render', () => {
    expect(
      resolveCanonical({
        authored: 'https://example.test/other',
        verifiedHost: 'example.test',
        servingBase: 'https://demo.staging.test',
        path: '/p',
      }),
    ).toEqual({ url: 'https://example.test/other', source: 'authored' })
  })

  it('refuses the staging host itself once a live domain is verified', () => {
    // Not a special case: staging is simply not the verified host, and the one
    // host comparison is what refuses it.
    const decision = resolveCanonical({
      authored: 'https://demo.staging.test/p',
      verifiedHost: 'example.test',
      servingBase: 'https://demo.staging.test',
      path: '/p',
    })
    expect(decision.refusal?.rule).toBe('other_host')
    expect(decision.url).toBe('https://example.test/p')
  })

  it('falls back to the serving origin while a site has no verified domain yet', () => {
    expect(
      resolveCanonical({
        verifiedHost: null,
        servingBase: 'https://demo.staging.test',
        path: '/p',
      }),
    ).toEqual({ url: 'https://demo.staging.test/p', source: 'site-address' })
  })

  it('binds an authored canonical to the serving origin when that is all there is', () => {
    const decision = resolveCanonical({
      authored: 'https://example.test/p',
      verifiedHost: null,
      servingBase: 'https://demo.staging.test',
      path: '/p',
    })
    expect(decision.refusal?.rule).toBe('other_host')
    expect(decision.url).toBe('https://demo.staging.test/p')
  })
})

describe('a site with no address to name emits no canonical at all', () => {
  it.each([
    ['neither a verified host nor a serving origin', { verifiedHost: null }],
    ['an unusable verified host', { verifiedHost: 'not a host' }],
    ['a serving origin that is not https', { verifiedHost: null, servingBase: 'http://demo.test' }],
    ['a serving origin carrying credentials', { verifiedHost: null, servingBase: 'https://u:p@demo.test' }],
    ['a serving origin that is not a URL', { verifiedHost: null, servingBase: 'demo.test' }],
  ])('emits nothing for %s', (_label, over) => {
    expect(resolveCanonical({ path: '/p', ...over })).toEqual({ url: '', source: 'none' })
  })

  it('emits nothing rather than the wrong page when the page’s own path names another host', () => {
    // `//host/x` is a valid path shape, and resolving it against the site's
    // origin produces somebody else's URL. A canonical link naming the wrong
    // document is a worse failure than a missing one.
    expect(resolveCanonical({ verifiedHost: VERIFIED, path: '//evil.test/x' })).toEqual({ url: '', source: 'none' })
  })

  it('ignores an authored canonical when the page has no address of its own', () => {
    expect(
      resolveCanonical({
        authored: 'https://example.test/other',
        verifiedHost: VERIFIED,
        path: '//evil.test/x',
      }),
    ).toEqual({ url: '', source: 'none' })
  })
})

describe('a hostname is normalized by the parser, never by string surgery', () => {
  it.each([
    ['lowercases', 'EXAMPLE.TEST', 'example.test'],
    ['strips a trailing dot', 'example.test.', 'example.test'],
    ['encodes Unicode as punycode', 'exämple.test', 'xn--exmple-cua.test'],
    ['leaves punycode alone', 'xn--exmple-cua.test', 'xn--exmple-cua.test'],
    ['trims surrounding whitespace', '  example.test  ', 'example.test'],
  ])('%s', (_label, raw, expected) => {
    expect(normalizeCanonicalHost(raw)).toBe(expected)
  })

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a host with a port', 'example.test:8443'],
    ['a host carrying userinfo', 'user@example.test'],
    ['a host carrying a path — truncating it to `a` would compare the wrong thing', 'a/b'],
    ['a host carrying a query', 'example.test?x=1'],
    ['a host carrying a fragment', 'example.test#x'],
    ['a host with an interior space', 'exa mple.test'],
  ])('refuses %s rather than coercing it', (_label, raw) => {
    expect(normalizeCanonicalHost(raw)).toBeNull()
  })
})

describe('the rendered document carries the decision the policy made', () => {
  const documentFor = (canonical?: string, shellOver: Partial<SiteShell> = {}) =>
    renderPage({
      manifest: {
        page: { id: 'p', version_id: 'v', title: 'T', path: '/p' },
        meta: canonical === undefined ? {} : { canonical },
        sections: [],
      } as unknown as RenderManifest,
      shell: {
        site: { id: 's', name: 'S', slug: 's' },
        theme: {},
        navigation: [],
        canonical_host: VERIFIED,
        staging_host: null,
        ...shellOver,
      } as SiteShell,
      isStaging: false,
    })

  it('emits the canonical link and og:url as the same absolute URL', () => {
    const { html } = documentFor('https://EXAMPLE.TEST.:443/other')
    expect(html).toContain('<link rel="canonical" href="https://example.test/other">')
    expect(html).toContain('<meta property="og:url" content="https://example.test/other">')
  })

  it('never lets a refused host reach the head, in either element', () => {
    const { html } = documentFor('https://example.test.evil.test/x')
    expect(html).not.toContain('evil.test')
    expect(html).toContain('<link rel="canonical" href="https://example.test/p">')
    expect(html).toContain('<meta property="og:url" content="https://example.test/p">')
  })

  it('reports the refusal to its caller, so it is something an author can be told', () => {
    const { canonical } = documentFor('https://evil.test/x')
    expect(canonical.source).toBe('site-address')
    expect(canonical.refusal?.rule).toBe('other_host')
  })

  it('reports no refusal when the authored value was kept', () => {
    const { canonical } = documentFor('https://example.test/other')
    expect(canonical).toEqual({ url: 'https://example.test/other', source: 'authored' })
  })

  it('emits no canonical element at all for a site with no address', () => {
    const { html, canonical } = documentFor(undefined, { canonical_host: null })
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('og:url')
    expect(canonical).toEqual({ url: '', source: 'none' })
  })

  it('names the live host from a staging render rather than the host serving it', () => {
    const { html } = renderPage({
      manifest: {
        page: { id: 'p', version_id: 'v', title: 'T', path: '/p' },
        meta: {},
        sections: [],
      } as unknown as RenderManifest,
      shell: {
        site: { id: 's', name: 'S', slug: 's' },
        theme: {},
        navigation: [],
        canonical_host: VERIFIED,
        staging_host: 'demo.staging.test',
      } as SiteShell,
      isStaging: true,
      options: { canonicalBase: 'https://demo.staging.test' },
    })
    expect(html).toContain('<link rel="canonical" href="https://example.test/p">')
    expect(html).not.toContain('demo.staging.test')
    // Still noindex: naming the live URL is not a request to index staging.
    expect(html).toContain('content="noindex,nofollow"')
  })
})
