import 'server-only'
import { asUser } from '@cms/platform'
import { readStorySourceStatus } from './story-source-check.ts'
import { listMediaAssets } from './queries.ts'
import { storiesCatalog } from './stories-catalog.ts'
import { storyListValues, type StoryListRow } from './story-list.ts'
import { hasStoryText } from './stories-model.ts'
import { getCollectionWorkspace } from './collection-queries.ts'
export async function getStoriesWorkspace(userId: string, siteId: string) {
  const id = await asUser(
    { userId },
    async c =>
      (await c.query("SELECT id FROM collections WHERE site_id=$1 AND reader_key='stories'", [siteId])).rows[0]?.id,
  )
  if (!id) return null
  const workspace = await getCollectionWorkspace(userId, siteId, id)
  return workspace.selected?.readerKey === 'stories' ? workspace.selected : null
}
export function storyPage(userId: string, siteId: string, path: unknown) {
  if (typeof path !== 'string' || !/^\/stories\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)) return Promise.resolve(null)
  return asUser(
    { userId },
    async c =>
      (
        await c.query(
          'SELECT p.id,p.title,p.draft_version_id AS "versionId",p.published_version_id AS "publishedVersionId" FROM pages p WHERE p.site_id=$1 AND p.slug=$2 AND p.archived_at IS NULL',
          [siteId, path.slice(1)],
        )
      ).rows[0] ?? null,
  )
}

export async function getStoryListState(userId: string, siteId: string, slug: string) {
  const [list, media] = await Promise.all([getStoriesWorkspace(userId, siteId), listMediaAssets(userId, siteId)])
  if (!list) return null
  const photoPreview = (values: Record<string, unknown>) => {
    const photo = values.photo && typeof values.photo === 'object' ? (values.photo as { src?: unknown }) : null,
      src = typeof photo?.src === 'string' ? photo.src : ''
    const id = /^\/media\/([0-9a-f-]{36})\//i.exec(src)?.[1],
      asset = id ? media.find(m => m.id === id && !m.deletedAt) : null
    if (asset) return asset.previewUrl
    return src.startsWith('/cms-samples/') && !src.includes('\\') ? src : null
  }
  const sourceStatus = await asUser({ userId }, client => readStorySourceStatus(client, list.id))
  const rows: StoryListRow[] = list.entries
    .filter(e => !e.archived)
    .map(e => ({
      id: e.id!,
      stableKey: e.stableKey,
      values: storyListValues(e.values),
      published: e.publishedArchived || !e.publishedValues ? null : storyListValues(e.publishedValues),
      changed: JSON.stringify(e.values) !== JSON.stringify(e.publishedValues),
      hasText: hasStoryText(e.values),
      photoPreview: photoPreview(e.values),
    }))
    .sort((a, b) => String(b.values.published_date ?? '').localeCompare(String(a.values.published_date ?? '')))
  return {
    newsroomReady:
      list.draft.fields.some(field => field.key === 'newsroom_rank' && field.type === 'number') &&
      list.draft.fields.some(field => field.key === 'author' && field.type === 'text'),
    sourceStatus,
    collectionId: list.id,
    catalogRevision: String(list.revision),
    entryRevision: String(list.entryRevision),
    settings: storiesCatalog(list.draft, slug),
    publishedSettings: storiesCatalog(list.published ?? list.draft, slug),
    ready: Boolean(list.draft.presentation.stories),
    catalogChanged: list.draftSchemaVersionId !== list.publishedSchemaVersionId,
    rows,
    media,
  }
}
