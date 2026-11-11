// The public contract (SPEC §6.8, §9): what a crawler or a browser with
// JavaScript disabled actually receives.
import { describe, expect, it } from 'vitest'
import { CSS_POLICY_VERSION } from './css.ts'
import { sectionScopeSelector, compileSection } from './compile.ts'
import { renderPage, themeCss, type ManifestSection, type RenderManifest, type SiteShell } from './render.ts'
import { stripPreviewInstrumentation } from './preview-runtime.ts'

const compiled = compileSection({
  sourceHtml: '<section class="hero"><h1>{{heading}}</h1><p>{{intro}}</p></section>',
  sourceCss: '.hero{padding:4rem}',
  slots: [
    { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
    { id: 'intro', kind: 'text', label: 'Intro', constraints: {} },
  ],
  // The same scope the renderer validates against. Compiling under a different
  // one produces CSS this definition is not allowed to emit.
  scopeSelector: sectionScopeSelector('hero') ?? undefined,
})

const hero: ManifestSection = {
  instance: {
    section_def_id: 'd1',
    section_def_version: 1,
    values: { heading: 'Explore the Index', intro: 'Data with dignity.' },
  },
  def: {
    section_def_id: 'd1',
    version: 1,
    slug: 'hero',
    compiled_ast: compiled.ast,
    css: compiled.css,
    css_policy_version: CSS_POLICY_VERSION,
  },
}

const manifest = (over: Partial<RenderManifest> = {}): RenderManifest => ({
  page: { id: 'p1', version_id: 'v1', title: 'Home', path: '/' },
  meta: { description: 'The home page.' },
  sections: [hero],
  ...over,
})

const shell = (over: Partial<SiteShell> = {}): SiteShell => ({
  site: { id: 's1', name: 'Site A', slug: 'site-a' },
  theme: {
    colors: { primary: '#003087', ink: '#111' },
    fonts: { heading: 'Georgia, serif', body: 'system-ui' },
    radius: '0.5rem',
  },
  navigation: [
    { label: 'Home', target: { type: 'page', page_id: 'p1' }, visible: true },
    { label: 'Hidden', target: { type: 'page', page_id: 'p2' }, visible: false },
    { label: 'External', target: { type: 'url', url: 'https://example.org' }, visible: true },
  ],
  canonical_host: 'example.com',
  staging_host: 'site-a.staging.example.test',
  ...over,
})

describe('sharing image URLs', () => {
  it('uses the verified canonical origin even from staging and with a different authored canonical path', () => {
    const { html } = renderPage({
      manifest: manifest({
        meta: { social_image: '/media/00000000-0000-4000-a000-000000000001/wide', canonical: '/resources' },
      }),
      shell: shell(),
      isStaging: true,
    })
    expect(html).toContain(
      'property="og:image" content="https://example.com/media/00000000-0000-4000-a000-000000000001/wide"',
    )
  })
  it('uses staging until a verified live host exists, and preserves an external HTTPS image', () => {
    const local = renderPage({
      manifest: manifest({ meta: { social_image: '/photo.jpg' } }),
      shell: shell({ canonical_host: null }),
      isStaging: true,
      options: { canonicalBase: 'https://site-a.staging.example.test' },
    })
    expect(local.html).toContain('property="og:image" content="https://site-a.staging.example.test/photo.jpg"')
    const external = renderPage({
      manifest: manifest({ meta: { social_image: 'https://images.example.org/share.jpg' } }),
      shell: shell(),
      isStaging: false,
    })
    expect(external.html).toContain('property="og:image" content="https://images.example.org/share.jpg"')
  })
  it('omits unsafe or credential-bearing image addresses', () => {
    for (const social_image of [
      '//evil.example/share.jpg',
      'javascript:alert(1)',
      'https://user:secret@example.org/share.jpg',
      'mailto:person@example.org',
    ]) {
      expect(
        renderPage({ manifest: manifest({ meta: { social_image } }), shell: shell(), isStaging: false }).html,
      ).not.toContain('property="og:image"')
    }
  })
})

describe('a published page is complete without JavaScript', () => {
  const { html } = renderPage({ manifest: manifest(), shell: shell(), isStaging: false, navigationPaths: { p1: '/' } })

  it('contains the real heading as an h1', () => {
    expect(html).toContain('<h1>Explore the Index</h1>')
  })

  it('contains the content text', () => {
    expect(html).toContain('Data with dignity.')
  })

  it('carries the title and description', () => {
    expect(html).toContain('<title>Home</title>')
    expect(html).toContain('<meta name="description" content="The home page.">')
  })

  it('carries a canonical URL built from the live host', () => {
    expect(html).toContain('<link rel="canonical" href="https://example.com/">')
  })

  it('carries Open Graph metadata', () => {
    expect(html).toContain('<meta property="og:title" content="Home">')
    expect(html).toContain('<meta property="og:url" content="https://example.com/">')
  })

  it('renders navigation as real links and a native phone disclosure without scripts', () => {
    expect(html).toContain('<details class="cms-phone-menu"><summary>Menu</summary>')
    expect(html).toContain('<nav class="cms-site-nav" aria-label="Main on phone">')
    expect(html).toContain('<nav class="cms-site-nav cms-desktop-nav" aria-label="Main">')
    expect(html).toContain('<a href="/">Home</a>')
    expect(html).toContain('<a href="https://example.org">External</a>')
  })

  it('ships a usable themed header rather than an unstyled list', () => {
    expect(html).toContain('<header class="cms-site-header">')
    expect(html).toContain('<a class="cms-site-brand" href="/">Site A</a>')
    expect(html).toContain('<ul class="cms-nav-list">')
    expect(html).toContain('.cms-site-nav .cms-nav-list{list-style:none')
    expect(html).toContain('.cms-site-nav .cms-nav-item:focus-within>.cms-nav-submenu{display:grid}')
  })

  it('turns the bounded button theme into one public button contract', () => {
    const css = themeCss({
      colors: { primary: '#003087', primaryContrast: '#ffffff' },
      buttons: {
        style: 'outline',
        color: 'primary',
        radius: '1rem',
        weight: 'bold',
        hover: 'lift',
        speed: 'slow',
      },
      spacing: 'spacious',
    })
    expect(css).toContain('--button-radius:1rem')
    expect(css).toContain('--button-speed:300ms')
    expect(css).toContain('background:transparent;color:var(--button-bg)')
    expect(css).toContain('transform:translateY(-2px)')
  })

  it('omits nav items marked hidden', () => {
    expect(html).not.toContain('Hidden')
  })

  it('drops a nav item whose page is no longer published rather than linking nowhere', () => {
    const { html: withMissing } = renderPage({
      manifest: manifest(),
      shell: shell({ navigation: [{ label: 'Gone', target: { type: 'page', page_id: 'missing' }, visible: true }] }),
      isStaging: false,
    })
    expect(withMissing).not.toContain('Gone')
    expect(withMissing).not.toContain('<nav')
  })

  it('inlines theme tokens and section CSS — no external stylesheet, no font CDN', () => {
    expect(html).toContain('--color-primary:#003087')
    expect(html).toContain('.hero{padding:4rem}')
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
    expect(html).not.toMatch(/https?:\/\/fonts\./)
  })

  it('offers a skip link and a main landmark', () => {
    expect(html).toContain('href="#cms-main"')
    expect(html).toContain('<main id="cms-main">')
  })

  it('contains no editor instrumentation', () => {
    expect(html).not.toContain('data-cms-')
  })
})

describe('indexing', () => {
  it('asks to be indexed on a live host', () => {
    const { html, noindex } = renderPage({ manifest: manifest(), shell: shell(), isStaging: false })
    expect(noindex).toBe(false)
    expect(html).toContain('<meta name="robots" content="index,follow">')
  })

  it('never asks to be indexed on a staging host, whatever the page says', () => {
    const { html, noindex } = renderPage({
      manifest: manifest({ meta: { description: 'x', noindex: false } }),
      shell: shell(),
      isStaging: true,
    })
    expect(noindex).toBe(true)
    expect(html).toContain('content="noindex,nofollow"')
  })

  it('honours a page-level noindex on a live host', () => {
    const { noindex } = renderPage({
      manifest: manifest({ meta: { noindex: true } }),
      shell: shell(),
      isStaging: false,
    })
    expect(noindex).toBe(true)
  })
})

describe('a font stack from a CDN is refused rather than fetched', () => {
  it('drops a font value that is a URL', () => {
    const { html } = renderPage({
      manifest: manifest(),
      shell: shell({ theme: { fonts: { heading: 'https://fonts.example.com/x.css', body: 'system-ui' } } }),
      isStaging: false,
    })
    expect(html).not.toContain('fonts.example.com')
    expect(html).toContain('--font-body:system-ui')
  })
})

describe('preview and live differ only by instrumentation', () => {
  const live = renderPage({ manifest: manifest(), shell: shell(), isStaging: false, navigationPaths: { p1: '/' } })
  const preview = renderPage({
    manifest: manifest(),
    shell: shell(),
    isStaging: false,
    navigationPaths: { p1: '/' },
    options: { preview: true },
  })

  it('produces identical content once the instrumentation is stripped', () => {
    expect(stripPreviewInstrumentation(preview.html)).toBe(live.html)
  })

  it('public output contains no script, whatever the preview adds', () => {
    expect(live.html).not.toMatch(/<script/i)
    expect(preview.html).toMatch(/<script/i)
  })

  it('public output carries no selectable wrappers', () => {
    expect(live.html).not.toContain('data-cms-slot')
    expect(preview.html).toContain('data-cms-slot')
  })
})

describe('per-breakpoint visibility is bounded, not free layout', () => {
  it('emits the hide class and the matching media query', () => {
    const { html } = renderPage({
      manifest: manifest({
        sections: [{ ...hero, instance: { ...hero.instance, hidden_at: ['sm'] } }],
      }),
      shell: shell(),
      isStaging: false,
    })
    expect(html).toContain('cms-hide-sm')
    expect(html).toContain('@media (max-width:767px){.cms-hide-sm{display:none !important}}')
  })
})

describe('self-hosted reading fonts', () => {
  it('loads only the selected local font faces, with regular and bold weights', () => {
    const selected = themeCss({
      fonts: { heading: "'Source Serif 4', Georgia, serif", body: "'Open Sans', Arial, sans-serif" },
    })
    for (const name of ['source-serif-4', 'open-sans'])
      for (const weight of [400, 700])
        expect(selected).toContain(`/cms-samples/fonts/${name}-latin-${weight}-normal.woff2`)
    expect(selected).not.toMatch(/https?:\/\//)
    const device = themeCss({ fonts: { heading: 'Georgia, serif', body: 'system-ui' } })
    expect(device).not.toContain('source-serif-4')
    expect(device).not.toContain('open-sans')
  })
})

describe('published per-site Analytics', () => {
  const settings = {
    schemaVersion: 1,
    name: 'Site A',
    analytics: { measurementId: 'G-ABCD123456', enabled: true, includeStaging: false },
  }
  it('adds the configured ID only to opted-in published pages', () => {
    const publicPage = renderPage({ manifest: manifest(), shell: shell({ settings }), isStaging: false })
    expect(publicPage.html).toContain('https://www.googletagmanager.com/gtag/js?id=G-ABCD123456')
    expect(publicPage.analyticsMeasurementId).toBe('G-ABCD123456')
    expect(renderPage({ manifest: manifest(), shell: shell(), isStaging: false }).html).not.toContain(
      'googletagmanager',
    )
    for (const options of [
      { preview: true },
      { visitorPreview: true },
      { sectionOnly: true },
      { providerEmbeds: false },
    ]) {
      const privatePage = renderPage({ manifest: manifest(), shell: shell({ settings }), isStaging: false, options })
      expect(privatePage.html).not.toContain('googletagmanager')
      expect(privatePage.analyticsMeasurementId).toBeUndefined()
    }
  })
  it('keeps test addresses excluded until separately enabled and keeps each site ID separate', () => {
    expect(renderPage({ manifest: manifest(), shell: shell({ settings }), isStaging: true }).html).not.toContain(
      'googletagmanager',
    )
    const other = { ...settings, analytics: { measurementId: 'G-OTHER12345', enabled: true, includeStaging: true } }
    const page = renderPage({ manifest: manifest(), shell: shell({ settings: other }), isStaging: true })
    expect(page.html).toContain('id=G-OTHER12345')
    expect(page.html).not.toContain('G-ABCD123456')
    expect(
      renderPage({
        manifest: manifest(),
        shell: shell({ settings: { ...settings, analytics: { ...settings.analytics, enabled: false } } }),
        isStaging: false,
      }).analyticsMeasurementId,
    ).toBeUndefined()
  })
})
