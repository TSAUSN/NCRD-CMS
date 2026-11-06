import { it, expect } from 'vitest'
import { reportSourceClosingLayout, reportSourceStoryLayout } from './report-source-layout.ts'
import { reportStoryMarkup } from './report-story.ts'
import { parseHtml, type HtmlNode } from './source-html.ts'
const body =
  '<section><h2>[Section]</h2><article class="ar-country-story" data-report-layout="reading"><div class="ar-country-grid"><div class="ar-feature-heading"><p data-cms-slot="country">[Country]</p><h3 data-cms-slot="title">[Story]</h3></div><div class="ar-copy"><cms-slot data-cms-slot="body"><p>[Words &amp; a <a href="/details">link</a>]</p></cms-slot></div><figure class="ar-story-figure"><img src="/photo.jpg" alt="[Photo]" data-cms-slot="photo"><div class="ar-photo-note ar-caption" data-cms-slot="photo_note"><p>[Caption]</p></div></figure><h3 class="ar-stats-heading" data-cms-slot="stats_heading">[Stats]</h3><div class="ar-stat-grid"><span data-cms-number-id="number" data-cms-slot="stats__i1__value">152</span></div><div class="ar-after-stats" data-cms-slot="after_stats">[After]</div></div><div class="ar-story-body">[Continued]</div><div class="ar-program-impact">[Impact]</div><aside class="ar-discover">[Related]</aside></article><p>[Source]</p></section>'
function tree(html: string) {
  const parsed = parseHtml(html, { locations: true })
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw Error(parsed.refusal)
  return parsed.nodes
}
function elements(nodes: HtmlNode[], name: string): import('./source-html.ts').HtmlElement[] {
  return nodes.flatMap(node =>
    node.kind === 'element'
      ? [
          ...(node.attributes
            .find(a => a.name === 'class')
            ?.value.split(/\s+/)
            .includes(name)
            ? [node]
            : []),
          ...elements(node.children, name),
        ]
      : [],
  )
}
for (const layout of ['response', 'reading', 'feature'])
  it('preserves editable fields, bound numbers, safe links and source text in ' + layout + ' report columns', () => {
    const result = reportSourceStoryLayout(body, layout, true, false),
      nodes = tree(result)
    expect(result.match(/data-cms-slot="[^"]+"/g)?.sort()).toEqual(body.match(/data-cms-slot="[^"]+"/g)?.sort())
    expect(result).toContain(
      '<cms-slot data-cms-slot="body"><p>[Words &amp; a <a href="/details">link</a>]</p></cms-slot>',
    )
    expect(result).toContain('data-cms-number-id="number"')
    expect(result).toContain('<h2>[Section]</h2>')
    expect(result).toContain('<p>[Source]</p>')
    expect(result.match(/\[Impact\]/g)).toHaveLength(1)
    expect(elements(nodes, 'ar-country-grid')).toHaveLength(0)
    expect(result.match(/\[Caption\]/g)).toHaveLength(1)
    expect(
      elements(
        nodes,
        layout === 'response' ? 'ar-response-top' : layout === 'reading' ? 'ar-reading-copy' : 'ar-report-feature',
      ),
    ).toHaveLength(1)
  })
it('keeps a photo-free reading heading in its lead column and uses the supplied program treatment', () => {
  const result = reportSourceStoryLayout(body, 'reading', false, true),
    nodes = tree(result)
  expect(elements(nodes, 'ar-reading-head')).toHaveLength(1)
  expect(elements(nodes, 'ar-secondary-story')).toHaveLength(1)
  expect(result).not.toContain('data-cms-slot="photo"')
  expect(result.match(/data-cms-slot="title"/g)).toHaveLength(1)
})
it('leaves standalone country sections on their own library layout and hides an empty manual stats grid', () => {
  const values = {
    layout: 'reading',
    photo: { src: '/photo.jpg', alt: '[Photo]' },
    body: '[Words]',
    stats: { items: ['i1'] },
    stats_heading: '[Stats]',
    after_stats: '[After]',
    continuation: '[Continued]',
    impact: '[Impact]',
    action: { label: '[Related]', url: '/details' },
    source: '[Source]',
  }
  const ordinary = reportStoryMarkup(body, 'core-report-country-story', values)
  expect(ordinary).toContain('class="ar-country-grid"')
  expect(ordinary).not.toContain('class="ar-reading-copy"')
  expect(reportStoryMarkup(body, 'core-report-country-story', { ...values, stats: { items: [] } })).toContain(
    'class="ar-stat-grid" hidden',
  )
  expect(
    reportStoryMarkup(body, 'core-report-country-story', { ...values, stats: { readerKey: 'numbers' } }),
  ).not.toContain('class="ar-stat-grid" hidden')
})

it('uses the closing quote in its source frame and preserves wrapped heading/photo fields', () => {
  const original =
    '<section class="core"><div class="container"><div class="core-report-closing-photo"><cms-slot data-cms-slot="photo"><img src="/photo.jpg" alt="[Photo]"></cms-slot></div><div class="row"><div><h2><cms-slot data-cms-slot="heading">[Closing words]</cms-slot></h2><p></p></div><div class="core-actions"></div></div></div></section>'
  const result = reportSourceClosingLayout(original, true)
  tree(result)
  expect(result).toContain('class="ar-closing ar-band"')
  expect(result).toContain(
    '<div class="ar-container"><h2><cms-slot data-cms-slot="heading">[Closing words]</cms-slot></h2></div>',
  )
  expect(result).toContain('<cms-slot data-cms-slot="photo"><img src="/photo.jpg" alt="[Photo]"></cms-slot>')
  expect(result).not.toContain('class="row"')
  expect(reportSourceClosingLayout(original, false)).not.toContain('data-cms-slot="photo"')
})

it('keeps a headed supplemental fact with its source callout treatment', () => {
  const sample = body.replace('[After]', '<h3>[Fact heading]</h3><p>[Fact words]</p>'),
    result = reportSourceStoryLayout(sample, 'reading', true, true),
    nodes = tree(result)
  expect(elements(nodes, 'ar-fact')).toHaveLength(1)
  expect(result).toContain('<h3>[Fact heading]</h3><p>[Fact words]</p>')
})

it('gives a photo-free text introduction its brief column before full-width facts', () => {
  const result = reportSourceStoryLayout(body, 'text', false, false)
  const nodes = tree(result)
  expect(elements(nodes, 'ar-brief')).toHaveLength(1)
  expect(elements(nodes, 'ar-country-grid')).toHaveLength(0)
  expect(
    elements(nodes, 'ar-brief')[0]!.children.some(
      node =>
        node.kind === 'element' && node.attributes.some(attribute => attribute.value.includes('ar-stats-heading')),
    ),
  ).toBe(false)
  for (const field of ['title', 'body', 'stats_heading', 'stats__i1__value', 'after_stats']) {
    expect(result).toContain('data-cms-slot="' + field + '"')
  }
  expect(result).toContain('[Words &amp; a <a href="/details">link</a>]')
  expect(result).toContain('[Continued]')
  expect(result.match(/\[Impact\]/g)).toHaveLength(1)
  expect(result).not.toContain('data-cms-slot="photo"')
  expect(reportSourceStoryLayout(body, 'text', true, false)).toBe(body)
})

it('keeps the fact callout on its native compact frame inside an annual report', () => {
  const result = reportStoryMarkup(
    body,
    'core-report-country-story',
    {
      __cms_report_template: 'annual',
      __cms_report_part: 'fact',
      layout: 'text',
      title: '[Fact heading]',
      body: '<p>[Fact words]</p>',
      stats: { items: ['i1'] },
      stats__i1__value: '12',
    },
    true,
  )
  expect(result).toContain('class="ar-country-grid"')
  expect(result).toContain('class="ar-feature-heading"')
  expect(result).not.toContain('class="ar-brief"')
})
