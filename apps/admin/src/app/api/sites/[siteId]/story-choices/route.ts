import { currentSession } from '../../../../../lib/session.ts'
import { getStoriesWorkspace } from '../../../../../lib/stories-workspace.ts'
import { collectionRights } from '../../../../../lib/collection-queries.ts'
export const dynamic = 'force-dynamic'
const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession(),
    { siteId } = await params
  if (!session || !/^[a-f0-9-]{36}$/i.test(siteId))
    return Response.json({ error: 'Stories are unavailable.' }, { status: 404, headers })
  const user = session.principal.userId,
    rights = await collectionRights(user, siteId)
  if (!rights.editEntries)
    return Response.json({ error: 'Stories are unavailable for this role.' }, { status: 404, headers })
  const list = await getStoriesWorkspace(user, siteId),
    query = (new URL(request.url).searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 120)
  const choices = (list?.entries ?? [])
    .filter(
      entry =>
        !entry.archived &&
        typeof entry.values.title === 'string' &&
        typeof entry.values.story_url === 'string' &&
        /^\/stories\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.values.story_url) &&
        (!query ||
          [entry.values.title, entry.values.summary].some(
            value => typeof value === 'string' && value.toLowerCase().includes(query),
          )),
    )
    .sort((a, b) => String(b.values.published_date ?? '').localeCompare(String(a.values.published_date ?? '')))
    .slice(0, 12)
    .map(entry => ({
      id: entry.stableKey,
      title: String(entry.values.title),
      description: String(entry.values.summary ?? ''),
      photo: entry.values.photo ?? null,
      photoIsSample: entry.values.photo_is_sample === true,
      url: String(entry.values.story_url),
    }))
  return Response.json({ choices }, { headers })
}
