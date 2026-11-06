import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_HEADER_CONFIG,
  FooterConfigV1,
  GLOBAL_ELEMENT_LIMITS,
  HeaderConfigV1,
  HeaderDraftConfig,
  normalizeFooterConfig,
  normalizeHeaderConfig,
  parseFooterConfig,
  parseHeaderConfig,
  type FooterConfig,
  type HeaderConfig,
} from './index.ts'

const preset = (config: HeaderConfig | null) => config as HeaderConfigV1 | null
const presetFooter = (config: FooterConfig | null) => config as FooterConfigV1 | null

const PAGE_ID = '00000000-0000-4000-8000-000000000001'
const MEDIA_ID = '00000000-0000-4000-8000-000000000002'

const internalLink = (label = 'About') => ({
  label,
  target: { type: 'url' as const, url: '/about' },
})

const externalLink = (label = 'Give') => ({
  label,
  target: { type: 'url' as const, url: 'https://example.org/give' },
})

const pageLink = (label = 'Programs') => ({
  label,
  target: { type: 'page' as const, page_id: PAGE_ID },
})

const validHeader = (): HeaderConfigV1 => ({
  ...DEFAULT_HEADER_CONFIG,
  brand: { ...DEFAULT_HEADER_CONFIG.brand, siteName: 'Harbor Corps' },
  utilityLinks: [internalLink()],
  cta: externalLink(),
})

const validFooter = (): FooterConfigV1 => ({
  ...DEFAULT_FOOTER_CONFIG,
  brand: { ...DEFAULT_FOOTER_CONFIG.brand, siteName: 'Harbor Corps', blurb: 'Hope in our community.' },
  groups: [{ heading: 'Explore', links: [internalLink()] }],
  contact: { address: '1 Main Street', email: 'hello@example.org', phone: '+1 555 0100' },
  social: [{ service: 'facebook', url: 'https://facebook.com/example' }],
  legal: {
    copyright: '© Harbor Corps',
    privacy: internalLink('Privacy'),
    accessibility: pageLink('Accessibility'),
    terms: null,
  },
})

describe('global-element defaults and normalization', () => {
  it('keeps the baseline shell enabled and supplies the site name at normalization time', () => {
    expect(DEFAULT_HEADER_CONFIG.brand.siteName).toBe('')
    expect(DEFAULT_FOOTER_CONFIG.brand.siteName).toBe('')

    expect(normalizeHeaderConfig(undefined, 'Harbor Corps')).toEqual({
      ...DEFAULT_HEADER_CONFIG,
      brand: { ...DEFAULT_HEADER_CONFIG.brand, siteName: 'Harbor Corps' },
    })
    expect(normalizeFooterConfig(null, 'Harbor Corps')).toEqual({
      ...DEFAULT_FOOTER_CONFIG,
      brand: { ...DEFAULT_FOOTER_CONFIG.brand, siteName: 'Harbor Corps' },
    })
    expect(DEFAULT_HEADER_CONFIG.enabled).toBe(true)
    expect(DEFAULT_FOOTER_CONFIG.enabled).toBe(true)
    expect(DEFAULT_FOOTER_CONFIG.brand.showFoundation).toBe(true)
    expect(DEFAULT_HEADER_CONFIG.cta).toBeNull()
    expect(DEFAULT_FOOTER_CONFIG.contact).toBeNull()
  })

  it('fills an empty current-version default without replacing an authored name', () => {
    expect(preset(normalizeHeaderConfig(DEFAULT_HEADER_CONFIG, 'Harbor Corps'))?.brand.siteName).toBe('Harbor Corps')
    expect(presetFooter(normalizeFooterConfig(validFooter(), 'Different Site'))?.brand.siteName).toBe('Harbor Corps')
  })

  it('normalizes strict pre-versioned values against safe defaults', () => {
    expect(
      normalizeHeaderConfig(
        {
          preset: 'compact',
          brand: { showName: false },
          utilityLinks: [pageLink()],
        },
        'Harbor Corps',
      ),
    ).toMatchObject({
      schemaVersion: 1,
      enabled: true,
      preset: 'compact',
      brand: { siteName: 'Harbor Corps', showName: false },
      utilityLinks: [pageLink()],
    })
    expect(
      normalizeFooterConfig(
        {
          preset: 'columns',
          brand: { blurb: 'Welcome.' },
          legal: { privacy: internalLink('Privacy') },
        },
        'Harbor Corps',
      ),
    ).toMatchObject({
      schemaVersion: 1,
      preset: 'columns',
      brand: { siteName: 'Harbor Corps', blurb: 'Welcome.' },
      legal: { privacy: internalLink('Privacy'), terms: null },
    })
  })

  it('returns fresh parsed defaults rather than exposing shared mutable state', () => {
    const first = preset(normalizeHeaderConfig(null, 'First'))
    const second = preset(normalizeHeaderConfig(null, 'Second'))
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    first?.utilityLinks.push(internalLink())
    expect(second?.utilityLinks).toEqual([])
    expect(DEFAULT_HEADER_CONFIG.utilityLinks).toEqual([])
  })

  it('refuses an invalid normalization site name', () => {
    expect(normalizeHeaderConfig(null, 'x'.repeat(GLOBAL_ELEMENT_LIMITS.siteName + 1))).toBeNull()
    expect(normalizeFooterConfig(null, 'x'.repeat(GLOBAL_ELEMENT_LIMITS.siteName + 1))).toBeNull()
  })
})

describe('current-version content fails closed', () => {
  it('parses complete current values through the focused helpers', () => {
    expect(parseHeaderConfig(validHeader())).toEqual(validHeader())
    expect(parseFooterConfig(validFooter())).toEqual(validFooter())
  })

  it.each([
    ['a future header version', { ...validHeader(), schemaVersion: 2 }],
    ['a missing header field', (({ sticky: _sticky, ...rest }) => rest)(validHeader())],
    ['an unknown header field', { ...validHeader(), navigation: [] }],
    ['a malformed current header field', { ...validHeader(), enabled: 'yes' }],
  ])('does not repair %s', (_label, value) => {
    expect(normalizeHeaderConfig(value, 'Fallback')).toBeNull()
  })

  it.each([
    ['a future footer version', { ...validFooter(), schemaVersion: 2 }],
    ['a missing footer field', (({ social: _social, ...rest }) => rest)(validFooter())],
    ['an unknown footer field', { ...validFooter(), mainNavigation: [] }],
    ['a malformed current footer field', { ...validFooter(), groups: 'links' }],
  ])('does not repair %s', (_label, value) => {
    expect(normalizeFooterConfig(value, 'Fallback')).toBeNull()
  })

  it('refuses unknown keys in legacy content rather than stripping them', () => {
    expect(normalizeHeaderConfig({ brand: {}, customCss: '.brand{}' })).toBeNull()
    expect(normalizeFooterConfig({ legal: {}, html: '<footer>unsafe</footer>' })).toBeNull()
  })
})

describe('header bounds and closed controls', () => {
  it('accepts every header preset and semantic surface', () => {
    for (const preset of ['standard', 'centered', 'compact', 'minimal'] as const) {
      expect(HeaderConfigV1.safeParse({ ...validHeader(), preset }).success).toBe(true)
    }
    for (const surface of ['page', 'soft', 'primary', 'accent', 'transparent'] as const) {
      expect(HeaderConfigV1.safeParse({ ...validHeader(), surface }).success).toBe(true)
    }
  })

  it('bounds brand and link text at their exact limits', () => {
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, siteName: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.siteName) },
        utilityLinks: [internalLink('x'.repeat(GLOBAL_ELEMENT_LIMITS.linkLabel))],
      }).success,
    ).toBe(true)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, siteName: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.siteName + 1) },
      }).success,
    ).toBe(false)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        utilityLinks: [internalLink('x'.repeat(GLOBAL_ELEMENT_LIMITS.linkLabel + 1))],
      }).success,
    ).toBe(false)
  })

  it('accepts zero through four utility links and refuses five', () => {
    expect(HeaderConfigV1.safeParse({ ...validHeader(), utilityLinks: [] }).success).toBe(true)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        utilityLinks: Array.from({ length: 4 }, (_, index) => internalLink(`Link ${index}`)),
      }).success,
    ).toBe(true)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        utilityLinks: Array.from({ length: 5 }, (_, index) => internalLink(`Link ${index}`)),
      }).success,
    ).toBe(false)
  })

  it('governs media references as nullable UUIDs', () => {
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, logoMediaId: MEDIA_ID, compactLogoMediaId: MEDIA_ID },
      }).success,
    ).toBe(true)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, logoMediaId: '/media/logo.png' },
      }).success,
    ).toBe(false)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, compactLogoMediaId: 'not-a-uuid' },
      }).success,
    ).toBe(false)
  })

  it.each(['rawHtml', 'css', 'backgroundColor', 'heightPx', 'mainNavigation'])(
    'refuses the ungoverned root control %s',
    key => {
      expect(HeaderConfigV1.safeParse({ ...validHeader(), [key]: 'unsafe' }).success).toBe(false)
    },
  )

  it('refuses unknown nested brand, link, and target properties', () => {
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        brand: { ...validHeader().brand, color: '#fff' },
      }).success,
    ).toBe(false)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        utilityLinks: [{ ...internalLink(), html: '<b>About</b>' }],
      }).success,
    ).toBe(false)
    expect(
      HeaderConfigV1.safeParse({
        ...validHeader(),
        utilityLinks: [{ label: 'About', target: { type: 'url', url: '/about', rel: 'opener' } }],
      }).success,
    ).toBe(false)
  })
})

describe('governed navigation targets', () => {
  it.each([pageLink(), internalLink(), externalLink()])('accepts the governed target in $target.type form', link => {
    expect(HeaderConfigV1.safeParse({ ...validHeader(), cta: link }).success).toBe(true)
  })

  it.each([
    { type: 'page', page_id: 'not-a-uuid' },
    { type: 'page', pageId: PAGE_ID },
    { type: 'url', url: 'data:text/html,<script>alert(1)</script>' },
    { type: 'url', url: 'javascript:alert(1)' },
    { type: 'url', url: 'http://example.org' },
    { type: 'url', url: '//example.org' },
    { type: 'url', url: 'https://user:password@example.org' },
    { type: 'url', url: '/path\\to\\file' },
  ])('refuses an unsafe or ungoverned target: $type', target => {
    expect(HeaderConfigV1.safeParse({ ...validHeader(), cta: { label: 'Unsafe', target } }).success).toBe(false)
  })
})

describe('footer group, contact, social, and legal bounds', () => {
  it('accepts every footer preset', () => {
    for (const preset of ['simple', 'columns', 'contact'] as const) {
      expect(FooterConfigV1.safeParse({ ...validFooter(), preset }).success).toBe(true)
    }
  })

  it('accepts four groups of six links and refuses either count plus one', () => {
    const group = (index: number, links = 6) => ({
      heading: `Group ${index}`,
      links: Array.from({ length: links }, (_, linkIndex) => internalLink(`Link ${linkIndex}`)),
    })
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        groups: Array.from({ length: 4 }, (_, index) => group(index)),
      }).success,
    ).toBe(true)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        groups: Array.from({ length: 5 }, (_, index) => group(index)),
      }).success,
    ).toBe(false)
    expect(FooterConfigV1.safeParse({ ...validFooter(), groups: [group(0, 7)] }).success).toBe(false)
  })

  it('bounds group headings, blurb, and copyright exactly', () => {
    const atLimit = {
      ...validFooter(),
      brand: { ...validFooter().brand, blurb: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.blurb) },
      groups: [{ heading: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.groupHeading), links: [] }],
      legal: { ...validFooter().legal, copyright: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.copyright) },
    }
    expect(FooterConfigV1.safeParse(atLimit).success).toBe(true)
    expect(
      FooterConfigV1.safeParse({
        ...atLimit,
        brand: { ...atLimit.brand, blurb: `${atLimit.brand.blurb}x` },
      }).success,
    ).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...atLimit,
        groups: [{ heading: `${atLimit.groups[0]?.heading}x`, links: [] }],
      }).success,
    ).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...atLimit,
        legal: { ...atLimit.legal, copyright: `${atLimit.legal.copyright}x` },
      }).success,
    ).toBe(false)
  })

  it('accepts bounded contact fields and rejects empty, invalid, oversized, or open contact objects', () => {
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        contact: {
          heading: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.contactHeading),
          address: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.contactAddress),
          phone: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.contactPhone),
          email: 'hello@example.org',
        },
      }).success,
    ).toBe(true)
    expect(FooterConfigV1.safeParse({ ...validFooter(), contact: {} }).success).toBe(false)
    expect(FooterConfigV1.safeParse({ ...validFooter(), contact: { email: 'not-an-email' } }).success).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        contact: { address: 'x'.repeat(GLOBAL_ELEMENT_LIMITS.contactAddress + 1) },
      }).success,
    ).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        contact: { phone: '555-0100', style: 'large' },
      }).success,
    ).toBe(false)
  })

  it('accepts six closed-service social links and refuses seven or an unknown service', () => {
    const services = ['facebook', 'instagram', 'youtube', 'linkedin', 'x', 'tiktok'] as const
    const social = services.map(service => ({ service, url: `https://example.org/${service}` }))
    expect(FooterConfigV1.safeParse({ ...validFooter(), social }).success).toBe(true)
    expect(FooterConfigV1.safeParse({ ...validFooter(), social: [...social, social[0]] }).success).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        social: [{ service: 'myspace', url: 'https://example.org' }],
      }).success,
    ).toBe(false)
  })

  it.each([
    '/facebook',
    'http://facebook.com/example',
    'data:text/html,unsafe',
    'https://user:password@facebook.com/example',
    'https://facebook.com/path with spaces',
    'https://facebook.com/path\\segment',
  ])('refuses unsafe social URL %s', url => {
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        social: [{ service: 'facebook', url }],
      }).success,
    ).toBe(false)
  })

  it('keeps legal links structured and closed', () => {
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        legal: { copyright: '', privacy: pageLink('Privacy'), accessibility: null, terms: externalLink('Terms') },
      }).success,
    ).toBe(true)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        legal: { ...validFooter().legal, html: '<a href="/privacy">Privacy</a>' },
      }).success,
    ).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        legal: { ...validFooter().legal, privacy: { label: 'Privacy', href: '/privacy' } },
      }).success,
    ).toBe(false)
  })

  it('refuses unknown nested group and social properties', () => {
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        groups: [{ heading: 'Explore', links: [], columns: 4 }],
      }).success,
    ).toBe(false)
    expect(
      FooterConfigV1.safeParse({
        ...validFooter(),
        social: [{ service: 'x', url: 'https://x.com/example', icon: '<svg />' }],
      }).success,
    ).toBe(false)
  })

  describe('authored frame components (ADR 0010)', () => {
    const DEF_ID = '00000000-0000-4000-8000-0000000000aa'
    const component = { section_def_id: DEF_ID, section_def_version: 3, values: { title: 'Human Needs Index' } }

    it('parses a version-2 header and footer and keeps them as authored', () => {
      const header = parseHeaderConfig({ schemaVersion: 2, enabled: true, sticky: true, component })
      const footer = parseFooterConfig({ schemaVersion: 2, enabled: true, component })
      expect(header).toEqual({ schemaVersion: 2, enabled: true, sticky: true, component })
      expect(footer).toEqual({ schemaVersion: 2, enabled: true, component })
      // Normalizing never grafts a preset brand onto an authored frame.
      expect(
        normalizeHeaderConfig({ schemaVersion: 2, enabled: true, sticky: false, component }, 'Harbor Corps'),
      ).toEqual({ schemaVersion: 2, enabled: true, sticky: false, component })
    })

    it('refuses extra keys, a footer sticky flag, bad references and oversized values', () => {
      expect(
        parseHeaderConfig({ schemaVersion: 2, enabled: true, sticky: false, component, preset: 'standard' }),
      ).toBeNull()
      expect(parseFooterConfig({ schemaVersion: 2, enabled: true, sticky: false, component })).toBeNull()
      expect(
        parseHeaderConfig({
          schemaVersion: 2,
          enabled: true,
          sticky: false,
          component: { ...component, section_def_id: 'not-a-uuid' },
        }),
      ).toBeNull()
      expect(
        parseHeaderConfig({
          schemaVersion: 2,
          enabled: true,
          sticky: false,
          component: { ...component, section_def_version: 0 },
        }),
      ).toBeNull()
      expect(
        parseHeaderConfig({ schemaVersion: 2, enabled: true, sticky: false, component: { ...component, extra: true } }),
      ).toBeNull()
      expect(
        parseHeaderConfig({
          schemaVersion: 2,
          enabled: true,
          sticky: false,
          component: { ...component, values: { big: 'x'.repeat(140000) } },
        }),
      ).toBeNull()
      expect(parseHeaderConfig({ schemaVersion: 3, enabled: true, sticky: false, component })).toBeNull()
    })
  })
})

describe('additive preset logo descriptions', () => {
  it('reads an older immutable logo header without adding or requiring a field', () => {
    const old = { ...validHeader(), brand: { ...validHeader().brand, logoMediaId: MEDIA_ID } }
    expect(HeaderConfigV1.parse(old)).toEqual(old)
    expect(HeaderConfigV1.parse(old).brand).not.toHaveProperty('logoDescription')
    expect(HeaderDraftConfig.safeParse(old).success).toBe(false)
  })
  it.each(['logoMediaId', 'compactLogoMediaId'] as const)('requires a description for new drafts with %s', key => {
    const base = { ...validHeader(), brand: { ...validHeader().brand, [key]: MEDIA_ID } }
    expect(HeaderDraftConfig.safeParse(base).success).toBe(false)
    expect(HeaderDraftConfig.safeParse({ ...base, brand: { ...base.brand, logoDescription: '  ' } }).success).toBe(
      false,
    )
    const next = {
      ...base,
      brand: { ...base.brand, logoDescription: 'The Salvation Army Echelon — Mobilizing the next generation' },
    }
    expect(HeaderDraftConfig.parse(next)).toEqual(next)
    expect(HeaderConfigV1.parse(next)).toEqual(next)
    expect(
      HeaderDraftConfig.safeParse({ ...next, brand: { ...next.brand, logoDescription: 'x'.repeat(301) } }).success,
    ).toBe(false)
  })
  it('keeps a no-logo header valid without a description', () => {
    expect(HeaderDraftConfig.safeParse(validHeader()).success).toBe(true)
  })
})
