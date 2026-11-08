import { PREVIEW_FONT_STYLES, PREVIEW_FONT_FILES, PREVIEW_FONT_IMAGES } from './preview-font-policy.ts'
/** Private images require the authenticated document's origin. Scripts remain disabled. */
export const SCRIPTLESS_PREVIEW_SANDBOX = 'allow-same-origin'
/** Private renderers show provider descriptions rather than CSP-blocked frames. */
export const SCRIPTLESS_RENDER_OPTIONS = { providerEmbeds: false } as const
export const SCRIPTLESS_PREVIEW_META_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  `img-src 'self' data: ${PREVIEW_FONT_IMAGES}`,
  `style-src 'unsafe-inline' ${PREVIEW_FONT_STYLES}`,
  `font-src 'self' ${PREVIEW_FONT_FILES}`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "connect-src 'none'",
].join('; ')
export const SCRIPTLESS_PREVIEW_CSP = `${SCRIPTLESS_PREVIEW_META_CSP}; frame-ancestors 'self'; sandbox ${SCRIPTLESS_PREVIEW_SANDBOX}`

/** Only the authenticated immutable-file delivery route may supply linked local CSS.
 * Its session, file hash, MIME inspection and RLS checks still apply. */
function previewOrigin(origin?: string): string | null {
  if (!origin) return null
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.origin === origin
      ? origin
      : null
  } catch {
    return null
  }
}
/** Next may name its internal listener localhost; Host is what the browser addressed. */
export function previewRequestOrigin(request: Request): string | undefined {
  try {
    const listener = new URL(request.url)
    const authority = request.headers.get('host')?.trim() || listener.host
    const url = new URL(`${listener.protocol}//${authority}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined
    return previewOrigin(url.origin) ?? undefined
  } catch {
    return undefined
  }
}
export function previewStyleSource(origin?: string): string {
  const checked = previewOrigin(origin)
  return checked ? checked + '/site-files/' : ''
}
function previewMetaPolicy(origin?: string): string {
  const source = previewStyleSource(origin)
  return source
    ? SCRIPTLESS_PREVIEW_META_CSP.replace(
        `style-src 'unsafe-inline' ${PREVIEW_FONT_STYLES}`,
        `style-src 'unsafe-inline' ${PREVIEW_FONT_STYLES} ${source}`,
      )
    : SCRIPTLESS_PREVIEW_META_CSP
}
export function scriptlessPreviewCsp(origin?: string): string {
  return `${previewMetaPolicy(origin)}; frame-ancestors 'self'; sandbox ${SCRIPTLESS_PREVIEW_SANDBOX}`
}

/** Firefox resolves self against about:srcdoc in a copied meta policy.
 * Name the embedding image origin and its owned font paths explicitly.
 * This origin comes from the embedding window, never from authored content. */
export function scriptlessSrcDocPolicy(origin?: string): string {
  if (!origin) return SCRIPTLESS_PREVIEW_META_CSP
  const checked = previewOrigin(origin)
  if (!checked) return SCRIPTLESS_PREVIEW_META_CSP
  return previewMetaPolicy(checked)
    .replace(`img-src 'self' data: ${PREVIEW_FONT_IMAGES}`, `img-src 'self' ${origin} data: ${PREVIEW_FONT_IMAGES}`)
    .replace("font-src 'self'", `font-src 'self' ${origin}/cms-samples/fonts/ ${origin}/assets/ ${origin}/__cms/fonts/`)
}

/** Response headers do not travel with HTML copied into srcDoc. Put CSP first in its head. */
export function scriptlessPreviewHtml(html: string, origin?: string): string {
  // API previews already carry our default meta. Replace only that exact
  // generated policy; an independently authored restriction is never removed.
  html = html.replace(`<meta http-equiv="Content-Security-Policy" content="${SCRIPTLESS_PREVIEW_META_CSP}">`, '')
  const policy = `<meta http-equiv="Content-Security-Policy" content="${scriptlessSrcDocPolicy(origin)}">`
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${policy}`)
  return `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`
}
