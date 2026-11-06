'use server'
import { asUser } from '@cms/platform'
import { DomainError, mapErrors } from '@cms/domain'
import { sectionAppearanceSupport } from '@cms/renderer'
import { currentSession } from '../../../lib/session.ts'
import { getPage, type LibraryEntry } from '../../../lib/queries.ts'
export async function duplicatePageAction(
  pageId: string,
  expectedRevision: number,
  identity?: { title: string; address: string },
) {
  const session = await currentSession()
  if (!session) return { ok: false as const, kind: 'error' as const, message: 'Sign in before making a copy.' }
  if (
    identity &&
    (!identity.title.trim() ||
      identity.title.length > 200 ||
      !identity.address ||
      identity.address.length > 160 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identity.address))
  )
    return {
      ok: false as const,
      kind: 'error' as const,
      message: 'Enter a page name and an address with lowercase letters, numbers and hyphens.',
    }
  try {
    const row = await mapErrors(() =>
      asUser({ userId: session.principal.userId }, async client => {
        const row = (
          await client.query<{ page_id: string; revision: string }>('SELECT * FROM app.duplicate_page($1,$2)', [
            pageId,
            expectedRevision,
          ])
        ).rows[0]!
        if (identity) {
          const details = (
            await client.query(
              'SELECT p.parent_page_id,n.revision AS menu_revision FROM pages p LEFT JOIN navigations n ON n.site_id=p.site_id WHERE p.id=$1',
              [row.page_id],
            )
          ).rows[0]
          await client.query('SELECT * FROM app.save_page_details($1,$2,$3,$4,$5,false,$6)', [
            row.page_id,
            row.revision,
            identity.title.trim(),
            identity.address,
            details.parent_page_id,
            details.menu_revision ?? 0,
          ])
        }
        return row
      }),
    )
    return { ok: true as const, pageId: row.page_id }
  } catch (error) {
    return error instanceof DomainError && error.kind === 'stale_revision'
      ? {
          ok: false as const,
          kind: 'conflict' as const,
          currentRevision: error.currentRevision,
          message: error.message,
        }
      : {
          ok: false as const,
          kind: 'error' as const,
          message:
            error instanceof DomainError
              ? error.message
              : 'The copy could not be confirmed. Check Pages before trying again.',
        }
  }
}
export async function copiedSectionLayout(
  pageId: string,
  definitionId: string,
  version: number,
): Promise<LibraryEntry | null> {
  const session = await currentSession()
  if (!session) return null
  const page = await getPage(session.principal.userId, pageId)
  if (!page) return null
  return asUser({ userId: session.principal.userId }, async client => {
    const row = (
      await client.query<LibraryEntry & { css: string; structured_doc: unknown }>(
        `SELECT d.id AS section_def_id,d.slug,d.name,d.category,d.scope,d.site_id,d.placement,v.version,v.slots,v.thumbnail_path,v.definition_kind,v.carries_trusted_code,v.compiled_css AS css,v.structured_doc,0::int AS used_on_pages,0::int AS used_on_sites FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.id=$1 AND v.version=$2 AND d.placement='page' AND (d.scope='global' OR d.site_id=$3)`,
        [definitionId, version, page.site_id],
      )
    ).rows[0]
    if (!row) return null
    const { css, structured_doc, ...entry } = row
    return { ...entry, appearance_support: sectionAppearanceSupport({ ...entry, css, structured_doc }) }
  })
}
