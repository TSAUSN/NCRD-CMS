import type { Queryable } from '@cms/platform'
import { DataValues } from '@cms/schema'

/** This scope applies only when the exact draft changes the saved numbers and no other setting. */
export async function numbersOnlySettingsChange(client: Queryable, siteId: string, draftId: string) {
  return (
    await client.query<{ before: unknown; after: unknown }>(
      `SELECT live.settings->'dataValues' AS before, draft.settings->'dataValues' AS after
       FROM site_settings head
       JOIN site_setting_versions draft ON draft.id=head.draft_version_id AND draft.id=$2
       LEFT JOIN site_setting_versions live ON live.id=head.published_version_id
       WHERE head.site_id=$1
         AND draft.settings-'dataValues' = (jsonb_build_object('schemaVersion',1)||COALESCE(live.settings,'{}'::jsonb))-'dataValues'
         AND draft.settings->'dataValues' IS DISTINCT FROM live.settings->'dataValues'`,
      [siteId, draftId],
    )
  ).rows[0]
}

/** A missing scope keeps the full review; an empty scope means no saved number changed. */
export async function changedNumberIds(client: Queryable, siteId: string, draftId: string): Promise<string[] | null> {
  const change = await numbersOnlySettingsChange(client, siteId, draftId)
  if (!change) return null
  const before = DataValues.safeParse(change.before ?? [])
  const after = DataValues.safeParse(change.after ?? [])
  if (!before.success || !after.success) return null
  const old = new Map(before.data.map(row => [row.id, JSON.stringify(row)]))
  const next = new Map(after.data.map(row => [row.id, JSON.stringify(row)]))
  return [...new Set([...old.keys(), ...next.keys()])].filter(id => old.get(id) !== next.get(id))
}
