import { asUser } from '@cms/platform'
import { readStoryPlacement } from '../../../../../lib/story-placement-repository.ts'
import { storiesCatalog } from '../../../../../lib/stories-catalog.ts'
import { notFound } from 'next/navigation'
import { getSite } from '../../../../../lib/queries.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { collectionRights } from '../../../../../lib/collection-queries.ts'
import { getStoriesWorkspace, storyPage } from '../../../../../lib/stories-workspace.ts'
import { StoryEditor } from './story-editor.tsx'
export const dynamic = 'force-dynamic'
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string; entryId: string }>
  searchParams: Promise<{ intent?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, entryId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(entryId)) notFound()
  const [list, rights] = await Promise.all([
    getStoriesWorkspace(session.principal.userId, site.id, { entryId }),
    collectionRights(session.principal.userId, site.id),
  ])
  const entry = list?.entries[0]
  if (!list || !entry) notFound()
  const [page, placementContext] = await Promise.all([
    storyPage(session.principal.userId, site.id, entry.values.story_url),
    asUser({ userId: session.principal.userId }, client => readStoryPlacement(client, site.id, list.id, entryId)).catch(
      () => null,
    ),
  ])
  const { intent } = await searchParams
  return (
    <StoryEditor
      publicationStatus={
        !page?.publishedVersionId || entry.publishedArchived || !entry.publishedValues
          ? 'Draft'
          : JSON.stringify(entry.values) !== JSON.stringify(entry.publishedValues)
            ? 'Live · changes not published'
            : 'Live'
      }
      key={entryId}
      initialIntent={
        intent === 'preview' || intent === 'publish' || intent === 'schedule' || intent === 'review'
          ? intent
          : undefined
      }
      superAdmin={session.principal.isSuperAdmin}
      catalog={storiesCatalog(list.draft, site.slug)}
      authorAvailable={list.draft.fields.some(field => field.key === 'author' && field.type === 'text')}
      configured={Boolean(list.draft.presentation.stories)}
      site={{ id: site.id, name: site.name }}
      collectionId={list.id}
      initialRevision={String(list.entryRevision)}
      entry={{ ...entry, id: entryId }}
      placementContext={placementContext}
      rights={rights}
      page={page}
    />
  )
}
