/** Closed shared-report layout metadata; it grants no content or publishing rights. */
export const REPORT_PARTS = {
  cover: 'core-photo-banner',
  links: 'core-report-page-links',
  mission: 'core-text-image',
  vision: 'core-feature-tiles',
  metrics: 'core-stats',
  letters: 'core-report-letters',
  country: 'core-report-country-story',
  fact: 'core-report-country-story',
  regions: 'core-report-regions',
  world: 'core-story-world',
  financial: 'core-report-financial',
  give: 'core-contact-cards',
  directory: 'core-faq',
  closing: 'core-cta-band',
} as const
export type ReportPart = keyof typeof REPORT_PARTS
export const REPORT_BANDS = [
  'cover',
  'links',
  'mission',
  'vision',
  'metrics',
  'letters',
  'disaster',
  'business',
  'trafficking',
  'education',
  'global',
  'financial',
  'give',
  'directory',
  'closing',
] as const
export function reportPart(slug: string | undefined, values: Record<string, unknown>): ReportPart | null {
  const part = values.__cms_report_part
  return values.__cms_report_template === 'annual' &&
    typeof part === 'string' &&
    Object.hasOwn(REPORT_PARTS, part) &&
    REPORT_PARTS[part as ReportPart] === slug
    ? (part as ReportPart)
    : null
}
export function reportBand(
  slug: string | undefined,
  values: Record<string, unknown>,
): (typeof REPORT_BANDS)[number] | null {
  return reportPart(slug, values) && REPORT_BANDS.includes(values.__cms_report_band as (typeof REPORT_BANDS)[number])
    ? (values.__cms_report_band as (typeof REPORT_BANDS)[number])
    : null
}
