import { asUser } from '@cms/platform'
import { revalidatePath } from 'next/cache'
import { currentSession } from '../../../../../../lib/session.ts'
import { createStorySourceCheckHandler } from '../../../../../../lib/story-source-check-handler.ts'
import { checkStorySource, readSawsoStoriesSource } from '../../../../../../lib/story-source-check.ts'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const handle = createStorySourceCheckHandler({
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
  currentUser: async () => (await currentSession())?.principal.userId ?? null,
  check: async (userId, siteId, collectionId, requestId) => {
    const result = await checkStorySource(
      { run: fn => asUser({ userId, requestId }, fn), readFeed: readSawsoStoriesSource },
      siteId,
      collectionId,
      requestId,
    )
    revalidatePath('/sites/' + siteId + '/stories', 'layout')
    revalidatePath('/sites/' + siteId + '/publishing')
    revalidatePath('/sites/' + siteId + '/pages')
    return result
  },
})
export async function POST(request: Request, context: { params: Promise<{ siteId: string }> }) {
  return handle(request, (await context.params).siteId)
}
