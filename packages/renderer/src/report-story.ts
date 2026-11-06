import { reportBand, reportPart, repeatItemKeys } from '@cms/schema'
import { reportSourceStoryLayout } from './report-source-layout.ts'
import { hasWords, hideElement, reportPhoto } from './report-template.ts'
/** Optional story parts follow authored fields, including in editable previews. */
export function reportStoryMarkup(
  body: string,
  slug: string | undefined,
  values: Record<string, unknown>,
  annualReport = false,
): string {
  if (slug !== 'core-report-country-story') return body
  const impact = ['impact_heading', 'impact_before', 'impact_value', 'impact_after', 'impact'].some(key =>
    hasWords(values[key]),
  )
  const action = values.action && typeof values.action === 'object' ? (values.action as Record<string, unknown>) : null
  body = body.replace(/<a\b[^>]*>/g, tag =>
    tag.replace(/class="([^"]*)"/, (whole, classes: string) => {
      const names = classes.split(/\s+/)
      if (!names.includes('cms-button')) return whole
      if (!names.includes('ar-button')) names.push('ar-button')
      if (/^https?:/i.test(String(action?.url ?? '')) && !names.includes('ar-button-external'))
        names.push('ar-button-external')
      return 'class="' + names.join(' ') + '"'
    }),
  )
  if (!reportPhoto(values.photo)) body = hideElement(body, 'figure', 'ar-story-figure')
  const boundStats = values.stats && typeof values.stats === 'object' && 'readerKey' in values.stats
  if (!boundStats && repeatItemKeys(values.stats).length === 0) body = hideElement(body, 'div', 'ar-stat-grid')
  if (!hasWords(values.stats_heading)) body = hideElement(body, 'h3', 'ar-stats-heading')
  if (!hasWords(values.after_stats)) body = hideElement(body, 'div', 'ar-after-stats')
  if (!hasWords(values.photo_note)) body = hideElement(body, 'div', 'ar-photo-note ar-caption')
  if (!hasWords(values.continuation)) body = hideElement(body, 'div', 'ar-story-body')
  if (!hasWords(values.source)) body = hideElement(body, 'p', 'ar-small ar-source')
  if (!impact) body = body.replace('<div class="ar-program-impact">', '<div class="ar-program-impact" hidden>')
  if (!action || !hasWords(action.label) || !hasWords(action.url))
    body = body.replace('<aside class="ar-discover">', '<aside class="ar-discover" hidden>')
  if (annualReport && reportPart(slug, values) !== 'fact') {
    const band = reportBand(slug, values)
    body = reportSourceStoryLayout(
      body,
      values.layout,
      reportPhoto(values.photo),
      ['business', 'trafficking', 'education'].includes(band ?? ''),
    )
  }
  return body
}
