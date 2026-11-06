/** Closed code-owned output, never HTML or script supplied by a field. */
export const SITE_WIDGETS = ['chapter-search', 'chapter-directory', 'contact-form', 'site-search'] as const
export type SiteWidget = (typeof SITE_WIDGETS)[number]
export function siteWidget(
  slot: { kind?: string; constraints?: Record<string, unknown> } | undefined,
): SiteWidget | null {
  const value = slot?.kind === 'text' ? slot.constraints?.['siteWidget'] : null
  return typeof value === 'string' && (SITE_WIDGETS as readonly string[]).includes(value) ? (value as SiteWidget) : null
}
