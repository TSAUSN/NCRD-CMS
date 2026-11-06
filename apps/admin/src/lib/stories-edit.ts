import type { Queryable } from '@cms/platform'
import {
  CollectionModel,
  parseCollectionEntryValues,
  COLLECTION_LIMITS,
  type StoriesSettings,
  storyTagIds,
} from '@cms/schema'
import { DomainError } from '@cms/domain'
import { sanitizeRichText, escapeText } from '@cms/renderer'
import { resolveStoryPhoto, type StoryPhotoInput } from './story-photo.ts'
import { STORY_SECTORS, STORY_REGIONS } from '@cms/seeds/sawso-stories'
export type StoryEditInput = {
  title: string
  summary: string
  author?: string
  tags: string[]
  region: string
  published_date: string
  countries: string
  body: string
  body_is_sample: boolean
  regions?: string[]
  photo?: StoryPhotoInput
}
export function storyDetailValues(
  input: StoryEditInput,
  original: Record<string, unknown> = {},
  catalog?: StoriesSettings,
) {
  const sectors = catalog?.mainTags ?? STORY_SECTORS,
    regions = catalog?.secondaryTags ?? STORY_REGIONS
  if (input?.author !== undefined && (typeof input.author !== 'string' || input.author.length > 120))
    throw new DomainError('invalid_state', 'Use up to 120 characters for Author.')
  if (
    !input ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.length > 180 ||
    typeof input.summary !== 'string' ||
    !input.summary.trim() ||
    input.summary.length > 200 ||
    (input.summary.trim().length > 155 && input.summary.trim() !== String(original.summary ?? '').trim()) ||
    typeof input.countries !== 'string' ||
    input.countries.length > 300 ||
    typeof input.body !== 'string' ||
    input.body.length > COLLECTION_LIMITS.storyBody ||
    typeof input.body_is_sample !== 'boolean' ||
    !Array.isArray(input.tags) ||
    (!catalog && !input.tags.length) ||
    input.tags.length > 100 ||
    input.tags.some(id => !sectors.some(s => s.id === id)) ||
    (!(catalog && input.region === '') && !regions.some(r => r.id === input.region)) ||
    (input.regions !== undefined &&
      (!Array.isArray(input.regions) ||
        input.regions.length > 100 ||
        input.regions.some(id => !regions.some(r => r.id === id))))
  )
    throw new DomainError(
      'invalid_state',
      'Check the title, summary (up to 155 characters), tags and region before saving.',
    )
  const tags = [...new Set(input.tags)],
    values = {
      ...original,
      ...(input.author !== undefined ? { author: input.author.trim() } : {}),
      title: input.title.trim(),
      summary: input.summary.trim(),
      tags: tags.join(','),
      region: input.region,
      region_label: regions.find(r => r.id === input.region)?.label ?? '',
      published_date: input.published_date,
      countries: input.countries.trim(),
      body: sanitizeRichText(input.body),
      body_is_sample: input.body_is_sample,
      sector_links: tags
        .map(id => {
          const label = escapeText(sectors.find(s => s.id === id)?.label ?? id)
          return !catalog || (catalog.source === 'sawso' && STORY_SECTORS.some(t => t.id === id))
            ? '<a href="/ways-we-help/' + id + '">' + label + '</a>'
            : label
        })
        .join(' '),
    }
  const secondary = [...new Set(input.regions ?? (input.region ? [input.region] : storyTagIds(original, 'secondary')))]
  return catalog
    ? {
        ...values,
        regions: secondary.join(','),
        region: secondary[0] ?? '',
        region_label: secondary.map(id => regions.find(r => r.id === id)?.label ?? id).join(', '),
      }
    : values
}
/** A single-record edit still uses the list's normal CAS command and permissions. */
export async function saveStoryDetails(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
  entryRevision: string,
  input: StoryEditInput,
) {
  if (!/^\d+$/.test(entryRevision)) throw new DomainError('invalid_state', 'Refresh the story before saving.')
  const list = (
    await client.query(
      "SELECT c.entry_revision,v.fields,v.sort FROM collections c JOIN collection_schema_versions v ON v.id=c.draft_schema_version_id WHERE c.id=$1 AND c.site_id=$2 AND c.reader_key='stories'",
      [collectionId, siteId],
    )
  ).rows[0]
  if (!list) throw new DomainError('not_found', 'This story is unavailable.')
  const rows = (
      await client.query(
        'SELECT e.id,e.stable_key,v.values FROM collection_entries e JOIN collection_entry_versions v ON v.id=e.draft_version_id WHERE e.collection_id=$1 AND e.archived_at IS NULL ORDER BY e.sort_index,e.created_at,e.id',
        [collectionId],
      )
    ).rows,
    target = rows.find(row => row.id === entryId)
  if (!target) throw new DomainError('not_found', 'This story is unavailable.')
  const titleChanged = typeof input?.title === 'string' && input.title.trim() !== target.values.title,
    summaryChanged = typeof input?.summary === 'string' && input.summary.trim() !== target.values.summary
  // Lock the article before the list, matching release lock order. Preserve its
  // content and unrelated metadata while keeping edited story/search words aligned.
  const article =
    titleChanged || summaryChanged
      ? (
          await client.query(
            'SELECT p.id,p.revision,v.content,v.meta FROM pages p JOIN page_versions v ON v.id=p.draft_version_id WHERE p.site_id=$1 AND app.page_path(p.slug)=$2 AND p.archived_at IS NULL FOR UPDATE OF p',
            [siteId, target.values.story_url],
          )
        ).rows[0]
      : null
  const whole = CollectionModel.safeParse(list.fields),
    model = whole.success ? whole.data : CollectionModel.parse({ fields: list.fields, presentation: list.sort }),
    values: Record<string, unknown> = storyDetailValues(input, target.values, model.presentation.stories)
  if (input.photo !== undefined) {
    const photo = await resolveStoryPhoto(client, siteId, input.photo),
      old = target.values.photo
    values.photo = photo
    if (old?.src !== photo.src) {
      values.photo_is_sample = false
      values.photo_note = ''
    }
  }
  const checked = parseCollectionEntryValues(model.fields, values)
  if (!checked.ok) throw new DomainError('invalid_state', checked.problems[0] ?? 'Check the story details.')
  const saved = (
    await client.query('SELECT * FROM app.save_collection_entries($1,$2,$3)', [
      collectionId,
      entryRevision,
      JSON.stringify(
        rows.map(row => ({
          id: row.id,
          stableKey: row.stable_key,
          values: row.id === entryId ? checked.values : row.values,
        })),
      ),
    ])
  ).rows[0]!
  if (article) {
    const meta = {
      ...article.meta,
      ...(titleChanged ? { title: checked.values.title } : {}),
      ...(summaryChanged ? { description: checked.values.summary } : {}),
    }
    await client.query(
      "SELECT * FROM app.save_page_draft($1,$2,$3,$4,'checkpoint','Story: updated title or search description')",
      [article.id, article.revision, JSON.stringify(article.content), JSON.stringify(meta)],
    )
  }
  return { revision: String(saved.entry_revision), values: checked.values }
}
