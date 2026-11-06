import { asUser, configuredAuthProvider, resolvePrincipal, SESSION_COOKIE, HOSTED_SESSION_COOKIE } from '@cms/platform'
import type { NextRequest } from 'next/server'
import { canvasFrameOrigin } from './canvas-frame-origin.ts'
import { publicSiteOrigin } from './public-site-url.ts'
export function requestCanvasFrameOrigin(request: NextRequest): Promise<string | null> {
  return canvasFrameOrigin(request.nextUrl.pathname, {
    user: async () => {
      const provider = configuredAuthProvider(),
        token = request.cookies.get(provider.name === 'local' ? SESSION_COOKIE : HOSTED_SESSION_COOKIE)?.value
      if (!token) return null
      const subject = await provider.verify(token)
      return subject ? ((await resolvePrincipal(subject))?.principal.userId ?? null) : null
    },
    hostname: canvasSiteHostname,
    origin: publicSiteOrigin,
  })
}

export const canvasSiteHostname = (user: string, id: string, kind: 'page' | 'site' | 'fonts') =>
  asUser({ userId: user }, async client => {
    const where = kind === 'page' ? 's.id=(SELECT site_id FROM pages WHERE id=$1 AND archived_at IS NULL)' : 's.id=$1'
    const row = (
      await client.query<{ staging_hostname: string }>(
        `SELECT s.staging_hostname FROM sites s WHERE ${where} AND s.status<>'archived'
    AND (${kind === 'fonts' ? 'true' : 'false'} OR EXISTS(SELECT 1 FROM site_file_heads h JOIN site_file_versions v ON v.id IN(h.draft_version_id,h.published_version_id) WHERE h.site_id=s.id AND (jsonb_array_length(v.bundle->'files')>0 OR jsonb_array_length(COALESCE(v.bundle->'native','[]'))>0 OR v.bundle ? 'original')))`,
        [id],
      )
    ).rows[0]
    return row?.staging_hostname ?? null
  })
