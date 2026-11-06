import { SITE_FONT_REGISTRY, type SiteFontKey } from '@cms/schema'
export type ManifestFont = { assetId: string; fontKey: SiteFontKey }
/** Only code-owned declarations and governed UUID URLs reach the document head. */
export function renderSiteFontCss(input: unknown): string {
  if (!Array.isArray(input) || input.length > 7) return ''
  const seen = new Set<string>(),
    output: string[] = []
  for (const value of input) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.fontKey !== 'string' ||
      !Object.hasOwn(SITE_FONT_REGISTRY, value.fontKey) ||
      typeof value.assetId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.assetId)
    )
      return ''
    if (seen.has(value.fontKey)) continue
    seen.add(value.fontKey)
    const font = SITE_FONT_REGISTRY[value.fontKey as SiteFontKey]
    output.push(
      `@font-face{font-family:'${font.family}';src:url('/assets/${value.assetId}') format('${font.format}');font-weight:${font.weight};font-style:${font.style};font-display:swap}`,
    )
  }
  return output.join('')
}
