import { randomUUID } from 'node:crypto'
import { asUser } from '@cms/platform'
import { notFound } from 'next/navigation'
import { currentSession } from '../../../../../lib/session.ts'
import { getSite } from '../../../../../lib/queries.ts'
import { collectionRights } from '../../../../../lib/collection-queries.ts'
import { getStoriesWorkspace } from '../../../../../lib/stories-workspace.ts'
import { storiesCatalog } from '../../../../../lib/stories-catalog.ts'
import { readStoryPlacement } from '../../../../../lib/story-placement-repository.ts'
import { StoryEditor } from '../[entryId]/story-editor.tsx'
export const dynamic = 'force-dynamic'
export default async function NewStoryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const role = session.principal.memberships.get(siteId)
  if (!session.principal.isSuperAdmin && role !== 'site_admin' && role !== 'editor' && role !== 'contributor')
    notFound()
  const [list, rights] = await Promise.all([
    getStoriesWorkspace(session.principal.userId, siteId, 'none'),
    collectionRights(session.principal.userId, siteId),
  ])
  if (!list || !rights.editEntries) notFound()
  const id = randomUUID(),
    candidate = { id, stableKey: 'new-' + id, createdAt: new Date().toISOString() },
    placementContext = await asUser({ userId: session.principal.userId }, c =>
      readStoryPlacement(c, siteId, list.id, candidate),
    ).catch(() => null)
  return (
    <StoryEditor
      key="new"
      newDraft={{ requestId: id }}
      superAdmin={session.principal.isSuperAdmin}
      catalog={storiesCatalog(list.draft, site.slug)}
      authorAvailable={list.draft.fields.some(field => field.key === 'author' && field.type === 'text')}
      configured={Boolean(list.draft.presentation.stories)}
      site={{ id: site.id, name: site.name }}
      collectionId={list.id}
      initialRevision={String(list.entryRevision)}
      entry={{
        id,
        stableKey: candidate.stableKey,
        values: {
          title: '',
          summary: '',
          body: '',
          body_is_sample: false,
          tags: '',
          regions: '',
          region: '',
          published_date: '',
          countries: '',
        },
      }}
      placementContext={placementContext}
      rights={rights}
      page={null}
    />
  )
}
