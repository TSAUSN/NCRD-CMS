import { it, expect } from 'vitest'
import { reportTemplateMarkup, renderReportBands, isReportTemplatePage } from './report-template.ts'
import type { ManifestSection } from './render.ts'
it('uses only closed report metadata and keeps optional new fields out of ordinary sections', () => {
  const html =
    '<span class="national-report-subheading"></span><div class="national-report-caption"></div><p class="national-intro"></p>'
  expect(reportTemplateMarkup(html, 'core-photo-banner', {})).toContain('class="national-report-caption" hidden')
  expect(
    reportTemplateMarkup(html, 'core-photo-banner', {
      __cms_report_template: 'annual',
      __cms_report_part: 'cover',
      subheading: '[Report]',
      caption: '<p>[Caption]</p>',
    }),
  ).not.toContain('class="national-report-caption" hidden')
  const section = (band: string, part = 'country') =>
    ({
      def: {
        section_def_id: 'd',
        version: 1,
        compiled_ast: { nodes: [], policyVersion: 4, cssPolicyVersion: 6 },
        slug: 'core-report-country-story',
      },
      instance: {
        section_def_id: 'd',
        section_def_version: 1,
        values: { __cms_report_template: 'annual', __cms_report_part: part, __cms_report_band: band },
      },
    }) as ManifestSection
  const bands = renderReportBands(
    [section('disaster'), section('disaster'), section('business')],
    ['[One]', '[Two]', '[Three]'],
  )
  expect(bands).toContain('[One][Two]</div><div')
  expect(bands.match(/cms-report-band--disaster/g)).toHaveLength(1)
  expect(renderReportBands([section('x" onclick="bad')], ['[One]'])).toBe('[One]')
  expect(
    renderReportBands([section('disaster'), section('business'), section('disaster')], ['[One]', '', '[Two]']),
  ).toBe('<div class="ar-band cms-report-band cms-report-band--disaster">[One][Two]</div>')
})

it('applies readable report text ink in complete pages and individual report sections', async () => {
  const { compileSection, renderPage, CSS_POLICY_VERSION } = await import('./index.ts')
  const compiled = compileSection({
    sourceHtml: '<section class="sawso-report"><p class="ar-eyebrow">[Country]</p></section>',
    sourceCss: '.sawso-report{--ar-red:#ed1c2b;--ar-red-text:#ed1c2b}',
    scopeSelector: '.cms-section--core-report-country-story',
    slots: [],
  })
  const section = {
    def: {
      section_def_id: 'report',
      version: 1,
      slug: 'core-report-country-story',
      compiled_ast: compiled.ast,
      css: compiled.css,
      css_policy_version: CSS_POLICY_VERSION,
    },
    instance: { section_def_id: 'report', section_def_version: 1, values: {} },
  } as ManifestSection
  for (const annual of [false, true]) {
    if (annual)
      section.instance.values = {
        __cms_report_template: 'annual',
        __cms_report_part: 'country',
        __cms_report_band: 'disaster',
      }
    const html = renderPage({
      manifest: {
        page: { id: 'page', version_id: 'version', title: '[Report]', path: '/' },
        sections: [section],
        meta: {},
      },
      shell: {
        site: { id: 'site', slug: 'sample', name: '[Site]' },
        theme: {},
        navigation: [],
        canonical_host: null,
        staging_host: null,
      },
      isStaging: true,
    }).html
    const ink = html.match(/#cms-main \.sawso-report,#cms-main\.cms-report-page\{--ar-red-text:(#[a-f0-9]{6})\}/)?.[1]
    expect(ink).toBeDefined()
    const luminance = (colour: string) => {
      const values = [1, 3, 5]
        .map(index => parseInt(colour.slice(index, index + 2), 16) / 255)
        .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      return values.reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
    }
    for (const paper of ['#ffffff', '#f6f7f5'])
      expect((luminance(paper) + 0.05) / (luminance(ink!) + 0.05), paper).toBeGreaterThanOrEqual(4.5)
    expect(html).toContain('--ar-red:#ed1c2b')
    expect(html).toContain('[Country]')
  }
})

it('keeps the PDF action identity in public and wrapped editor markup, including without the first button', () => {
  const primary = '<a class="cms-button" href="#numbers">Read the report</a>',
    secondary = '<a class="cms-button" href="https://example.test/report.pdf">Download PDF</a>'
  const values = {
    __cms_report_template: 'annual',
    __cms_report_part: 'cover',
    secondary: { label: 'Download PDF', url: 'https://example.test/report.pdf' },
  }
  for (const actions of [
    primary + secondary,
    '<cms-slot data-cms-slot="primary">' +
      primary +
      '</cms-slot><cms-slot data-cms-slot="secondary">' +
      secondary +
      '</cms-slot>',
    secondary,
  ]) {
    const body = reportTemplateMarkup(
      '<div class="national-actions">' + actions + '</div>',
      'core-photo-banner',
      values,
    )
    expect(body.match(/ar-cover-secondary/g)).toHaveLength(1)
    expect(body).toContain('class="cms-button ar-cover-secondary" href="https://example.test/report.pdf"')
    expect(body).not.toContain('class="cms-button ar-cover-secondary" href="#numbers"')
  }
  expect(
    reportTemplateMarkup('<div class="national-actions">' + primary + '</div>', 'core-photo-banner', {
      ...values,
      secondary: null,
    }),
  ).not.toContain('ar-cover-secondary')
})

it('keeps the report presentation when an ordinary section precedes or follows its explicit cover', () => {
  const section = (slug: string, values: Record<string, unknown> = {}) =>
    ({ def: { slug }, instance: { values } }) as ManifestSection
  const ordinary = section('core-text-block'),
    cover = section('core-photo-banner', {
      __cms_report_template: 'annual',
      __cms_report_part: 'cover',
      __cms_report_band: 'cover',
    })
  expect(isReportTemplatePage([ordinary, cover])).toBe(true)
  expect(isReportTemplatePage([cover, ordinary])).toBe(true)
  expect(isReportTemplatePage([ordinary, section('core-photo-banner')])).toBe(false)
  expect(renderReportBands([ordinary, cover], ['[New section]', '[Cover]'])).toBe(
    '[New section]<div class="ar-band cms-report-band cms-report-band--cover">[Cover]</div>',
  )
})

it('omits empty native photo slots without removing rich-text images or imported markup', () => {
  const caption = '<div class="national-report-caption"><img src="/caption.png" alt="[Caption image]"></div>'
  const story =
    '<div class="col-12 col-md-6"><h2>[Heading]</h2><div class="core-text-image-body"><div class="row"><div class="col-md-6"><img src="/story.png" alt="[Story image]"></div></div><p>[Story]</p></div></div>'
  for (const wrap of [false, true]) {
    const photo = wrap ? '<cms-slot data-cms-slot="photo"><img src="" alt=""></cms-slot>' : '<img src="" alt="">'
    const cover = '<div class="national-hero">' + photo + caption + '</div>'
    const mission =
      '<div class="core"><div class="container"><div class="row"><div class="col-12 col-md-6">' +
      photo +
      '</div>' +
      story +
      '</div></div></div>'
    for (const empty of [undefined, '', '#', { src: '' }]) {
      const values = { photo: empty, __cms_report_template: 'annual', __cms_report_part: 'cover' }
      const rendered = reportTemplateMarkup(cover, 'core-photo-banner', values)
      expect(rendered).not.toContain('src=""')
      expect(rendered).toContain('<img src="/caption.png"')
      expect(rendered).not.toContain('ar-hero-image')
      const text = reportTemplateMarkup(mission, 'core-text-image', { photo: empty })
      expect(text).not.toContain('src=""')
      expect(text).toContain(story)
    }
    expect(reportTemplateMarkup(cover, 'imported-cover', {})).toBe(cover)
    expect(reportTemplateMarkup(mission, 'imported-story', {})).toBe(mission)
    const selected = mission.replace('src=""', 'src="/selected.png"')
    expect(reportTemplateMarkup(selected, 'core-text-image', { photo: { src: '/selected.png' } })).toContain(
      'src="/selected.png"',
    )
  }
})

it('gives native report actions the shared button treatment while preserving ordinary links', () => {
  const html =
    '<div class="national-actions"><cms-slot data-cms-slot="cards__i1__action"><a class="cms-button" href="/give">Give</a></cms-slot></div><p><a href="tel:18001234567">Call</a></p>'
  const values = { __cms_report_template: 'annual', __cms_report_part: 'give' }
  const result = reportTemplateMarkup(html, 'core-contact-cards', values)
  expect(result).toContain('class="cms-button ar-button" href="/give"')
  expect(result).toContain('<a href="tel:18001234567">Call</a>')
  expect(result).toContain('data-cms-slot="cards__i1__action"')
  expect(reportTemplateMarkup(html, 'core-contact-cards', {})).toContain('class="cms-button" href="/give"')
})

it('hides an unselected report contact photo and keeps selected photos visible', () => {
  const html = '<figure class="national-contact-photo"><img src="" alt=""></figure>'
  const values = { __cms_report_template: 'annual', __cms_report_part: 'give' }
  for (const photo of [undefined, '', '#', { src: '' }]) {
    expect(reportTemplateMarkup(html, 'core-contact-cards', { ...values, photo })).toContain(
      '<figure class="national-contact-photo" hidden>',
    )
  }
  expect(reportTemplateMarkup(html, 'core-contact-cards', { ...values, photo: { src: '/photo.png' } })).not.toContain(
    ' hidden',
  )
})
