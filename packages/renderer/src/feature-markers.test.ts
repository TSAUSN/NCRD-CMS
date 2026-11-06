import { expect, it } from 'vitest'
import { compileSection } from './compile.ts'
import { renderPage } from './render.ts'
import { escapeAttribute, escapeText } from './escape.ts'
import { hasNationalNavigation } from './national-navigation-runtime.ts'
import { hasEchelonDirectory } from './echelon-directory.ts'
import { hasHeroSlides } from './hero-slides-runtime.ts'
import { hasStoryWidgets } from './story-widgets-runtime.ts'
import { hasFaqFilter } from './faq-filter.ts'
import { hasScheduleFilter } from './schedule-filter.ts'
import { ECHELON_PRESENTATION_CSS } from './echelon-presentation.ts'
import { ECHELON_BODY_CSS } from './echelon-body-presentation.ts'
import { REPORT_TEXT_CSS } from './report-page-presentation.ts'
import { governedEmbedFrameSources } from './governed-embeds.ts'

const examples = [
  [hasNationalNavigation, 'class="national-header-row"'],
  [hasEchelonDirectory, 'data-cms-echelon-directory'],
  [hasHeroSlides, 'data-cms-hero="0"'],
  [hasStoryWidgets, 'data-cms-stories-widget="0"'],
  [hasFaqFilter, 'data-cms-faq-filter'],
  [hasScheduleFilter, 'data-cms-track-filter'],
] as const

for (const [detect, marker] of examples) {
  it(`does not enable ${marker} from text, comments or another attribute's value`, () => {
    for (const html of [
      '<p>' + escapeText(marker) + '</p>',
      '<p title="' + escapeAttribute(marker) + '">Content</p>',
      '<!-- <div ' + marker + '></div> -->',
      '<script>const example = ' + JSON.stringify('<div ' + marker + '></div>') + '</script>',
      '<textarea><div ' + marker + '></div></textarea>',
      '<template><div ' + marker + '></div></template>',
    ])
      expect(detect(html)).toBe(false)
  })
}

it('ordinary text cannot opt a page into Echelon/report styles or governed scripts', () => {
  const text =
    'class="echelon-example" class="echelon-template" sawso-report cms-material-symbols cms-data-source data-cms-site-widget="x" data-cms-provider-fullscreen ' +
    examples.map(([, marker]) => marker).join(' ')
  const compiled = compileSection({
    sourceHtml: '<section><h1>{{heading}}</h1><p>{{intro}}</p></section>',
    slots: [
      { id: 'heading', kind: 'text', label: 'Heading', constraints: {} },
      { id: 'intro', kind: 'text', label: 'Intro', constraints: {} },
    ],
  })
  const { html } = renderPage({
    manifest: {
      page: { id: 'p', version_id: 'v', title: 'Ordinary page', path: '/' },
      meta: {},
      sections: [
        {
          instance: { section_def_id: 'd', section_def_version: 1, values: { heading: 'Ordinary page', intro: text } },
          def: { section_def_id: 'd', version: 1, slug: 'plain', compiled_ast: compiled.ast },
        },
      ],
    },
    shell: {
      site: { id: 's', name: 'Example', slug: 'example' },
      navigation: [],
      theme: {},
      canonical_host: null,
      staging_host: null,
    },
    isStaging: true,
  })
  expect(html).toContain(escapeText(text))
  expect(html.includes(ECHELON_PRESENTATION_CSS)).toBe(false)
  expect(html.includes(ECHELON_BODY_CSS)).toBe(false)
  expect(html.includes(REPORT_TEXT_CSS)).toBe(false)
  expect(html).not.toContain('<script')
})

it('frame permissions come only from actual governed embed attributes', () => {
  expect(governedEmbedFrameSources('<p>data-cms-embed-provider="youtube"</p>')).toEqual([])
  expect(governedEmbedFrameSources('<div data-cms-embed-provider="youtube"></div>')).toEqual([
    'https://www.youtube-nocookie.com',
  ])
})

it('recognizes actual markers with ordinary HTML quoting and multiple classes', () => {
  expect(hasNationalNavigation('<header class="other national-header-row"></header>')).toBe(true)
  expect(hasEchelonDirectory("<section data-cms-echelon-directory='directory'></section>")).toBe(true)
  expect(hasHeroSlides('<section DATA-CMS-HERO=0></section>')).toBe(true)
  expect(hasStoryWidgets('<section data-cms-stories-widget="0"></section>')).toBe(true)
  expect(hasFaqFilter('<input data-cms-faq-filter>')).toBe(true)
  expect(hasScheduleFilter('<select data-cms-track-filter></select>')).toBe(true)
})
