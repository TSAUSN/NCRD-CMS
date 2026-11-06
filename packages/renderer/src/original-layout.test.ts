import { describe, it, expect } from 'vitest'
import { compileSection } from './compile.ts'
import { renderPage, type RenderManifest, type SiteShell } from './render.ts'
import { originalRoot, originalTemplateHeader } from './original-layout.ts'
const id = '11111111-1111-4111-a111-111111111111',
  pageId = '22222222-2222-4222-a222-222222222222'
const source =
  '<section id="speakers" class="cards-1"><div class="swiper-container"><div class="swiper-wrapper"><article class="swiper-slide" data-name="Ada"><h2>Ada</h2></article></div></div><button type="button" data-bs-toggle="collapse" aria-controls="menu">Menu</button></section>'
const def = {
  section_def_id: id,
  version: 1,
  slug: 'original',
  compiled_ast: compileSection({ sourceHtml: source, slots: [] }).ast,
}
const manifest: RenderManifest = {
  page: { id: pageId, version_id: 'v', title: 'Source', path: '/' },
  meta: {},
  sections: [{ def, instance: { section_def_id: id, section_def_version: 1, values: {} } }],
}
const original = {
  version: 1,
  definitions: [{ section_def_id: id, section_def_version: 1 }],
  pages: [
    {
      pageId,
      html: { lang: 'en', class: 'source-site' },
      body: { 'data-bs-spy': 'scroll', 'data-bs-target': '.fixed-top' },
      header: false,
      footer: false,
    },
  ],
}
const shell: SiteShell = {
  site: { id: 'site', name: 'Source', slug: 'source' },
  theme: { fonts: { heading: 'serif', body: 'sans-serif' } },
  navigation: [],
  canonical_host: null,
  staging_host: null,
  site_files: { versionId: id, files: [], bundle: { version: 1, files: [], scripts: [], styles: [], original } },
}
const render = (input: RenderManifest = manifest, view: SiteShell = shell, preview = false) =>
  renderPage({ manifest: input, shell: view, isStaging: true, options: { preview, previewRuntime: false } }).html
describe('original document renderer', () => {
  it('preserves source classes, markup and data attributes without inventing layout wrappers', () => {
    const html = render()
    expect(html).toContain('<html lang="en" class="source-site">')
    expect(html).toContain('<body data-bs-spy="scroll" data-bs-target=".fixed-top">' + source + '</body>')
    expect(html).not.toContain('<main')
    expect(html).not.toContain('cms-skip')
    expect(html).not.toContain('cms-section--original')
    expect(html).not.toContain('body{margin:')
    expect(html).not.toContain('h1:not(')
    expect(html).toContain('--site-brand:')
    expect(html).not.toContain('<script')
  })
  it('uses the old browser layout only for an exact reviewed boolean on this page', () => {
    const projection = shell.site_files as { bundle: Record<string, unknown> },
      withMode = (quirks: unknown): SiteShell => ({
        ...shell,
        site_files: {
          ...projection,
          bundle: { ...projection.bundle, original: { ...original, pages: [{ ...original.pages[0], quirks }] } },
        },
      })
    expect(render()).toMatch(/^<!doctype html>/)
    expect(render(manifest, withMode(true))).toMatch(/^<html /)
    expect(render(manifest, withMode(false))).toMatch(/^<!doctype html>/)
    expect(render(manifest, withMode('true'))).toMatch(/^<!doctype html>/)
    expect(render({ ...manifest, page: { ...manifest.page, id } }, withMode(true))).toMatch(/^<!doctype html>/)
  })
  it('adds selection to the actual source root only in the editor', () => {
    const html = render(manifest, shell, true)
    expect(html).toContain('<section data-cms-section="0" data-cms-def="' + id + '"')
    expect(html).toContain('id="speakers" class="cards-1"')
    expect(html).not.toContain('<div id="s0"')
    expect(render()).not.toContain('data-cms-')
  })
  it('uses reviewed defaults only for new pages and preserves explicit imported-page choices', () => {
    const projection = shell.site_files as { bundle: Record<string, unknown> },
      view: SiteShell = {
        ...shell,
        site_files: {
          ...projection,
          bundle: {
            ...projection.bundle,
            original: {
              ...original,
              newPages: {
                html: { lang: 'en', class: 'new-page' },
                body: { class: 'original-body' },
                header: false,
                footer: false,
                quirks: false,
              },
            },
          },
        },
      }
    const added = render({ ...manifest, page: { ...manifest.page, id } }, view)
    expect(added).toContain('<html lang="en" class="new-page">')
    expect(added).toContain('<body class="original-body">')
    expect(added).not.toContain('<main')
    expect(added).toMatch(/^<!doctype html>/)
    expect(render(manifest, view)).toContain('<html lang="en" class="source-site">')
    expect(render(manifest, view)).not.toContain('original-body')
    expect(render({ ...manifest, page: { ...manifest.page, id: pageId.toUpperCase() } }, view)).toContain(
      '<html lang="en" class="source-site">',
    )
  })
  it('preserves exact authored frame roots and annotates them only in the editor', () => {
    const headerId = '33333333-3333-4333-a333-333333333333',
      footerId = '44444444-4444-4444-a444-444444444444'
    const header = {
      section_def_id: headerId,
      version: 1,
      slug: 'original-header',
      compiled_ast: compileSection({ sourceHtml: '<nav class="navbar fixed-top">Original menu</nav>', slots: [] }).ast,
    }
    const footer = {
      section_def_id: footerId,
      version: 1,
      slug: 'original-footer',
      compiled_ast: compileSection({ sourceHtml: '<footer class="footer">Original footer</footer>', slots: [] }).ast,
    }
    const projection = shell.site_files as { versionId: string; files: unknown[]; bundle: Record<string, unknown> }
    const framed: SiteShell = {
      ...shell,
      header: {
        schemaVersion: 2,
        enabled: true,
        sticky: false,
        component: { section_def_id: headerId, section_def_version: 1, values: {} },
      },
      footer: {
        schemaVersion: 2,
        enabled: true,
        component: { section_def_id: footerId, section_def_version: 1, values: {} },
      },
      header_component: header,
      footer_component: footer,
      site_files: {
        ...projection,
        bundle: {
          ...projection.bundle,
          original: {
            ...original,
            definitions: [
              ...original.definitions,
              { section_def_id: headerId, section_def_version: 1 },
              { section_def_id: footerId, section_def_version: 1 },
            ],
            pages: [{ ...original.pages[0], header: true, footer: true }],
          },
        },
      },
    }
    const html = render(manifest, framed)
    expect(html).toContain(
      '<nav class="navbar fixed-top">Original menu</nav>' + source + '<footer class="footer">Original footer</footer>',
    )
    expect(html).not.toContain('<header class="cms-frame')
    const preview = render(manifest, framed, true)
    expect(preview).toContain('<nav data-cms-frame="header" class="navbar fixed-top">')
    expect(preview).toContain('<footer data-cms-frame="footer" class="footer">')
    const framedFiles = framed.site_files as typeof projection & { bundle: { original: typeof original } }
    const defaults = {
      ...framed,
      site_files: {
        ...framedFiles,
        bundle: {
          ...framedFiles.bundle,
          original: {
            ...framedFiles.bundle.original,
            newPages: { html: { lang: 'en' }, body: {}, header: true, footer: true },
          },
        },
      },
    }
    const newPage = render({ ...manifest, page: { ...manifest.page, id } }, defaults)
    expect(newPage).toContain('<nav data-cms-template-header="" class="navbar fixed-top">')
    expect(newPage).toContain('position:sticky!important;top:0!important')
    expect(newPage).not.toContain('<script')
    expect(render(manifest, defaults)).not.toContain('data-cms-template-header')
    expect(render(manifest, { ...framed, header: { ...(framed.header as object), sticky: true } })).toContain(
      'cms-frame--sticky',
    )
  })
  it('keeps unapproved pages, missing/changed versions and ordinary sites on the existing rendering path', () => {
    expect(render({ ...manifest, page: { ...manifest.page, id } })).toContain('<main id="cms-main">')
    expect(render({ ...manifest, sections: [{ ...manifest.sections[0]!, def: { ...def, version: 2 } }] })).toContain(
      '<div id="s0" class="cms-section cms-section--original"',
    )
    expect(render(manifest, { ...shell, site_files: undefined })).toContain('body{margin:')
    const projection = shell.site_files as { bundle: unknown }
    expect(render(manifest, { ...shell, site_files: { ...projection, files: [], unexpected: true } })).toContain(
      '<main id="cms-main">',
    )
  })
  it('continues to hide sections and apply declared device visibility on the authored root', () => {
    const section = manifest.sections[0]!
    expect(
      render({ ...manifest, sections: [{ ...section, instance: { ...section.instance, hidden: true } }] }),
    ).not.toContain('swiper-slide')
    const html = render({
      ...manifest,
      sections: [{ ...section, instance: { ...section.instance, hidden_at: ['sm'] } }],
    })
    expect(html).toContain('class="cards-1 cms-hide-sm"')
    expect(html).toContain('@media (max-width:767px){.cms-hide-sm{display:none !important}}')
  })
  it('themes newly added CMS sections without applying the theme to original elements', () => {
    const buttonDef = {
      section_def_id: 'new-card',
      version: 1,
      slug: 'new-card',
      slots: [{ id: 'action', kind: 'button' as const, label: 'Action', constraints: {} }],
      compiled_ast: compileSection({
        sourceHtml: '<section><h2>New card</h2>{{action}}</section>',
        slots: [{ id: 'action', kind: 'button', label: 'Action', constraints: {} }],
      }).ast,
    }
    const html = render({
      ...manifest,
      sections: [
        ...manifest.sections,
        {
          def: buttonDef,
          instance: {
            section_def_id: 'new-card',
            section_def_version: 1,
            values: { action: { label: 'New action', url: '/details' } },
          },
        },
      ],
    })
    expect(html).toContain(source)
    expect(html).toContain('class="cms-button"')
    expect(html).toContain(':where(#s1) .cms-button{')
    expect(html).not.toContain(':where(#s0)')
    expect(html).not.toContain('body{margin:')
  })
  it('does not bypass field, AST or stylesheet sanitization', () => {
    const bad = {
      ...def,
      compiled_ast: {
        ...def.compiled_ast,
        nodes: [{ kind: 'html' as const, value: '<script>alert(1)</script>' }],
        policyVersion: 999,
      },
    }
    expect(render({ ...manifest, sections: [{ ...manifest.sections[0]!, def: bad }] })).not.toContain('alert(1)')
  })
  it('keeps normal wrappers for multi-root fragments and explicit custom styling', () => {
    expect(originalRoot('<p>One</p><p>Two</p>', '')).toBeNull()
    const section = manifest.sections[0]!
    expect(
      render({
        ...manifest,
        sections: [{ ...section, instance: { ...section.instance, custom_css: 'h2{color:red}' } }],
      }),
    ).toContain('<div id="s0"')
  })
  it('keeps attributes safely quoted and modifies classes without double escaping entities', () => {
    const changed = originalRoot('<section class="a &amp; b">Text</section>', ' data-cms-section="0"', ['cms-hide-sm'])
    expect(changed).toBe('<section data-cms-section="0" class="a &amp; b cms-hide-sm">Text</section>')
  })
  it('leaves ordinary and non-fixed source headers untouched by new-template flow handling', () => {
    for (const body of [
      '<nav class="navbar">Menu</nav>',
      '<header class="fixed-top">Menu</header>',
      '<p>One</p><p>Two</p>',
    ])
      expect(originalTemplateHeader(body)).toEqual({ html: body, css: '' })
  })
})

it('omits unavailable original pictures from public and editor output without changing saved content', () => {
  const sourceHtml = '<section><h2>Picture remains editable</h2><img src="{{picture}}" alt="{{picture}}"></section>'
  const compiled = compileSection({
    sourceHtml,
    slots: [{ id: 'picture', kind: 'image', label: 'Picture', constraints: {} }],
  })
  const values = { picture: { src: '/images/unavailable-original.png', alt: 'Missing original' } }
  const input: RenderManifest = {
    ...manifest,
    sections: [
      {
        def: {
          ...def,
          compiled_ast: compiled.ast,
          slots: [{ id: 'picture', kind: 'image', label: 'Picture', constraints: {} }],
        },
        instance: { ...manifest.sections[0]!.instance, values },
      },
    ],
  }
  for (const preview of [false, true]) {
    const html = render(input, shell, preview)
    expect(html).not.toContain('/images/unavailable-original.png')
    expect(html).not.toContain('<img')
    expect(html).toContain('Picture remains editable')
  }
  expect(input.sections[0]!.instance.values).toEqual(values)
})
