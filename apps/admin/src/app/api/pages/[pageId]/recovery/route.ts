import { asUser } from '@cms/platform'
import { sectionAppearanceSupport } from '@cms/renderer'
import { currentSession } from '../../../../../lib/session.ts'
import { createPageRecoveryHeadHandler } from '../../../../../lib/page-recovery-handler.ts'
import type { RecoveryHead, RecoveryScope } from '../../../../../lib/page-recovery.ts'
import type { LibraryEntry } from '../../../../../lib/queries.ts'
import { isSameOriginRequest } from '../../../../../lib/request-origin.ts'

export const dynamic = 'force-dynamic'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'cache-control': 'no-store, private', vary: 'Cookie', 'x-content-type-options': 'nosniff' }
async function readHead(scope: RecoveryScope): Promise<RecoveryHead | null> {
  if (![scope.pageId, scope.siteId, scope.userId].every(value => uuid.test(value))) return null
  return asUser({ userId: scope.userId }, async client => {
    const row = (
      await client.query<{
        title: string
        slug: string
        version_id: string | null
        revision: string
        content: RecoveryHead['document']['sections'] | null
        meta: RecoveryHead['document']['meta'] | null
      }>(
        `
      SELECT p.title,p.slug,p.draft_version_id AS version_id,p.revision,v.content,v.meta
      FROM pages p JOIN sites s ON s.id=p.site_id LEFT JOIN page_versions v ON v.id=p.draft_version_id
      WHERE p.id=$1 AND p.site_id=$2 AND p.archived_at IS NULL AND s.status<>'archived'`,
        [scope.pageId, scope.siteId],
      )
    ).rows[0]
    return row
      ? {
          versionId: row.version_id,
          revision: Number(row.revision),
          document: {
            sections: row.content ?? [],
            meta: row.meta ?? {},
            identity: { title: row.title, address: row.slug },
          },
        }
      : null
  })
}
const handle = createPageRecoveryHeadHandler({
  currentUser: async () => (await currentSession())?.principal.userId ?? null,
  readHead,
})
export async function GET(request: Request, context: { params: Promise<{ pageId: string }> }) {
  return handle(request, (await context.params).pageId)
}

/** Resolve exact immutable section pins before a local copy is applied. Only
 * IDs and versions are sent here; local authored content is saved later through
 * the ordinary page command, including its source policy and revision check. */
export async function POST(request: Request, context: { params: Promise<{ pageId: string }> }) {
  if (!isSameOriginRequest(request))
    return Response.json({ message: 'Open recovery from the CMS.' }, { status: 403, headers })
  const authorized = await handle(request, (await context.params).pageId)
  if (!authorized.ok) return authorized
  const { scope } = (await authorized.json()) as { scope: RecoveryScope }
  let pins: { id: string; version: number }[]
  try {
    if (!request.body || request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      throw new Error('body')
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 512 * 1024) {
          await reader.cancel()
          throw new Error('size')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { pins?: unknown }
    if (
      !Array.isArray(body.pins) ||
      body.pins.length > 5000 ||
      !body.pins.every(
        pin =>
          pin &&
          typeof pin === 'object' &&
          typeof pin.id === 'string' &&
          uuid.test(pin.id) &&
          Number.isSafeInteger(pin.version) &&
          pin.version > 0,
      )
    )
      throw new Error('pins')
    pins = [
      ...new Map(body.pins.map(pin => [`${pin.id}:${pin.version}`, { id: pin.id, version: pin.version }])).values(),
    ]
  } catch {
    return Response.json({ message: 'This copy contains unsupported section references.' }, { status: 400, headers })
  }
  const definitions = await asUser({ userId: scope.userId }, async client =>
    (
      await client.query<LibraryEntry & { css: string; structured_doc: unknown }>(
        `
      SELECT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,d.placement,
        v.version,v.slots,v.thumbnail_path,v.definition_kind,v.carries_trusted_code,v.compiled_css AS css,v.structured_doc,
        0::int AS used_on_pages,0::int AS used_on_sites
      FROM jsonb_to_recordset($1::jsonb) AS pin(id uuid,version integer)
      JOIN section_defs d ON d.id=pin.id JOIN section_def_versions v ON v.section_def_id=d.id AND v.version=pin.version
      WHERE (d.scope='global' OR d.site_id=$2) AND d.placement='page'`,
        [JSON.stringify(pins), scope.siteId],
      )
    ).rows.map(({ css, structured_doc, ...definition }) => ({
      ...definition,
      appearance_support: sectionAppearanceSupport({ ...definition, css, structured_doc }),
    })),
  )
  if (definitions.length !== pins.length)
    return Response.json(
      { message: 'A section version in this copy is unavailable for this site. The browser copy has been kept.' },
      { status: 409, headers },
    )
  // The head is read again after resolving dependencies, immediately before the
  // client compares it to the reviewed version. Save still has final CAS.
  const head = await readHead(scope)
  if (!head)
    return Response.json({ message: 'This page is no longer available for editing.' }, { status: 404, headers })
  return Response.json({ scope, head, definitions }, { headers })
}
