import 'server-only'
import { asUser } from '@cms/platform'
import { resolvedDataSections } from './data-values.ts'
import { pageChangePresentation } from './release-copy.ts'
import type { DraftRow } from './queries.ts'
/** Same saved-form vocabulary as Publish; all reads keep the caller's RLS context. */
export function historyPresentation(userId: string, siteId: string, before: DraftRow, after: DraftRow) {
  return asUser({ userId }, async client => {
    const forms = Object.fromEntries(
      (
        await client.query(
          `SELECT v.section_def_id,v.version,d.name,v.slots FROM section_defs d JOIN section_def_versions v ON v.section_def_id=d.id WHERE d.scope='global' OR d.site_id=$1`,
          [siteId],
        )
      ).rows.map(row => [row.section_def_id + ':' + row.version, { name: row.name, slots: row.slots }]),
    )
    const settings = (
      await client.query(
        'SELECT v.settings FROM site_settings h JOIN site_setting_versions v ON v.id=h.draft_version_id WHERE h.site_id=$1',
        [siteId],
      )
    ).rows[0]?.settings
    return pageChangePresentation(
      resolvedDataSections(Array.isArray(before.content) ? before.content : [], forms, settings),
      resolvedDataSections(Array.isArray(after.content) ? after.content : [], forms, settings),
      forms,
      { title: before.page_title, address: before.page_slug, description: before.meta.description },
      { title: after.page_title, address: after.page_slug, description: after.meta.description },
    )
  })
}
