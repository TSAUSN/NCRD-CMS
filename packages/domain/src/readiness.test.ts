import { describe, expect, it } from 'vitest'
import {
  READINESS_POLICY_VERSION,
  runReadinessChecks,
  type ReadinessInput,
  type ReadinessRule,
  type ReadinessSeverity,
  type RefusedCanonical,
} from './readiness.ts'

const base = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  title: 'Home',
  metaDescription: 'A description.',
  html: '<section><h1>Welcome</h1><p>Hello</p></section>',
  sectionCount: 1,
  knownPaths: new Set(['/', '/about']),
  ...over,
})

describe('a complete page passes', () => {
  it('reports no findings and stamps the policy version', () => {
    const report = runReadinessChecks(base())
    expect(report.ok).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.policyVersion).toBe(READINESS_POLICY_VERSION)
  })
})

describe('blocking rules', () => {
  it('blocks a page with no title', () => {
    expect(runReadinessChecks(base({ title: '  ' })).blocking.map(f => f.rule)).toContain('missing_title')
  })

  it('blocks a page with no main heading', () => {
    const report = runReadinessChecks(base({ html: '<section><h2>Not a h1</h2></section>' }))
    expect(report.blocking.map(f => f.rule)).toContain('missing_h1')
    expect(report.ok).toBe(false)
  })

  it('blocks an empty page without also complaining about the missing heading', () => {
    const report = runReadinessChecks(base({ sectionCount: 0, html: '' }))
    expect(report.blocking.map(f => f.rule)).toEqual(['empty_page'])
  })

  it('blocks an image with no description', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><img src="/a.png">' }))
    expect(report.blocking.map(f => f.rule)).toContain('image_without_alt')
  })

  it('accepts an empty alt when the image is explicitly decorative', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><img src="/a.png" alt="" role="presentation">' }))
    expect(report.ok).toBe(true)
  })

  it('accepts an empty alt on an image hidden from assistive technology', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><img src="/a.png" alt="" aria-hidden="true">' }))
    expect(report.ok).toBe(true)
  })

  it('still blocks an empty alt with no decorative intent', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><img src="/a.png" alt="" aria-hidden="false">' }))
    expect(report.blocking.map(f => f.rule)).toContain('image_without_alt')
  })

  it('reports repeated destinations once while retaining every distinct broken link', () => {
    const repeated = '<a href="/missing">Read story</a>'.repeat(300),
      report = runReadinessChecks(
        base({
          html: '<h1>Stories</h1>' + repeated + '<a href="/other">Other story</a><a href="/missing?view=map">Map</a>',
        }),
      )
    expect(report.blocking.map(f => f.detail)).toEqual(['/missing', '/other', '/missing?view=map'])
    expect(report.ok).toBe(false)
    expect(JSON.stringify(report.findings).length).toBeLessThan(2000)
  })

  it('blocks an internal link to a page that is not published', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><a href="/nope">Go</a>' }))
    expect(report.blocking.map(f => f.rule)).toContain('broken_internal_link')
  })

  it('accepts an internal link to a known path, including with a query and trailing slash', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><a href="/about/?x=1">Go</a>' }))
    expect(report.ok).toBe(true)
  })

  it('leaves external links alone', () => {
    const report = runReadinessChecks(base({ html: '<h1>x</h1><a href="https://example.com">Go</a>' }))
    expect(report.ok).toBe(true)
  })
})

describe('advisory rules do not block', () => {
  it('reports a missing search description without refusing the publish', () => {
    const report = runReadinessChecks(base({ metaDescription: undefined }))
    expect(report.advisory.map(f => f.rule)).toEqual(['missing_meta_description'])
    expect(report.ok).toBe(true)
  })

  it('speaks plain language — no jargon in editor-facing copy', () => {
    const report = runReadinessChecks(base({ title: '', html: '<img src="/a.png">', sectionCount: 1 }))
    for (const finding of report.findings) {
      expect(finding.message).not.toMatch(/renderer|revision|CAS|projection|manifest/i)
    }
  })
})

// Two canonical links the renderer refused, in the shape it hands over. The
// messages are its real ones, written out here rather than imported:
// @cms/domain does not depend on @cms/renderer, and what this rule is promised
// is the shape, not the package.
const REFUSED_HOST: RefusedCanonical = {
  rule: 'other_host',
  message:
    'A canonical link has to point at this site (example.test), and “https://evil.test/hijack” ' +
    'points at evil.test. Cross-site canonical links are not available yet.',
}

const REFUSED_CREDENTIALS: RefusedCanonical = {
  rule: 'embedded_credentials',
  message:
    'A canonical link cannot contain a username or password. It is published to every ' +
    'visitor and every search engine.',
}

describe('a refused canonical link is a blocking problem rather than a silent fallback', () => {
  it('blocks the publish, because the page would otherwise look entirely correct', () => {
    const report = runReadinessChecks(base({ canonicalRefusal: REFUSED_HOST }))
    expect(report.blocking.map(f => f.rule)).toEqual(['refused_canonical'])
    expect(report.ok).toBe(false)
  })

  it('repeats the renderer’s own explanation, which names the value and the reason', () => {
    const [finding] = runReadinessChecks(base({ canonicalRefusal: REFUSED_HOST })).blocking
    expect(finding!.message).toContain('https://evil.test/hijack')
    expect(finding!.message).toContain('evil.test')
    expect(finding!.message).toContain('example.test')
  })

  it('says what the page would do instead, so the fallback stops being a surprise', () => {
    const [finding] = runReadinessChecks(base({ canonicalRefusal: REFUSED_HOST })).blocking
    expect(finding!.message).toContain('its own address')
  })

  it('names the canonical rule rather than the value, which can carry a password', () => {
    // The whole finding is stored in `scheduled_actions.readiness_report` and
    // copied into `audit_log.detail`, so a field holding what the author typed
    // would write the credentials into two more places (SPEC §6.13).
    const report = runReadinessChecks(base({ canonicalRefusal: REFUSED_CREDENTIALS }))
    const [finding] = report.blocking
    expect(finding!.detail).toBe('embedded_credentials')
    expect(JSON.stringify(report)).not.toContain('hunter2')
  })

  it('reports nothing when the authored canonical was accepted', () => {
    expect(runReadinessChecks(base({ canonicalRefusal: undefined })).ok).toBe(true)
  })

  it('reports nothing when the page never authored a canonical at all', () => {
    expect(runReadinessChecks(base({ canonicalRefusal: null })).findings).toEqual([])
  })

  it('speaks plain language, like every other rule', () => {
    const [finding] = runReadinessChecks(base({ canonicalRefusal: REFUSED_HOST })).blocking
    expect(finding!.message).not.toMatch(/renderer|revision|CAS|projection|manifest/i)
  })
})

// Every verdict version 1 reached, with an input that reaches it.
//
// The severities are the point. The migration that lands version 2 carries
// every not-yet-run schedule's pin forward from version 1, and that is only
// defensible while version 2 adds a rule and relaxes none — the moment one of
// these turns advisory, a carried-forward schedule publishes something version
// 1 refused.
const VERSION_1_VERDICTS: [string, Partial<ReadinessInput>, ReadinessRule, ReadinessSeverity][] = [
  ['a page with no title', { title: '  ' }, 'missing_title', 'blocking'],
  ['a page with no sections', { sectionCount: 0, html: '' }, 'empty_page', 'blocking'],
  ['a page with no main heading', { html: '<section><h2>Not a h1</h2></section>' }, 'missing_h1', 'blocking'],
  ['an image with no description', { html: '<h1>x</h1><img src="/a.png">' }, 'image_without_alt', 'blocking'],
  [
    'a link to a page that is not published',
    { html: '<h1>x</h1><a href="/nope">Go</a>' },
    'broken_internal_link',
    'blocking',
  ],
  ['a page with no search description', { metaDescription: undefined }, 'missing_meta_description', 'advisory'],
]

describe('the policy version is what a schedule pins itself to', () => {
  it('is version 2, the version that added the refused canonical rule', () => {
    expect(READINESS_POLICY_VERSION).toBe(3)
  })

  it.each(VERSION_1_VERDICTS)('still reaches version 1’s verdict about %s', (_label, over, rule, severity) => {
    const finding = runReadinessChecks(base(over)).findings.find(f => f.rule === rule)
    expect(finding).toBeDefined()
    expect(finding!.severity).toBe(severity)
  })

  it('leaves a page version 1 was happy with alone', () => {
    // The new rule fires on a refusal and on nothing else, so a version pinned
    // to the old policy and re-judged by this one is not newly refused for a
    // canonical it never set.
    expect(runReadinessChecks(base()).findings).toEqual([])
  })
})

it('reports missing opted-in hero section destinations while leaving imported fragment checking unchanged', () => {
  const source = base({ sectionLinks: ['/about#team'], knownAnchors: new Map([['/about', new Set(['team'])]]) })
  expect(runReadinessChecks(source).ok).toBe(true)
  const missing = runReadinessChecks({ ...source, knownAnchors: new Map([['/about', new Set()]]) })
  expect(missing.blocking).toContainEqual(
    expect.objectContaining({
      rule: 'broken_internal_link',
      detail: '/about#team',
      message: expect.stringContaining('section that is no longer'),
    }),
  )
  expect(runReadinessChecks(base({ html: '<h1>Page</h1><a href="/about#legacy">Legacy</a>' })).ok).toBe(true)
})

it('explains when a managed section exists in a draft and needs to be published with the referring page', () => {
  const report = runReadinessChecks(
    base({
      sectionLinks: ['/about#new-team'],
      knownAnchors: new Map([['/about', new Set(['old-team'])]]),
      draftAnchors: new Map([['/about', new Set(['new-team'])]]),
    }),
  )
  expect(report.blocking).toContainEqual(
    expect.objectContaining({
      rule: 'broken_internal_link',
      message:
        'A link points to a section waiting to be published on /about. Publish these pages together, or choose another destination.',
    }),
  )
})
