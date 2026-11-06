'use server'
import { randomUUID } from 'node:crypto'
import { parseCollectionEntryValues } from '@cms/schema'
import { listItemFields } from '../../../lib/list-items.ts'
import { currentSession } from '../../../lib/session.ts'
import { asUser } from '@cms/platform'
import { collectionRights, getCollectionWorkspace } from '../../../lib/collection-queries.ts'
import { getPage } from '../../../lib/queries.ts'
import { saveCollectionEntries } from '../../actions/collections.ts'
export async function loadInlineList(pageId: string, readerKey: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to edit this list.' }
  const page = await getPage(session.principal.userId, pageId)
  if (!page) return { ok: false as const, message: 'This page is unavailable.' }
  const rights = await collectionRights(session.principal.userId, page.site_id)
  if (!rights.editEntries) return { ok: false as const, message: 'An editor can update this shared list.' }
  const index = await getCollectionWorkspace(session.principal.userId, page.site_id)
  const summary = index.collections.find(list => list.readerKey === readerKey)
  if (!summary) return { ok: false as const, message: 'This list is unavailable.' }
  const workspace = await getCollectionWorkspace(session.principal.userId, page.site_id, summary.id)
  if (!workspace.selected || workspace.selected.id !== summary.id)
    return { ok: false as const, message: 'This list is unavailable.' }
  const usage = await asUser({ userId: session.principal.userId }, client =>
    client.query<{ title: string }>(
      `SELECT DISTINCT p.title FROM pages p JOIN page_versions v ON v.id=p.draft_version_id CROSS JOIN LATERAL jsonb_array_elements(v.content) section CROSS JOIN LATERAL jsonb_each(COALESCE(section->'values','{}')) field WHERE p.site_id=$1 AND p.archived_at IS NULL AND field.value->>'readerKey'=$2 ORDER BY p.title`,
      [page.site_id, readerKey],
    ),
  )
  return { ok: true as const, list: workspace.selected, siteId: page.site_id, usedOn: usage.rows.map(row => row.title) }
}
export async function saveInlineListItem(input: {
  pageId: string
  readerKey: string
  entryRevision: number
  stableKey?: string
  values: Record<string, unknown>
}) {
  const loaded = await loadInlineList(input.pageId, input.readerKey)
  if (!loaded.ok) return loaded
  const { list, siteId } = loaded
  const existing = input.stableKey
    ? list.entries.find(entry => entry.stableKey === input.stableKey && !entry.archived)
    : null
  if (input.stableKey && !existing)
    return { ok: false as const, message: 'This item is no longer in the list. Close this form and try again.' }
  const checked = parseCollectionEntryValues(listItemFields(list.draft, Boolean(existing)), input.values)
  if (!checked.ok) return { ok: false as const, message: checked.problems.join(' ') }
  const entries = list.entries
    .filter(entry => !entry.archived)
    .map(({ id, stableKey, values }) => ({
      id,
      stableKey,
      values: stableKey === input.stableKey ? checked.values : values,
    }))
  if (!existing) entries.push({ id: null, stableKey: 'item-' + randomUUID().slice(0, 12), values: checked.values })
  const data = new FormData()
  data.set('siteId', siteId)
  data.set('collectionId', list.id)
  data.set('entryRevision', String(input.entryRevision))
  data.set('entries', JSON.stringify(entries))
  return saveCollectionEntries(data)
}
