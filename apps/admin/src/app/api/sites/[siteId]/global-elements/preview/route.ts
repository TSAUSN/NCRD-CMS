import { openCanvasTicket } from '../../../../../../lib/canvas-tickets.ts'
import { isStrictSameOriginRequest } from '../../../../../../lib/request-origin.ts'
import { readBoundedRequestBody } from '../../../../../../lib/request-body.ts'
import { canvasSiteHostname } from '../../../../../../lib/canvas-frame-policy.ts'
import {
  SCRIPTLESS_PREVIEW_CSP,
  SCRIPTLESS_RENDER_OPTIONS,
  scriptlessPreviewHtml,
} from '../../../../../../lib/scriptless-preview.ts'
import { notFound } from 'next/navigation'
import { FooterConfig, HeaderConfig, ThemeTokens, NavTree } from '@cms/schema'
import { renderPage, type SectionDefView } from '@cms/renderer'
import { asUser } from '@cms/platform'
import { buildPreview } from '../../../../../../lib/queries.ts'
import { sitePreviewContext } from '../../../../../../lib/preview-context.ts'
import { currentSession } from '../../../../../../lib/session.ts'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await context.params
  if (!UUID.test(siteId)) notFound()
  let body: unknown
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedRequestBody(request, 524288)))
  } catch {
    return new Response('Invalid preview request.', { status: 400 })
  }
  if (!body || typeof body !== 'object') return new Response('Invalid preview request.', { status: 400 })
  const input = body as {
    versionId?: unknown
    header?: unknown
    footer?: unknown
    previewContext?: unknown
    tokens?: unknown
    menu?: unknown
    isolated?: unknown
    channel?: unknown
    purpose?: unknown
  }
  if (
    input.isolated === true &&
    (!isStrictSameOriginRequest(request, process.env['TRUST_PROXY_HEADERS'] === 'true') ||
      typeof input.channel !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.channel))
  )
    return new Response('Open this preview from Site look.', { status: 403 })
  const versionId = typeof input.versionId === 'string' ? input.versionId : ''
  const header = HeaderConfig.safeParse(input.header)
  const footer = FooterConfig.safeParse(input.footer)
  const tokens = input.tokens === undefined ? null : ThemeTokens.safeParse(input.tokens),
    menu = input.menu === undefined ? null : NavTree.safeParse(input.menu)
  if ((tokens && !tokens.success) || (menu && !menu.success))
    return new Response('Invalid site look preview.', { status: 400 })
  if (!UUID.test(versionId) || !header.success || !footer.success) {
    return new Response('Invalid header or footer preview.', { status: 400 })
  }

  // Bind the selected page and every media id to this site through the reader's
  // RLS visibility before rendering browser-supplied draft state. The renderer
  // also fails closed, but preview must not become a cross-tenant media oracle.
  // Preset logos and any media an authored frame's image fields name.
  const componentMedia = [header.data, footer.data].flatMap(config =>
    config.schemaVersion === 2
      ? Object.values(config.component.values).flatMap(value =>
          value && typeof value === 'object' && typeof (value as { media_id?: unknown }).media_id === 'string'
            ? [(value as { media_id: string }).media_id]
            : [],
        )
      : [],
  )
  const references = [
    ...(header.data.schemaVersion === 1 ? [header.data.brand.logoMediaId, header.data.brand.compactLogoMediaId] : []),
    ...componentMedia,
  ].filter((id): id is string => id !== null)
  if (references.some(id => !UUID.test(id))) return new Response('Invalid image reference.', { status: 400 })
  let pageId = ''
  let components: { header: SectionDefView | null; footer: SectionDefView | null } = { header: null, footer: null }
  const belongs = await asUser({ userId: session.principal.userId }, async client => {
    const page = (
      await client.query<{ page_id: string }>('SELECT page_id FROM page_versions WHERE id = $1 AND site_id = $2', [
        versionId,
        siteId,
      ])
    ).rows[0]?.page_id
    pageId = page ?? ''
    if (!page) return false
    components = (
      await client.query<{ header: SectionDefView | null; footer: SectionDefView | null }>(
        `SELECT app.preview_global_component($1, 'header', $2) AS header,
              app.preview_global_component($1, 'footer', $3) AS footer`,
        [siteId, JSON.stringify(header.data), JSON.stringify(footer.data)],
      )
    ).rows[0]!
    if (references.length === 0) return true
    const media = await client.query<{ count: string }>(
      `SELECT count(DISTINCT id)::text AS count FROM media
        WHERE id = ANY($1::uuid[]) AND status = 'ready' AND deleted_at IS NULL
          AND (site_id = $2 OR site_id IS NULL)`,
      [references, siteId],
    )
    return Number(media.rows[0]?.count ?? 0) === new Set(references).size
  })
  if (!belongs) notFound()

  if (input.isolated === true) {
    if (
      !tokens?.success ||
      !menu?.success ||
      !(await canvasSiteHostname(
        session.principal.userId,
        siteId,
        input.purpose === 'fonts' || input.purpose === 'frame' ? 'fonts' : 'site',
      ))
    )
      return new Response('The site preview is unavailable.', { status: 400 })
    try {
      const ticket = await openCanvasTicket(
        session.principal.userId,
        pageId,
        {
          versionId,
          sitePreview: 'draft',
          channel: input.channel as string,
          showHidden: false,
          parentOrigin: new URL(request.headers.get('origin')!).origin,
        },
        { tokens: tokens.data, header: header.data, footer: footer.data, menu: menu.data },
      )
      return Response.json(ticket, { headers: { 'cache-control': 'private, no-store' } })
    } catch {
      return new Response('The site preview could not be opened. Check your choices and try again.', {
        status: 400,
        headers: { 'cache-control': 'private, no-store' },
      })
    }
  }

  // The menu and design around the frame. A request that does not choose keeps
  // the site default (saved drafts before the first release).
  const preview = await buildPreview(
    session.principal.userId,
    versionId,
    siteId,
    input.previewContext === undefined ? undefined : sitePreviewContext(input.previewContext) === 'draft',
  )
  if (!preview) notFound()
  const { html } = renderPage({
    manifest: preview.manifest,
    shell: {
      ...preview.shell,
      ...(tokens?.success ? { theme: tokens.data } : {}),
      ...(menu?.success ? { navigation: menu.data } : {}),
      header: header.data,
      footer: footer.data,
      header_component: components.header,
      footer_component: components.footer,
    },
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
