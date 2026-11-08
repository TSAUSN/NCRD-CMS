'use server'
import { randomUUID } from 'node:crypto'
import { parseCollectionEntryValues } from '@cms/schema'
import { listItemFields } from '../../../lib/list-items.ts'
import { currentSession } from '../../../lib/session.ts'
import { asUser } from '@cms/platform'
import { collectionRights, getCollectionWorkspace } from '../../../lib/collection-queries.ts'
import { getPage } from '../../../lib/queries.ts'
import { saveListEntries } from '../../../server/commands/save-list-entries.ts'
export async function loadInlineList(pageId: string, readerKey: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to edit this list.' }
  return readInlineList(session.principal.userId, pageId, readerKey)
}

async function readInlineList(actorId: string, pageId: string, readerKey: string) {
  const page = await getPage(actorId, pageId)
  if (!page) return { ok: false as const, message: 'This page is unavailable.' }
  const rights = await collectionRights(actorId, page.site_id)
  if (!rights.editEntries) return { ok: false as const, message: 'An editor can update this shared list.' }
  const index = await getCollectionWorkspace(actorId, page.site_id)
  const summary = index.collections.find(list => list.readerKey === readerKey)
  if (!summary) return { ok: false as const, message: 'This list is unavailable.' }
  const workspace = await getCollectionWorkspace(actorId, page.site_id, summary.id)
  if (!workspace.selected || workspace.selected.id !== summary.id)
    return { ok: false as const, message: 'This list is unavailable.' }
  const usage = await asUser({ userId: actorId }, client =>
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
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in to edit this list.' }
  const actorId = session.principal.userId
  const loaded = await readInlineList(actorId, input.pageId, input.readerKey)
  if (!loaded.ok) return loaded
  const { list } = loaded
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
  // The editor refreshes its canvas after this receipt. Lists reads fresh data
  // on entry, so this action does not need to stream the current editor again.
  return saveListEntries({ actorId, collectionId: list.id, expectedRevision: input.entryRevision, entries })
}
