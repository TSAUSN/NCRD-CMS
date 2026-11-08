import type { Queryable } from '@cms/platform'
import { CollectionModel, parseCollectionEntryValues } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { corePageDefinitions } from './core-pages.ts'
import { sawsoSection, sawsoFeed } from './sawso-pages.ts'
import {
  initialSawsoSourceBaselines,
  mergeStorySource,
  parseSawsoStoriesFeed,
  SAWSO_STORIES_FEED,
  StoryFeedFormatError,
  type SourceStory,
  type StorySourceBaseline,
} from './story-source-feed.ts'
export type StorySourceCheck = {
  id: string
  status: 'checking' | 'ok' | 'error'
  started_at: string
  finished_at: string | null
  result: Partial<Record<'added' | 'updated' | 'removed' | 'total' | 'preserved', number>> & {
    error?: 'network' | 'format' | 'save' | 'timeout'
  }
}
export type StorySourceRunner = <T>(fn: (client: Queryable) => Promise<T>) => Promise<T>
/** Exactly one fixed read, only invoked after an explicitly started journal request. */
export async function readSawsoStoriesSource(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(SAWSO_STORIES_FEED, {
    cache: 'no-store',
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(20000),
    headers: { accept: 'application/json' },
  })
  if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > 20000000)
    throw new Error('source unavailable')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0,
    wire = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 20000000) {
        await reader.cancel().catch(() => {})
        throw new Error('source too large')
      }
      wire += decoder.decode(value, { stream: true })
    }
    wire += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return wire
}
export async function readStorySourceStatus(client: Queryable, collectionId: string) {
  const rows = (
    await client.query(
      `SELECT id,CASE WHEN status='checking' AND lease_until<=clock_timestamp() THEN 'error' ELSE status END AS status,started_at,finished_at,
 CASE WHEN status='checking' AND lease_until<=clock_timestamp() THEN '{"error":"timeout"}'::jsonb ELSE result END AS result
 FROM story_source_checks WHERE collection_id=$1 ORDER BY started_at DESC,id DESC LIMIT 1`,
      [collectionId],
    )
  ).rows
  const success = (
    await client.query(
      "SELECT finished_at FROM story_source_checks WHERE collection_id=$1 AND status='ok' ORDER BY finished_at DESC,id DESC LIMIT 1",
      [collectionId],
    )
  ).rows[0]
  return {
    latest: rows[0] ? (JSON.parse(JSON.stringify(rows[0])) as StorySourceCheck) : null,
    lastSuccessAt: success?.finished_at ? new Date(success.finished_at).toISOString() : null,
  }
}
/** Always reread and lock the current drafts after the network returns. */
async function applyStorySourceCheck(
  client: Queryable,
  siteId: string,
  collectionId: string,
  requestId: string,
  incoming: SourceStory[],
): Promise<StorySourceCheck> {
  const list = (
    await client.query('SELECT app.lock_story_source_check($1,$2,$3) AS value', [siteId, collectionId, requestId])
  ).rows[0]!.value
  const model = CollectionModel.parse({ fields: list.fields, presentation: list.sort }),
    settings = model.presentation.stories
  if (settings?.source !== 'sawso')
    throw new DomainError('invalid_state', 'The source connection changed. Saved stories are unchanged.')
  const owned = (
    await client.query(
      'SELECT e.id,e.stable_key,e.archived_at,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 ORDER BY e.sort_index,e.created_at,e.id',
      [collectionId],
    )
  ).rows
  const stored = (
    await client.query(
      'SELECT b.source_id,b.fields,e.stable_key FROM story_source_baselines b JOIN collection_entries e ON e.id=b.entry_id AND e.collection_id=b.collection_id WHERE b.collection_id=$1',
      [collectionId],
    )
  ).rows
  const baselines: StorySourceBaseline[] = stored.map(row => ({
      sourceId: row.source_id,
      stableKey: row.stable_key,
      fields: row.fields,
    })),
    ids = new Set(baselines.map(b => b.sourceId)),
    keys = new Set(baselines.map(b => b.stableKey))
  baselines.push(
    ...initialSawsoSourceBaselines(owned.map(row => row.stable_key)).filter(
      b => !ids.has(b.sourceId) && !keys.has(b.stableKey),
    ),
  )
  const paths = (await client.query('SELECT slug FROM pages WHERE site_id=$1', [siteId])).rows.map(
    row => '/' + row.slug,
  )
  const merged = mergeStorySource(
    owned.filter(row => !row.archived_at).map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values })),
    baselines,
    incoming,
    settings,
    paths,
    owned.map(row => row.stable_key),
  )
  if (merged.changed) {
    const entries = merged.entries.map(entry => {
      const checked = parseCollectionEntryValues(model.fields, entry.values)
      if (!checked.ok)
        throw new DomainError('invalid_state', 'A source story could not be saved. Saved stories are unchanged.')
      return { ...entry, values: checked.values }
    })
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collectionId,
      list.entry_revision,
      JSON.stringify(entries),
    ])
    if (merged.newPages.length) {
      const definitions = await corePageDefinitions(client)
      for (const page of merged.newPages) {
        const id = (
          await client.query('SELECT app.create_page($1,$2,$3) AS id', [siteId, page.path.slice(1), page.title])
        ).rows[0]!.id
        const related = sawsoFeed(definitions, null, 3, page.stableKey)
        related.values.heading = 'More stories'
        related.values.empty_line = 'Check back soon for more stories.'
        const sections = [
          sawsoSection(definitions, 'story-detail', 'Story', {
            story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [page.stableKey] } },
          }),
          related,
        ]
        await client.query(
          "SELECT * FROM app.save_page_draft($1,0,$2,$3,'checkpoint','Added from the approved story source; review words and photo before publishing')",
          [
            id,
            JSON.stringify(sections),
            JSON.stringify({
              title: page.title,
              description: String(entries.find(entry => entry.stableKey === page.stableKey)!.values.summary),
            }),
          ],
        )
      }
    }
  }
  const result = {
    added: merged.added,
    updated: merged.updated,
    removed: merged.removed,
    total: merged.total,
    preserved: merged.preserved.length,
  }
  return (
    await client.query('SELECT app.finish_story_source_check($1,$2,$3,$4) AS value', [
      collectionId,
      requestId,
      JSON.stringify(result),
      JSON.stringify(merged.baselines),
    ])
  ).rows[0]!.value
}
export async function checkStorySource(
  deps: { run: StorySourceRunner; readFeed: () => Promise<string> },
  siteId: string,
  collectionId: string,
  requestId: string,
): Promise<StorySourceCheck> {
  const begun = await deps.run(
    async client =>
      (await client.query('SELECT app.begin_story_source_check($1,$2,$3) AS value', [siteId, collectionId, requestId]))
        .rows[0]!.value,
  )
  if (!begun.started) return begun.check
  let incoming: SourceStory[]
  try {
    incoming = parseSawsoStoriesFeed(await deps.readFeed())
  } catch (error) {
    return deps.run(
      async client =>
        (
          await client.query('SELECT app.finish_story_source_check($1,$2,$3,$4) AS value', [
            collectionId,
            requestId,
            JSON.stringify({ error: error instanceof StoryFeedFormatError ? 'format' : 'network' }),
            '[]',
          ])
        ).rows[0]!.value,
    )
  }
  try {
    return await deps.run(client => applyStorySourceCheck(client, siteId, collectionId, requestId, incoming))
  } catch (error) {
    // A failed draft transaction rolls back first; only the bounded failure is saved.
    await deps
      .run(client =>
        client.query('SELECT app.finish_story_source_check($1,$2,$3,$4)', [
          collectionId,
          requestId,
          '{"error":"save"}',
          '[]',
        ]),
      )
      .catch(() => {})
    throw error
  }
}
