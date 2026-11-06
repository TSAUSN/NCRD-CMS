import { it, expect } from 'vitest'
import { panelPresentationCss } from './panel-presentation.ts'
import { renderPage, themeCss, type SiteShell } from './render.ts'
it('opts native pages into measured panels without adding layout rules to ordinary themes', () => {
  const presentation = { kind: 'panels' as const, canvas: '#d9d9d9' },
    css = themeCss({ presentation, radius: '1.25rem' })
  expect(css).toContain('--site-canvas:#d9d9d9')
  expect(css).toContain('#cms-main>.cms-section{')
  expect(css).toContain('--radius:1.25rem')
  expect(css).toContain('var(--site-panel-shadow)')
  expect(css).toContain('@media(max-width:767px){body{padding:.75rem}')
  expect(themeCss({})).not.toContain('--site-panel-width')
  expect(themeCss({ presentation }, false, true)).not.toContain('#cms-main')
})
it('refuses arbitrary presentation or CSS injection at the renderer boundary', () => {
  for (const value of [
    undefined,
    null,
    'panels',
    { kind: 'unknown', canvas: '#d9d9d9' },
    { kind: 'panels', canvas: '</style><script>run()</script>' },
    { kind: 'panels', canvas: 'url(https://example.test)' },
  ])
    expect(panelPresentationCss(value)).toBe('')
})
it('keeps section-only catalogue previews compact even when the site uses national panels', () => {
  const shell: SiteShell = {
    site: { id: '11111111-1111-4111-a111-111111111111', slug: 'sample', name: '[Site]' },
    theme: { presentation: { kind: 'panels', canvas: '#d9d9d9' } },
    navigation: [],
    canonical_host: null,
    staging_host: null,
  }
  const manifest = {
    page: {
      id: '22222222-2222-4222-a222-222222222222',
      version_id: '33333333-3333-4333-a333-333333333333',
      title: '[Page]',
      path: '/',
    },
    sections: [],
    meta: {},
  }
  expect(renderPage({ manifest, shell, isStaging: true, options: { sectionOnly: true } }).html).not.toContain(
    '--site-panel-width',
  )
  expect(renderPage({ manifest, shell, isStaging: true }).html).toContain('--site-panel-width')
})

it('adds small caps only to native site headings when explicitly selected', () => {
  expect(panelPresentationCss({ kind: 'panels', canvas: '#d9d9d9', headings: 'small-caps' })).toContain(
    '#cms-main h1,#cms-main h2{font-variant:small-caps}#cms-main h3{font-family:var(--font-body);font-variant:normal}',
  )
  expect(panelPresentationCss({ kind: 'panels', canvas: '#d9d9d9', headings: 'url(evil)' })).not.toContain(
    'font-variant',
  )
  expect(panelPresentationCss({ kind: 'panels', canvas: '#d9d9d9' })).not.toContain('font-variant')
})

it('selects the bounded national public layout without changing earlier panel sites', () => {
  const css = panelPresentationCss({ kind: 'panels', canvas: '#d9d9d9', headings: 'small-caps', layout: 'national' })
  expect(css).toContain('--national-max:1320px')
  expect(css).toContain('font:300 17px/1.6')
  expect(css).toContain('.cms-frame--header{position:sticky')
  expect(css).not.toContain('--site-panel-width')
  expect(panelPresentationCss({ kind: 'panels', canvas: '#d9d9d9' })).not.toContain('--national-max')
})
