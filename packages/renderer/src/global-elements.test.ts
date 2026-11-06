import { describe, expect, it } from 'vitest'
import { renderPage, type RenderManifest, type SiteShell } from './render.ts'

const HOME_ID = '11111111-1111-4111-8111-111111111111'
const ABOUT_ID = '22222222-2222-4222-8222-222222222222'
const LOGO_ID = '33333333-3333-4333-8333-333333333333'
const COMPACT_LOGO_ID = '44444444-4444-4444-8444-444444444444'

const manifest: RenderManifest = {
  page: { id: HOME_ID, version_id: 'version-1', title: 'Home', path: '/' },
  meta: {},
  sections: [],
}

const baseShell = (): SiteShell => ({
  site: { id: 'site-1', name: 'Baseline Site', slug: 'baseline' },
  theme: { colors: { primary: '#003087', ink: '#172033', surface: '#ffffff' } },
  navigation: [
    { label: 'Home', visible: true, target: { type: 'page', page_id: HOME_ID } },
    { label: 'About', visible: true, target: { type: 'page', page_id: ABOUT_ID } },
  ],
  canonical_host: 'example.test',
  staging_host: null,
})

const header = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  enabled: true,
  preset: 'standard',
  brand: {
    siteName: 'Configured Site',
    showName: true,
    logoMediaId: null,
    compactLogoMediaId: null,
  },
  surface: 'page',
  sticky: false,
  utilityLinks: [],
  cta: null,
  ...over,
})

const footer = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  enabled: true,
  preset: 'simple',
  brand: { siteName: 'Configured Site', blurb: '', showFoundation: false },
  groups: [],
  contact: null,
  social: [],
  legal: { copyright: '© 2026 Configured Site', privacy: null, accessibility: null, terms: null },
  ...over,
})

const render = (
  over: Partial<SiteShell> = {},
  paths: Record<string, string> = { [HOME_ID]: '/', [ABOUT_ID]: '/about' },
) => renderPage({ manifest, shell: { ...baseShell(), ...over }, isStaging: false, navigationPaths: paths }).html

describe('global-element compatibility and refusal', () => {
  it('keeps the baseline brand and responsive navigation when both configs are absent', () => {
    const html = render()
    expect(html).toContain(
      '<header class="cms-site-header"><div class="cms-site-header-inner">' +
        '<a class="cms-site-brand" href="/">Baseline Site</a><nav class="cms-site-nav cms-desktop-nav" aria-label="Main">',
    )
    expect(html).toContain('<footer class="cms-site-footer"><p>Baseline Site</p></footer>')
    expect(html).not.toContain('cms-global-header')
    expect(html).not.toContain('cms-global-footer')
  })

  it('uses the same baseline for legacy or corrupt config rather than hiding the shell', () => {
    const absent = render()
    const legacy = render({ header: { preset: 'v0' }, footer: ['old'] })
    const bodyOf = (html: string) => html.slice(html.indexOf('<body>'))
    expect(bodyOf(legacy)).toBe(bodyOf(absent))
    expect(legacy).not.toContain('cms-global-header')
  })

  it('honours an explicit disabled decision', () => {
    const html = render({ header: header({ enabled: false }), footer: footer({ enabled: false }) })
    expect(html).not.toContain('<header')
    expect(html).not.toContain('<footer')
    expect(html).toContain('<main id="cms-main">')
  })

  it('rejects an over-capacity header and a structurally unknown footer as whole configs', () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      label: `Link ${index}`,
      target: { type: 'url', url: `/link-${index}` },
    }))
    const html = render({
      header: header({ utilityLinks: five }),
      footer: footer({ surprise: true }),
    })
    expect(html).toContain('<a class="cms-site-brand" href="/">Baseline Site</a>')
    expect(html).toContain('<footer class="cms-site-footer"><p>Baseline Site</p></footer>')
    expect(html).not.toContain('Link 0')
  })
})

describe('configured header', () => {
  it.each(['standard', 'centered', 'compact', 'minimal'] as const)(
    'renders the %s preset as a bounded modifier',
    preset => {
      const html = render({ header: header({ preset }) })
      expect(html).toContain(`cms-global-header--${preset}`)
    },
  )

  it.each(['page', 'soft', 'primary', 'accent', 'transparent'] as const)('renders the %s semantic surface', surface => {
    const html = render({ header: header({ surface }) })
    expect(html).toContain(`cms-surface--${surface}`)
  })

  // SPEC §6 step 4: an optional partner beside the brand, as HNI's own header has.
  it('names a partner beside the brand, linked only through a safe address, and costs nothing without one', () => {
    const linked = render({
      header: header({
        partner: { label: 'In partnership with', name: 'Lilly <School>', url: 'https://philanthropy.example.test/' },
      }),
    })
    expect(linked).toContain(
      '<p class="cms-global-header-partner"><span>In partnership with</span> <a href="https://philanthropy.example.test/">Lilly &lt;School&gt;</a></p>',
    )
    expect(linked).toContain('.cms-global-header-partner{')
    expect(linked).toContain('@media(max-width:767px){.cms-global-header-partner{display:none}}')
    const named = render({ header: header({ partner: { label: 'With', name: 'A partner', url: null } }) })
    expect(named).toContain('<p class="cms-global-header-partner"><span>With</span> <strong>A partner</strong></p>')
    // A stored address the link rules refuse is not followed; the name stays.
    const unsafe = render({
      header: header({ partner: { label: 'With', name: 'A partner', url: 'javascript:alert(1)' } }),
    })
    expect(unsafe).not.toContain('javascript:')
    // Headers without a partner render exactly as before.
    const plain = render({ header: header() })
    expect(plain).not.toContain('cms-global-header-partner')
    expect(render({ header: header({ partner: null }) })).toBe(plain)
  })

  it('renders sticky behavior as CSS and not client JavaScript', () => {
    const html = render({ header: header({ sticky: true }) })
    expect(html).toContain('cms-global-header--sticky')
    expect(html).toContain('.cms-global-header--sticky{position:sticky;top:0}')
    expect(html).not.toContain('<script')
  })

  it('escapes the configured brand and always exposes the site name accessibly', () => {
    const html = render({
      header: header({
        brand: { siteName: '<Site & Friends>', showName: true, logoMediaId: null, compactLogoMediaId: null },
      }),
    })
    expect(html).toContain('aria-label="&lt;Site &amp; Friends&gt;"')
    expect(html).toContain('<span class="cms-site-brand-name">&lt;Site &amp; Friends&gt;</span>')
    expect(html).not.toContain('<Site & Friends>')
  })

  it('uses governed media routes, responsive compact art, reserved dimensions, and non-duplicated alt text', () => {
    const html = render({
      header: header({
        brand: {
          siteName: 'Logo Site',
          showName: false,
          logoMediaId: LOGO_ID,
          compactLogoMediaId: COMPACT_LOGO_ID,
        },
      }),
    })
    expect(html).toContain(`/media/${LOGO_ID}/wide`)
    expect(html).toContain(`/media/${COMPACT_LOGO_ID}/thumbnail`)
    expect(html).toContain('width="240" height="72" alt="Logo Site"')
    expect(html).toContain('<source media="(max-width:767px)"')

    const named = render({
      header: header({
        brand: { siteName: 'Logo Site', showName: true, logoMediaId: LOGO_ID, compactLogoMediaId: null },
      }),
    })
    expect(named).toContain('width="240" height="72" alt=""')
    expect(named).toContain('<span class="cms-site-brand-name">Logo Site</span>')
  })

  it('uses the new preset logo description and keeps old versions on their name fallback', () => {
    const description = 'The Salvation Army Echelon — Mobilizing the next generation'
    const html = render({
      header: header({
        brand: {
          siteName: 'Echelon',
          showName: false,
          logoMediaId: LOGO_ID,
          compactLogoMediaId: null,
          logoDescription: description,
        },
      }),
    })
    expect(html).toContain('alt="' + description + '"')
    expect(html).toContain('aria-label="' + description + '"')
    const visible = render({
      header: header({
        brand: {
          siteName: 'Echelon',
          showName: true,
          logoMediaId: LOGO_ID,
          compactLogoMediaId: null,
          logoDescription: description,
        },
      }),
    })
    expect(visible).toContain('width="240" height="72" alt=""')
    expect(visible).toContain('<span class="cms-site-brand-name">Echelon</span>')
  })

  it('falls back to a visible name if an author hides the name without supplying a logo', () => {
    const html = render({
      header: header({
        brand: { siteName: 'Still Named', showName: false, logoMediaId: null, compactLogoMediaId: null },
      }),
    })
    expect(html).toContain('<span class="cms-site-brand-name">Still Named</span>')
  })

  it('uses the authoritative shell name when a shape-valid stored brand name is empty', () => {
    const html = render({
      header: header({ brand: { siteName: '', showName: false, logoMediaId: LOGO_ID, compactLogoMediaId: null } }),
      footer: footer({ brand: { siteName: '', blurb: '', showFoundation: false } }),
    })
    expect(html).toContain('aria-label="Baseline Site"')
    expect(html).toContain('width="240" height="72" alt="Baseline Site"')
    expect(html).toContain('<p class="cms-global-footer-name">Baseline Site</p>')
  })

  it('keeps the primary menu solely owned by navigation and renders utility links separately', () => {
    const html = render({
      header: header({
        utilityLinks: [
          { label: 'About utility', target: { type: 'page', page_id: ABOUT_ID } },
          { label: 'Help', target: { type: 'url', url: 'https://help.example.test' } },
        ],
      }),
    })
    expect(html.match(/aria-label="Main"/g)).toHaveLength(1)
    expect(html.match(/>Home<\/a>/g)).toHaveLength(2)
    expect(html).toContain('<nav class="cms-global-utility" aria-label="Utility">')
    expect(html).toContain('<a href="/about">About utility</a>')
    expect(html).toContain('<a href="https://help.example.test">Help</a>')
  })

  it('drops page targets with no published path', () => {
    const html = render(
      {
        header: header({
          utilityLinks: [{ label: 'Missing', target: { type: 'page', page_id: ABOUT_ID } }],
          cta: { label: 'Also missing', target: { type: 'page', page_id: ABOUT_ID } },
        }),
      },
      { [HOME_ID]: '/' },
    )
    expect(html).not.toContain('Missing')
    expect(html).not.toContain('Also missing')
  })

  it('routes its CTA through the one governed button theme hook', () => {
    const html = render({ header: header({ cta: { label: 'Donate', target: { type: 'url', url: '/donate' } } }) })
    expect(html).toContain('<a class="cms-button cms-global-header-cta" href="/donate">Donate</a>')
    expect(html).toContain('.cms-button{box-sizing:border-box')
  })

  it('fails the whole config closed when a URL target uses executable markup', () => {
    const html = render({
      header: header({ utilityLinks: [{ label: 'Bad', target: { type: 'url', url: 'javascript:alert(1)' } }] }),
    })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('Bad')
    expect(html).toContain('<a class="cms-site-brand" href="/">Baseline Site</a>')
  })
})

describe('configured footer', () => {
  it.each(['simple', 'columns', 'contact'] as const)('renders the %s preset as a bounded modifier', preset => {
    expect(render({ footer: footer({ preset }) })).toContain(`cms-global-footer--${preset}`)
  })

  it('renders escaped brand, foundation, grouped resolved links, and omits missing page targets', () => {
    const html = render({
      footer: footer({
        brand: { siteName: 'Site <A>', blurb: 'Serving & helping.', showFoundation: true },
        groups: [
          {
            heading: 'Explore & learn',
            links: [
              { label: 'About', target: { type: 'page', page_id: ABOUT_ID } },
              { label: 'Gone', target: { type: 'page', page_id: '55555555-5555-4555-8555-555555555555' } },
            ],
          },
        ],
      }),
    })
    expect(html).toContain('<p class="cms-global-footer-name">Site &lt;A&gt;</p>')
    expect(html).toContain('Serving &amp; helping.')
    expect(html).toContain('The Salvation Army')
    expect(html).toContain('aria-label="Explore &amp; learn"')
    expect(html).toContain('<a href="/about">About</a>')
    expect(html).not.toContain('Gone')
  })

  it('renders contact fields in semantic, escaped markup', () => {
    const html = render({
      footer: footer({
        contact: {
          heading: 'Contact us',
          address: '100 Main St\nAlexandria, VA',
          phone: '+1 202 555 0100',
          email: 'help@example.test',
        },
      }),
    })
    expect(html).toContain('<section class="cms-global-footer-contact"><h2>Contact us</h2>')
    expect(html).toContain('<address>100 Main St\nAlexandria, VA</address>')
    expect(html).toContain('href="tel:+1 202 555 0100"')
    expect(html).toContain('href="mailto:help@example.test"')
  })

  it('renders only the closed social service set with safe https targets', () => {
    const html = render({
      footer: footer({
        social: [
          { service: 'facebook', url: 'https://facebook.com/example' },
          { service: 'x', url: 'https://x.com/example' },
        ],
      }),
    })
    expect(html).toContain('<nav class="cms-global-footer-social" aria-label="Social media">')
    expect(html).toContain('>Facebook</a>')
    expect(html).toContain('>X</a>')
  })

  it('renders the legal row and refuses unresolved legal page links', () => {
    const html = render({
      footer: footer({
        legal: {
          copyright: '© 2026 <Site>',
          privacy: { label: 'Privacy', target: { type: 'page', page_id: ABOUT_ID } },
          accessibility: { label: 'Accessibility', target: { type: 'url', url: '/accessibility' } },
          terms: { label: 'Missing terms', target: { type: 'page', page_id: '55555555-5555-4555-8555-555555555555' } },
        },
      }),
    })
    expect(html).toContain('© 2026 &lt;Site&gt;')
    expect(html).toContain('<nav aria-label="Legal">')
    expect(html).toContain('<a href="/about">Privacy</a>')
    expect(html).toContain('<a href="/accessibility">Accessibility</a>')
    expect(html).not.toContain('Missing terms')
  })
})

describe('public global-element contract', () => {
  it('preserves skip/header/main/footer landmarks, focus treatment, reduced motion, and responsive layouts without JS', () => {
    const html = render({
      header: header({ cta: { label: 'Give', target: { type: 'url', url: '/give' } } }),
      footer: footer({
        groups: [{ heading: 'More', links: [{ label: 'About', target: { type: 'page', page_id: ABOUT_ID } }] }],
      }),
    })
    const skip = html.indexOf('<a class="cms-skip"')
    const headerAt = html.indexOf('<header')
    const main = html.indexOf('<main id="cms-main">')
    const footerAt = html.indexOf('<footer')
    expect(skip).toBeLessThan(headerAt)
    expect(headerAt).toBeLessThan(main)
    expect(main).toBeLessThan(footerAt)
    expect(html).toContain(':focus-visible')
    expect(html).toContain('@media(prefers-reduced-motion:reduce)')
    expect(html).toContain('@media(max-width:767px)')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/on(click|load|error)=/i)
  })
})
