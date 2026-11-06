import { reportSourceClosingLayout } from './report-source-layout.ts'
import { safeUrl } from './escape.ts'
import { parseHtml, type HtmlNode, type HtmlElement } from './source-html.ts'
import { reportPart, reportBand, repeatItemKeys } from '@cms/schema'
import type { ManifestSection } from './render.ts'
/** True when a field has visible text: tags and non-breaking spaces do not count. */
export const hasWords = (value: unknown) =>
  typeof value === 'string' && value.replace(/<[^>]*>|&nbsp;|&#160;|&#xa0;/gi, ' ').trim().length > 0
export const reportPhoto = (value: unknown) =>
  typeof value === 'string'
    ? Boolean(value.trim() && value !== '#')
    : Boolean(
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).src === 'string' &&
        String((value as Record<string, unknown>).src).trim() &&
        String((value as Record<string, unknown>).src) !== '#',
      )
const linked = (value: unknown) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    hasWords((value as Record<string, unknown>).url) &&
    safeUrl(String((value as Record<string, unknown>).url)) !== '#' &&
    hasWords((value as Record<string, unknown>).label),
  )
/** Marks the first element with exactly this tag and class as hidden. */
export const hideElement = (body: string, tag: string, cls: string) =>
  body.replace('<' + tag + ' class="' + cls + '">', '<' + tag + ' class="' + cls + '" hidden>')
function alias(body: string, from: string, to: string) {
  return body.replace(/class="([^"]*)"/g, (whole, value: string) =>
    value.split(/\s+/).includes(from) ? 'class="' + value + ' ' + to + '"' : whole,
  )
}
/** Button identity survives the editor's field wrappers and an omitted first action. */
function coverSecondaryButton(body: string, values: Record<string, unknown>): string {
  if (!linked(values.secondary)) return body
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const buttons: HtmlElement[] = []
  function walk(nodes: HtmlNode[], inside = false) {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      const classes = (node.attributes.find(a => a.name === 'class')?.value ?? '').split(/\s+/)
      const active = inside || classes.includes('national-actions')
      if (active && node.tag === 'a' && classes.includes('cms-button')) buttons.push(node)
      walk(node.children, active)
    }
  }
  walk(parsed.nodes)
  const source = buttons.at(-1)?.source
  if (!source) return body
  const opening = body
    .slice(source.start, source.openEnd)
    .replace(/class="([^"]*)"/, (whole, classes: string) =>
      classes.split(/\s+/).includes('ar-cover-secondary') ? whole : 'class="' + classes + ' ar-cover-secondary"',
    )
  return body.slice(0, source.start) + opening + body.slice(source.openEnd)
}
/** Omit only the native photo slot, leaving images inside rich text untouched. */
function withoutNativePhoto(body: string, slug: string): string {
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return body
  const ranges: { start: number; end: number }[] = []
  const classes = (node: HtmlElement) =>
    (node.attributes.find(attribute => attribute.name === 'class')?.value ?? '').split(/\s+/)
  function photoNodes(nodes: HtmlNode[]) {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (node.tag === 'img' && node.source) ranges.push(node.source)
      else if (node.tag === 'cms-slot') photoNodes(node.children)
    }
  }
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (slug === 'core-photo-banner' && classes(node).includes('national-hero')) {
        photoNodes(node.children)
        continue
      }
      if (slug === 'core-text-image' && classes(node).includes('row')) {
        const first = node.children.find(child => child.kind === 'element')
        if (first?.kind === 'element' && classes(first).includes('col-md-6')) photoNodes(first.children)
        continue
      }
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  for (const range of ranges.sort((a, b) => b.start - a.start))
    body = body.slice(0, range.start) + body.slice(range.end)
  return body
}
export function reportTemplateMarkup(
  body: string,
  slug: string | undefined,
  values: Record<string, unknown>,
  annualReport = false,
): string {
  if ((slug === 'core-photo-banner' || slug === 'core-text-image') && !reportPhoto(values.photo))
    body = withoutNativePhoto(body, slug)
  const part = reportPart(slug, values),
    index = slug === 'core-text-image' && (values.__cms_report_links === true || part === 'mission')
  if (slug === 'core-photo-banner') {
    if (!part || !hasWords(values.subheading)) body = hideElement(body, 'span', 'national-report-subheading')
    if (!part || !hasWords(values.caption)) body = hideElement(body, 'div', 'national-report-caption')
    if (!hasWords(values.intro)) body = hideElement(body, 'p', 'national-intro')
  }
  if (slug === 'core-text-image') {
    if (!index || !linked(values.report_page)) body = hideElement(body, 'span', 'core-report-page')
    if (!index || !linked(values.report_pdf)) body = hideElement(body, 'span', 'core-report-pdf')
    if (!index || (!linked(values.report_page) && !linked(values.report_pdf)))
      body = hideElement(body, 'div', 'core-report-actions')
  }
  if (slug === 'core-stats') {
    if (part !== 'metrics') body = hideElement(body, 'div', 'core-stats-intro')
    if (part !== 'metrics' || !hasWords(values.source)) body = hideElement(body, 'p', 'ar-small ar-source')
  }
  if (slug === 'core-contact-cards') {
    for (const [field, cls, tag] of [
      ['photo', 'national-contact-photo', 'figure'],
      ['extra', 'national-contact-extra', 'div'],
      ['questions', 'national-contact-questions', 'div'],
      ['small', 'national-contact-small', 'div'],
    ] as const)
      if (part !== 'give' || (field === 'photo' ? !reportPhoto(values[field]) : !hasWords(values[field])))
        body = hideElement(body, tag!, cls!)
  }
  if (slug === 'core-faq') {
    if (part !== 'directory' || !hasWords(values.source)) body = hideElement(body, 'p', 'report-directory-source')
    for (const [field, cls] of [
      ['count', 'core-faq-count'],
      ['open_label', 'core-faq-open'],
    ]) {
      let n = 0
      const keys = repeatItemKeys(values.questions)
      body = body.replace(new RegExp('<span class="' + cls + '">', 'g'), match =>
        part === 'directory' && hasWords(values['questions__' + keys[n++] + '__' + field])
          ? match
          : match.slice(0, -1) + ' hidden>',
      )
    }
  }
  if (
    slug === 'core-cta-band' &&
    (!part || !values.photo || (typeof values.photo === 'string' && !values.photo.trim()))
  )
    body = hideElement(body, 'div', 'core-report-closing-photo')
  if (!part) return body
  if (part === 'cover') {
    body = coverSecondaryButton(body, values)
    body = alias(body, 'national-hero', 'ar-hero-journey')
    body = alias(body, 'national-hero-copy', 'ar-container')
    body = alias(body, 'national-kicker', 'ar-eyebrow')
    body = alias(body, 'national-actions', 'ar-actions')
    body = alias(body, 'national-report-caption', 'ar-hero-caption')
    if (reportPhoto(values.photo)) body = body.replace(/<img\b/, '<img class="ar-photo ar-hero-image"')
  }
  if (part === 'vision') {
    body = hideElement(body, 'span', 'national-icon')
    body = alias(body, 'national-tiles', 'ar-vision-grid')
    body = body
      .replace('<ul', '<ul class="ar-report-list"')
      .replace('<ol', '<ol class="ar-sector-list"')
      .replace(/<li>0([1-9])(?=[A-Z])/g, '<li><span class="ar-sector-number">0$1</span> ')
  }
  if (part === 'metrics') {
    body = alias(body, 'core-grid', 'ar-metrics')
    body = alias(body, 'core-number', 'ar-stat-number')
    body = body.replace(/<article>/g, '<article class="ar-stat">')
    body = alias(body, 'core-stats-intro', 'ar-impact-layout')
    body = body.replace(/<img\b/, '<img class="ar-photo"').replace('<figcaption>', '<figcaption class="ar-small">')
  }
  if (part === 'country')
    body = body.replace(
      /<div class="ar-report-list">([\s\S]*?)<\/div>/,
      (whole, inside: string) =>
        '<div class="ar-impact-list">' + inside.replace('<ul>', '<ul class="ar-report-list">') + '</div>',
    )
  if (part === 'give') {
    body = alias(body, 'national-block-head', 'ar-section-title')
    body = alias(body, 'cms-button', 'ar-button')
  }
  if (part === 'world') body = alias(body, 'core-story-world', 'ar-live-map')
  if (part === 'directory') {
    body = alias(body, 'core-faq', 'ar-directory-content')
    body = body.replace(/<details>/g, '<details class="ar-directory-panel">')
  }
  if (part === 'closing')
    body = annualReport
      ? reportSourceClosingLayout(body, reportPhoto(values.photo))
      : alias(body, 'core-banner', 'ar-closing')
  return body
}
/** Explicit report identity survives inserting or moving a section before its cover. */
export function isReportTemplatePage(sections: readonly ManifestSection[]): boolean {
  return sections.some(
    section =>
      section.def.slug === 'core-photo-banner' &&
      reportPart(section.def.slug, section.instance.values ?? {}) === 'cover',
  )
}
/** Wrappers group normal instances;none of their content is page HTML. */
export function renderReportBands(sections: readonly ManifestSection[], html: readonly string[]): string {
  let result = '',
    active: string | null = null
  sections.forEach((section, index) => {
    if (!html[index]) return
    const band = reportBand(section.def.slug, section.instance.values ?? {})
    if (band !== active) {
      if (active) result += '</div>'
      if (band)
        result +=
          '<div class="ar-band cms-report-band cms-report-band--' +
          band +
          (band === 'metrics' ? ' ar-dark' : ['vision', 'give'].includes(band) ? ' ar-blue' : '') +
          '">'
      active = band
    }
    result += html[index] ?? ''
  })
  return result + (active ? '</div>' : '')
}
