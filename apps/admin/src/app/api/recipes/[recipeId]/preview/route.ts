import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { renderPage, type RenderManifest } from '@cms/renderer'
import { currentSession } from '../../../../../lib/session.ts'
import { readSitePreview } from '../../../../../lib/site-preview.ts'
import {
  SCRIPTLESS_PREVIEW_CSP,
  SCRIPTLESS_RENDER_OPTIONS,
  scriptlessPreviewHtml,
} from '../../../../../lib/scriptless-preview.ts'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ recipeId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { recipeId } = await context.params
  const params = new URL(request.url).searchParams
  const version = params.get('version') ?? ''
  const targetSite = params.get('site')
  if (
    ![recipeId, version, ...(targetSite ? [targetSite] : [])].every(value =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    )
  )
    notFound()
  const preview = await asUser(
    { userId: session.principal.userId },
    async client => {
      const recipe = (
        await client.query<{ site_id: string }>('SELECT site_id FROM page_recipes WHERE id=$1', [recipeId])
      ).rows[0]
      if (!recipe) return null
      const available = (
        await client.query('SELECT id FROM page_recipe_versions WHERE id=$1 AND recipe_id=$2', [version, recipeId])
      ).rowCount
      if (!available) return null
      const site = await readSitePreview(client, targetSite ?? recipe.site_id, 'draft')
      if (!site) return null
      const manifest = (
        await client.query<{ manifest: RenderManifest }>('SELECT app.preview_page_recipe($1,$2) AS manifest', [
          recipeId,
          version,
        ])
      ).rows[0]!.manifest
      return { ...site, manifest: { ...manifest, fonts: site.fonts } }
    },
    { isolation: 'repeatable read' },
  )
  if (!preview) notFound()
  const { html } = renderPage({ ...preview, isStaging: true, options: SCRIPTLESS_RENDER_OPTIONS })
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
