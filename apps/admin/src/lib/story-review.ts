import type { Queryable } from '@cms/platform'
import { DomainError } from '@cms/domain'
import { StoriesSettings, type CollectionField } from '@cms/schema'
import { storyEntryPresentation, type ReleasePresentation } from './release-copy.ts'
import { hasStoryText } from './stories-model.ts'
import { storyPhotoInput } from './story-photo-input.ts'

type SavedStory = {
  page_id: string
  page_revision: string
  entry_version_id: string
  schema_version_id: string
  values: Record<string, unknown>
  live_values: Record<string, unknown> | null
  fields: CollectionField[]
  settings: unknown
}
export type StoryReviewPreparation = {
  pageId: string
  pageRevision: string
  entryVersionId: string
  hasDate: boolean
  presentation: ReleasePresentation
}
export function storyReviewPresentation(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: CollectionField[],
  settings: unknown,
): ReleasePresentation {
  const catalog = StoriesSettings.safeParse((settings as { stories?: unknown })?.stories).data
  return storyEntryPresentation(before, after, fields, {
    main: Object.fromEntries(catalog?.mainTags.map(tag => [tag.id, tag.label]) ?? []),
    secondary: Object.fromEntries(catalog?.secondaryTags.map(tag => [tag.id, tag.label]) ?? []),
  })
}
async function savedStory(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
): Promise<SavedStory> {
  const sql = `SELECT p.id AS page_id,p.revision::text AS page_revision,e.draft_version_id AS entry_version_id,v.schema_version_id,v.values,live.values AS live_values,s.fields,s.sort AS settings
 FROM collections c JOIN collection_entries e ON e.collection_id=c.id JOIN collection_entry_versions v ON v.id=e.draft_version_id
 JOIN collection_schema_versions s ON s.id=v.schema_version_id LEFT JOIN collection_entry_versions live ON live.id=e.published_version_id
 JOIN pages p ON p.site_id=c.site_id AND app.page_path(p.slug)=v.values->>'story_url' AND p.archived_at IS NULL
 WHERE c.site_id=$1 AND c.id=$2 AND c.reader_key='stories' AND e.id=$3 AND e.archived_at IS NULL
 AND (app.is_super_admin() OR EXISTS(SELECT 1 FROM site_memberships WHERE site_id=c.site_id AND user_id=app.current_user_id() AND role IN('contributor','editor','site_admin')))`
  let row = (await client.query<SavedStory>(sql, [siteId, collectionId, entryId])).rows[0]
  if (!row) throw new DomainError('not_found', 'This story and its article are unavailable.')

  return row
}
export async function prepareSingleStoryReview(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
): Promise<StoryReviewPreparation> {
  const row = await savedStory(client, siteId, collectionId, entryId)
  if (!hasStoryText(row.values))
    throw new DomainError('invalid_state', 'Add the story text before sending it for review.')
  const photo = storyPhotoInput(row.values.photo)
  if (!photo?.description.trim())
    throw new DomainError('invalid_state', 'Choose a lead photo and describe it before sending this story for review.')
  return {
    pageId: row.page_id,
    pageRevision: row.page_revision,
    entryVersionId: row.entry_version_id,
    hasDate: Boolean(row.values.published_date),
    presentation: storyReviewPresentation(row.live_values, row.values, row.fields, row.settings),
  }
}
export async function submitSingleStoryReview(
  client: Queryable,
  siteId: string,
  collectionId: string,
  entryId: string,
  prepared: Pick<StoryReviewPreparation, 'pageId' | 'pageRevision' | 'entryVersionId'>,
  note: string,
) {
  const submitted = (
    await client.query<{ submission_id: string; version_id: string; revision: string }>(
      'SELECT * FROM app.submit_story_for_review($1,$2,$3,$4,$5,$6,$7)',
      [siteId, collectionId, entryId, prepared.pageId, prepared.pageRevision, prepared.entryVersionId, note],
    )
  ).rows[0]!
  if (
    !(
      await client.query('SELECT submission_id FROM story_review_pins WHERE submission_id=$1', [
        submitted.submission_id,
      ])
    ).rowCount
  )
    throw new DomainError('invalid_state', 'This article could not be paired with its story. No review was sent.')
  return {
    submissionId: submitted.submission_id,
    versionId: submitted.version_id,
    revision: String(submitted.revision),
  }
}
