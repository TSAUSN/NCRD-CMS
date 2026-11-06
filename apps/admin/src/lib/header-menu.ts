import { validHeaderButtonUrl } from './header-button-link.ts'
import { isDeepStrictEqual } from 'node:util'
import { DomainError } from '@cms/domain'
import { HeaderDraftConfig, validTrackingCode, type HeaderConfig, type NavTree } from '@cms/schema'
import type { Queryable } from '@cms/platform'
export type HeaderMenuDraft = {
  siteId: string
  headerRevision: number
  footerRevision: number
  menuRevision: number
  header: HeaderConfig
  menu: NavTree
  mode: 'auto' | 'manual'
}
/** Caller owns the identity-scoped transaction. The footer is read and preserved,
 * and a stale navigation rolls back the header save as well. */
export async function saveHeaderMenuDraft(client: Queryable, input: HeaderMenuDraft) {
  if (input.header.schemaVersion === 2)
    for (const value of Object.values(input.header.component.values))
      if (
        value &&
        typeof value === 'object' &&
        'trackingCode' in value &&
        (typeof value.trackingCode !== 'string' || !validTrackingCode(value.trackingCode))
      )
        throw new DomainError(
          'invalid_state',
          'Use tracking parameters such as utm_source=site, or leave the tracking code empty.',
        )
  if (!(await client.query('SELECT app.can_administer_site($1) AS allowed', [input.siteId])).rows[0]?.allowed)
    throw new DomainError('not_authorized', 'A Site admin changes the header and menu.')
  if (!HeaderDraftConfig.safeParse(input.header).success)
    throw new DomainError('invalid_state', 'Add the required logo description before saving.')
  const rows = (
    await client.query(
      'SELECT g.kind,g.revision,v.content FROM global_elements g JOIN global_element_versions v ON v.id=g.draft_version_id WHERE g.site_id=$1 ORDER BY g.kind',
      [input.siteId],
    )
  ).rows
  const old = rows.find(row => row.kind === 'header'),
    footer = rows.find(row => row.kind === 'footer')
  if (!old || !footer) throw new DomainError('not_found', 'The site header is unavailable.')
  if (Number(old.revision) !== input.headerRevision || Number(footer.revision) !== input.footerRevision)
    throw new DomainError('stale_revision', 'Someone else saved the header or footer. Reload to compare your work.')
  if (input.header.schemaVersion === 2) {
    const definition = (
      await client.query('SELECT slots FROM section_def_versions WHERE section_def_id=$1 AND version=$2', [
        input.header.component.section_def_id,
        input.header.component.section_def_version,
      ])
    ).rows[0]
    for (const slot of definition?.slots ?? [])
      if (
        slot.kind === 'button' &&
        (slot.id !== 'secondary' || Object.hasOwn(input.header.component.values, slot.id))
      ) {
        const value = input.header.component.values[slot.id] as { label?: unknown; url?: unknown } | undefined
        if (!value || typeof value.label !== 'string' || !value.label.trim() || !validHeaderButtonUrl(value.url))
          throw new DomainError(
            'invalid_state',
            'Add button text and a valid page, website, email or phone destination before saving.',
          )
      }
    for (const slot of definition?.slots ?? [])
      if (slot.constraints?.siteLogo === true) {
        const value = input.header.component.values[slot.id] as { src?: unknown; alt?: unknown } | undefined
        if (!value || typeof value.src !== 'string' || !value.src || typeof value.alt !== 'string' || !value.alt.trim())
          throw new DomainError('invalid_state', 'Choose a logo and add its description before saving.')
      }
  }
  let headerRevision = input.headerRevision,
    footerRevision = input.footerRevision
  if (!isDeepStrictEqual(old.content, input.header)) {
    const saved = (
      await client.query('SELECT * FROM app.save_global_elements_draft($1,$2,$3,$4,$5,true)', [
        input.siteId,
        input.headerRevision,
        input.footerRevision,
        JSON.stringify(input.header),
        JSON.stringify(footer.content),
      ])
    ).rows[0]!
    headerRevision = Number(saved.header_revision)
    footerRevision = Number(saved.footer_revision)
  }
  const nav = (
    await client.query(
      'SELECT n.revision,n.mode,v.tree FROM navigations n JOIN navigation_versions v ON v.id=n.draft_version_id WHERE n.site_id=$1',
      [input.siteId],
    )
  ).rows[0]!
  if (Number(nav.revision) !== input.menuRevision)
    throw new DomainError('stale_revision', 'Someone else saved the menu. Reload to compare your work.')
  let menuRevision = input.menuRevision
  if (nav.mode !== input.mode || !isDeepStrictEqual(nav.tree, input.menu))
    menuRevision = Number(
      (
        await client.query('SELECT * FROM app.save_navigation_draft($1,$2,$3,$4)', [
          input.siteId,
          input.menuRevision,
          JSON.stringify(input.menu),
          input.mode,
        ])
      ).rows[0]!.revision,
    )
  return { headerRevision, footerRevision, menuRevision }
}
