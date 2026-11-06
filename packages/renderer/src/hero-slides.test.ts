import { expect, it } from 'vitest'
import type { SlotDef } from '@cms/schema'
import { compileSection } from './compile.ts'
import { renderPage, type SiteShell } from './render.ts'
import { renderHeroSlides } from './hero-slides.ts'
import { heroSlidesScriptHash, HERO_SLIDES_RUNTIME } from './hero-slides-runtime.ts'
import { fixedRuntimeFile, fixedRuntimeTag } from './fixed-runtime-files.ts'
const slot: SlotDef = {
  id: 'slides',
  kind: 'repeat',
  label: 'Hero slides',
  constraints: {
    heroSlides: true,
    item: {
      unit: 'Slide',
      min: 0,
      max: 12,
      fields: [{ id: 'title', kind: 'text', label: 'Heading', constraints: {} }],
    },
  },
}
const values = {
  slides: { items: ['i1', 'i2', 'i3'] },
  slides__i1__title: '[First]',
  slides__i2__title: '[Second]',
  slides__i2__enabled: 'off',
  slides__i3__title: '[Third]',
}
const html =
  '<div class="national-slider cms-hero-slider">' +
  ['i1', 'i2', 'i3']
    .map(key => '<article class="national-hero cms-hero-slide"><h2>' + key + '</h2></article>')
    .join('') +
  '</div>'
it('provides unique anchors, the icon-set next chevron and every available slide without JavaScript', () => {
  const result = renderHeroSlides(html, 3, slot, values)
  expect(result).toContain('id="cms-hero-s3-i1"')
  expect(result).toContain('id="cms-hero-s3-i3"')
  expect(result).not.toContain('>i2<')
  expect(result).toContain('href="#cms-hero-s3-i3"')
  expect(result).not.toContain('aria-label="Previous slide"')
  expect(result).toContain('<path d="m9 6 6 6-6 6"')
  expect(result).not.toContain('›')
  expect(result).toContain('aria-label="Next slide"')
  expect(result).toContain('Slide 2 of 2')
  expect(result).not.toContain('<script')
  expect(renderHeroSlides(html, 4, slot, values)).toContain('id="cms-hero-s4-i1"')
  expect(renderHeroSlides(html, 3, slot, { ...values, slides__i1__enabled: 'off', slides__i3__enabled: 'off' })).toBe(
    '',
  )
  expect(
    renderHeroSlides('<h1>[Page title]</h1>' + html, 3, slot, {
      ...values,
      slides__i1__enabled: 'off',
      slides__i3__enabled: 'off',
    }),
  ).toBe('<h1>[Page title]</h1>')
  expect(renderHeroSlides(html, 3, slot, values, true)).toContain('id="cms-hero-s3-i2"')
})
it('renders the real repeated template and opts only that page into one fixed script', () => {
  const compiled = compileSection({
    sourceHtml:
      '<div class="national-slider cms-hero-slider">{{#slides}}<article class="national-hero cms-hero-slide"><h2>{{title}}</h2></article>{{/slides}}</div>',
    sourceCss: '',
    slots: [slot],
  })
  expect(compiled.problems).toEqual([])
  const shell: SiteShell = {
    site: { id: 'site', slug: 'sample', name: '[Site]' },
    theme: {},
    navigation: [],
    canonical_host: null,
    staging_host: 'sample.localhost',
  }
  const manifest = {
    page: { id: 'page', version_id: 'version', title: '[Page]', path: '/' },
    meta: {},
    sections: [
      {
        instance: { section_def_id: 'hero', section_def_version: 1, values },
        def: {
          section_def_id: 'hero',
          slug: 'core-feature-slider',
          version: 1,
          compiled_ast: compiled.ast,
          css: compiled.css,
          slots: [slot],
          css_policy_version: compiled.ast.cssPolicyVersion,
        },
      },
    ],
  }
  const output = renderPage({ shell, manifest, isStaging: true }).html
  expect(renderPage({ shell, manifest, isStaging: true, options: { preview: true } }).html).toContain(
    'data-cms-hero="slides"',
  )
  expect(output).toContain('data-cms-hero="slides"')
  expect(output).toContain('[First]')
  expect(output).not.toContain('[Second]')
  expect(output).toContain(HERO_SLIDES_RUNTIME)
  expect(renderPage({ shell, manifest, isStaging: true, options: { providerEmbeds: false } }).html).not.toContain(
    '<script',
  )
  const tag = fixedRuntimeTag('hero', true),
    name = /src="[^\"]+\/([^/\"]+)"/.exec(tag)![1]!
  expect(fixedRuntimeFile(name)?.integrity).toBe(heroSlidesScriptHash())
  expect(fixedRuntimeFile(name + 'x')).toBeNull()
})

it('shows one slide without controls and freezes editing from the first canvas render', () => {
  const single = { slides: { items: ['i1'] }, slides__i1__title: '[One]' },
    markup = '<div class="cms-hero-slider"><article class="cms-hero-slide">[One]</article></div>'
  expect(renderHeroSlides(markup, 0, slot, single)).not.toContain('cms-hero-controls')
  expect(renderHeroSlides(markup, 0, slot, single, true)).toContain('data-cms-hero-editing="true"')
  expect(renderHeroSlides(markup, 0, slot, single)).not.toContain('data-cms-hero-editing')
})
it('keeps every active slide beyond the former twelve-slide ceiling', () => {
  const keys = Array.from({ length: 14 }, (_, i) => 'i' + (i + 1)),
    values = { slides: { items: keys } },
    html =
      '<div class="cms-hero-slider">' +
      keys.map(key => '<article class="cms-hero-slide">' + key + '</article>').join('') +
      '</div>'
  const output = renderHeroSlides(
    html,
    0,
    { ...slot, constraints: { ...slot.constraints, item: { ...(slot.constraints.item as object), max: 48 } } },
    values,
  )
  expect(output).toContain('Slide 14 of 14')
  expect(output).toContain('id="cms-hero-s0-i14"')
})
