import { randomUUID } from 'node:crypto'
import type { Queryable } from '@cms/platform'
import { CollectionModel, parseCollectionEntryValues, imageFocus } from '@cms/schema'
import { DomainError } from '@cms/domain'
import { storyDetailValues, type StoryEditInput } from './stories-edit.ts'
import { storyDraftFingerprint } from './story-draft-request.ts'
import { corePageDefinitions } from './core-pages.ts'
import { sawsoSection, sawsoFeed } from './sawso-pages.ts'
export type NewStoryInput = Pick<StoryEditInput, 'title' | 'summary' | 'tags' | 'region' | 'published_date'> & {
  author?: string
  photoId: string
  photoAlt: string
  photoFocus?: { x: number; y: number } | null
  body?: string
  regions?: string[]
  countries?: string
}
/** One normal transaction creates a private list row and its shared-template
 * page. The article command is limited to an own private Stories entry; list writes retain their existing permissions. */
export async function createStoryDraft(
  client: Queryable,
  siteId: string,
  collectionId: string,
  revision: string,
  input: NewStoryInput,
  requestId: string = randomUUID(),
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
    throw new DomainError('invalid_state', 'Reopen Add story before saving.')
  const list = (
    await client.query(
      "SELECT c.entry_revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1 AND c.site_id=$2 AND c.reader_key='stories'",
      [collectionId, siteId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'The Stories list is unavailable.')
  const fingerprint = storyDraftFingerprint(input),
    prior = (
      await client.query('SELECT app.read_story_draft_receipt($1,$2,$3,$4) AS receipt', [
        siteId,
        collectionId,
        requestId,
        fingerprint,
      ])
    ).rows[0]?.receipt
  if (prior)
    return {
      entryId: String(prior.entry_id),
      pageId: String(prior.page_id),
      revision: String(prior.entry_revision),
      replayed: true,
    }
  if (
    input?.photoFocus !== undefined &&
    input.photoFocus !== null &&
    (!imageFocus(input.photoFocus) || Object.keys(input.photoFocus).some(key => key !== 'x' && key !== 'y'))
  )
    throw new DomainError('invalid_state', 'Choose a focus point inside the photo.')
  if (
    !/^\d+$/.test(revision) ||
    !input ||
    typeof input.photoId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(input.photoId) ||
    typeof input.photoAlt !== 'string' ||
    !input.photoAlt.trim() ||
    input.photoAlt.length > 1000
  )
    throw new DomainError('invalid_state', 'Choose a ready photo and describe it before creating the story.')
  const media = (
    await client.query(
      "SELECT id FROM media WHERE id=$1 AND status='ready' AND deleted_at IS NULL AND (site_id=$2 OR site_id IS NULL) AND EXISTS(SELECT 1 FROM media_variants v WHERE v.media_id=media.id AND v.kind='wide')",
      [input.photoId, siteId],
    )
  ).rows[0]
  if (!media) throw new DomainError('invalid_state', 'Choose a ready photo from this site’s Media.')
  const whole = CollectionModel.safeParse(list.fields),
    model = whole.success ? whole.data : CollectionModel.parse({ fields: list.fields, presentation: list.sort })
  if (model.fields.find(field => field.key === 'old_address')?.required)
    throw new DomainError(
      'invalid_state',
      'A Super Admin must update the Stories fields before adding a story without an old address.',
    )
  if (!input.published_date && model.fields.find(field => field.key === 'published_date')?.required)
    throw new DomainError(
      'invalid_state',
      'A Site admin must update the Stories fields to allow drafts without a date.',
    )
  const details = storyDetailValues(
    { ...input, countries: input.countries ?? '', body: input.body ?? '', body_is_sample: false },
    {},
    model.presentation.stories,
  )
  const key = 'story-' + randomUUID(),
    slug =
      'stories/' +
      (details.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100)
        .replace(/-$/, '') || 'story') +
      '-' +
      key.slice(-8)
  const values = {
      ...details,
      old_address: '',
      image_url: '',
      story_url: '/' + slug,
      photo: {
        src: '/media/' + media.id + '/wide',
        alt: input.photoAlt.trim(),
        decorative: false,
        ...(imageFocus(input.photoFocus) ? { focal: imageFocus(input.photoFocus) } : {}),
      },
      photo_is_sample: false,
      photo_note: '',
    },
    checked = parseCollectionEntryValues(model.fields, values)
  if (!checked.ok) throw new DomainError('invalid_state', checked.problems[0] ?? 'Check the story fields.')
  const rows = (
    await client.query(
      'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id',
      [collectionId],
    )
  ).rows
  const saved = (
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collectionId,
      revision,
      JSON.stringify([
        ...rows.map(row => ({ id: row.id, stableKey: row.stable_key, values: row.values })),
        { id: null, stableKey: key, values: checked.values },
      ]),
    ])
  ).rows[0]!
  const entryId = (
    await client.query('SELECT id FROM collection_entries WHERE collection_id=$1 AND stable_key=$2', [
      collectionId,
      key,
    ])
  ).rows[0]!.id
  const pageId = (await client.query('SELECT app.create_private_story_page($1,$2) AS id', [collectionId, entryId]))
    .rows[0]!.id
  const defs = await corePageDefinitions(client),
    more = sawsoFeed(defs, input.tags[0] ?? null, 3, key)
  more.values.heading = 'More stories'
  if (!input.tags.length || model.presentation.stories?.source !== 'sawso')
    more.values.empty_line = 'Check back soon for more stories.'
  if (model.presentation.stories?.source !== 'sawso') {
    more.values.more = { label: '', url: '' }
    more.values.newsroom = { label: '', url: '' }
  }
  const library = (
    await client.query(
      "SELECT p.title FROM pages p JOIN sites s ON s.id=p.site_id WHERE p.site_id=$1 AND p.slug='newsroom' AND p.archived_at IS NULL AND (p.published_version_id IS NOT NULL OR s.initial_release_required AND p.draft_version_id IS NOT NULL)",
      [siteId],
    )
  ).rows[0]
  const sections = [
    sawsoSection(defs, 'story-detail', 'Story', {
      library_link: library ? { url: '/newsroom', label: library.title } : { url: '', label: '' },
      story: { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [key] } },
    }),
    more,
  ]
  await client.query(
    "SELECT * FROM app.save_page_draft($1,0,$2,$3,'checkpoint','Created from the shared story template')",
    [
      pageId,
      JSON.stringify(sections),
      JSON.stringify({ title: checked.values.title, description: checked.values.summary }),
    ],
  )
  await client.query('SELECT app.record_story_draft_receipt($1,$2,$3,$4,$5,$6,$7)', [
    siteId,
    collectionId,
    requestId,
    fingerprint,
    entryId,
    pageId,
    saved.entry_revision,
  ])
  return { entryId, pageId, revision: String(saved.entry_revision), replayed: false }
}
