import { isDeepStrictEqual } from 'node:util'
import { DomainError } from '@cms/domain'
import type { FooterConfig } from '@cms/schema'
import type { Queryable } from '@cms/platform'
export type FooterDraft = { siteId: string; headerRevision: number; footerRevision: number; footer: FooterConfig }
export async function saveFooterDraft(client: Queryable, input: FooterDraft) {
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [input.siteId])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'A Site admin changes the footer.')
  const rows = (
    await client.query(
      'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
      [input.siteId],
    )
  ).rows
  const header = rows.find(row => row.kind === 'header')
  const footer = rows.find(row => row.kind === 'footer')
  if (!header || !footer) throw new DomainError('not_found', 'The footer is unavailable.')
  if (Number(header.revision) !== input.headerRevision || Number(footer.revision) !== input.footerRevision)
    throw new DomainError('stale_revision', 'Someone else saved the header or footer. Reload to compare your work.')
  if (input.footer.schemaVersion === 2) {
    const slots =
      (
        await client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
          input.footer.component.section_def_id,
          input.footer.component.section_def_version,
        ])
      ).rows[0]?.slots ?? []
    for (const slot of slots)
      if (slot.kind === 'image' && slot.constraints?.siteLogo === true) {
        const value = input.footer.component.values[slot.id] as { src?: unknown; alt?: unknown } | undefined
        if (slot.constraints.inheritHeaderLogo === true && !Object.hasOwn(input.footer.component.values, slot.id))
          continue
        if (!value || typeof value.src !== 'string' || !value.src || typeof value.alt !== 'string' || !value.alt.trim())
          throw new DomainError('invalid_state', 'Choose a logo and add its description before saving.')
      }
  }
  if (isDeepStrictEqual(footer.content, input.footer))
    return { headerRevision: input.headerRevision, footerRevision: input.footerRevision }
  const saved = (
    await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5,true)', [
      input.siteId,
      input.headerRevision,
      input.footerRevision,
      JSON.stringify(header.content),
      JSON.stringify(input.footer),
    ])
  ).rows[0]!
  return { headerRevision: Number(saved.header_revision), footerRevision: Number(saved.footer_revision) }
}
