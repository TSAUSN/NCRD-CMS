import {
  SCRIPTLESS_PREVIEW_CSP,
  SCRIPTLESS_RENDER_OPTIONS,
  scriptlessPreviewHtml,
} from '../../../../../../lib/scriptless-preview.ts'
import { notFound } from 'next/navigation'
import { ThemeTokens } from '@cms/schema'
import { renderPage } from '@cms/renderer'
import { asUser } from '@cms/platform'
import { buildPreview } from '../../../../../../lib/queries.ts'
import { currentSession } from '../../../../../../lib/session.ts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await context.params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('Invalid preview request.', { status: 400 })
  }
  if (!body || typeof body !== 'object') return new Response('Invalid preview request.', { status: 400 })
  const input = body as { versionId?: unknown; tokens?: unknown }
  const versionId = typeof input.versionId === 'string' ? input.versionId : ''
  const parsed = ThemeTokens.safeParse(input.tokens)
  if (!versionId || !parsed.success) return new Response('Invalid design preview.', { status: 400 })

  // The separate lookup binds the chosen version to this site under the
  // reader's own RLS visibility. A UUID from another tenant becomes a 404.
  const belongs = await asUser(
    { userId: session.principal.userId },
    async client =>
      (
        await client.query<{ ok: boolean }>('SELECT true AS ok FROM page_versions WHERE id = $1 AND site_id = $2', [
          versionId,
          siteId,
        ])
      ).rows[0]?.ok === true,
  )
  if (!belongs) notFound()
  const preview = await buildPreview(session.principal.userId, versionId, siteId)
  if (!preview) notFound()
  const { html } = renderPage({
    manifest: preview.manifest,
    shell: { ...preview.shell, theme: parsed.data },
    isStaging: true,
    navigationPaths: preview.navigationPaths,
    options: SCRIPTLESS_RENDER_OPTIONS,
  })
  return new Response(scriptlessPreviewHtml(html), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
      'content-security-policy': SCRIPTLESS_PREVIEW_CSP,
      'x-robots-tag': 'noindex, nofollow',
    },
  })
}
