import { PREVIEW_FONT_STYLES, PREVIEW_FONT_FILES, PREVIEW_FONT_IMAGES } from './preview-font-policy.ts'
/**
 * The admin's own pages send a Content Security Policy (AUTH-05). Until
 * October 6 only previews did, so script injected into an admin page — for
 * example through a rich-text paste defect in an editor dependency — would
 * have run with the editor's session. Scripts now need the per-request nonce
 * Next.js attaches to its own (`'strict-dynamic'` lets those load the rest);
 * approved Adobe font resources are also allowed for inherited srcDoc previews, and nothing else may frame the admin.
 * `data:` and `blob:` images cover upload previews and drawings; inline styles
 * are React's and the editor's.
 */
export function adminContentSecurityPolicy(nonce: string, development = false, canvasOrigin?: string | null): string {
  // A caller-controlled URL can never become a policy directive.
  const frameOrigin =
    canvasOrigin && /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(canvasOrigin) ? canvasOrigin : null
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline' ${PREVIEW_FONT_STYLES}`,
    `img-src 'self' data: blob: ${PREVIEW_FONT_IMAGES}`,
    `font-src 'self' data: ${PREVIEW_FONT_FILES}`,
    "connect-src 'self'",
    `frame-src 'self'${frameOrigin ? ` ${frameOrigin}` : ''}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
}

/** Routes that send their own policy (previews with their fixed script hash,
 * media, assets, APIs, health) keep it alone: two policies would both apply. */
export function hasOwnContentPolicy(pathname: string): boolean {
  return /^\/(?:preview|releases|api|media|assets|health)(?:\/|$)/.test(pathname)
}

export function contentPolicyNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64')
}
