import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { renderSection, type SectionDefView } from '@cms/renderer'
import type { SlotDef, StructuredDocument } from '@cms/schema'
import { currentSession } from '../../../../../../../lib/session.ts'
import { getSite, getSiteShell } from '../../../../../../../lib/queries.ts'
import { definitionPreviewValues } from '../../../../../../../lib/definition-preview.ts'
import { renderDefinitionPreview } from '../../../../../../../lib/definition-preview-render.ts'
import { sitePreviewContext } from '../../../../../../../lib/preview-context.ts'
import {
  SCRIPTLESS_PREVIEW_CSP,
  SCRIPTLESS_RENDER_OPTIONS,
  scriptlessPreviewHtml,
} from '../../../../../../../lib/scriptless-preview.ts'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ siteId: string; definitionId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, definitionId } = await context.params
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const params = new URL(request.url).searchParams
  const themeSiteId = params.get('themeSiteId') || siteId
  if (![siteId, definitionId, themeSiteId].every(value => uuid.test(value))) notFound()
  const userId = session.principal.userId
  const [site, themeSite] = await Promise.all([getSite(userId, siteId), getSite(userId, themeSiteId)])
  if (!site || !themeSite) notFound()
  const definition = await asUser(
    { userId },
    async client =>
      (
        await client.query<
          SectionDefView & {
            name: string
            placement: 'page' | 'header' | 'footer'
            slots: SlotDef[]
            structured_doc: StructuredDocument | null
          }
        >(
          `SELECT d.id AS section_def_id,d.slug,d.name,d.placement,v.version,v.compiled_ast,v.compiled_css AS css,v.slots,
    v.sanitizer_policy_version,v.css_policy_version,v.definition_kind,v.structured_doc,v.structured_schema_version
    FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id
    WHERE d.id=$1 AND d.status='active' AND (d.scope='global' OR d.site_id=$2)
    ORDER BY v.version DESC LIMIT 1`,
          [definitionId, siteId],
        )
      ).rows[0],
  )
  if (!definition) notFound()
  const section = {
    def: definition,
    instance: {
      section_def_id: definitionId,
      section_def_version: definition.version,
      values: definitionPreviewValues(definition.slots, definition.structured_doc),
    },
  }
  if (!renderSection(section, 0, SCRIPTLESS_RENDER_OPTIONS))
    return new Response('This section needs a definition update before it can be previewed.', { status: 422 })
  const preview = await getSiteShell(userId, themeSiteId, sitePreviewContext(params.get('site')))
  if (!preview) notFound()
  const html = renderDefinitionPreview({ definition, name: definition.name, placement: definition.placement, preview })
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
