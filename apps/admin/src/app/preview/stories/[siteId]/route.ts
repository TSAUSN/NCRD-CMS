import { currentSession } from '../../../../lib/session.ts'
import { getSite } from '../../../../lib/queries.ts'
import { collectionRights } from '../../../../lib/collection-queries.ts'
import { buildStoryFeedPreview } from '../../../../lib/story-feed-preview.ts'
import { worldChoice, splitChoice } from '../../../../lib/story-widget-choice.ts'
import { storyWidgetQuery } from '@cms/renderer'
import { storyListFilters } from '../../../../lib/story-list.ts'
import { SCRIPTLESS_PREVIEW_CSP, scriptlessPreviewHtml } from '../../../../lib/scriptless-preview.ts'
export const dynamic = 'force-dynamic'
const headers = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store, private',
  'x-content-type-options': 'nosniff',
  'content-security-policy': SCRIPTLESS_PREVIEW_CSP,
  'x-robots-tag': 'noindex, nofollow',
}
export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  const { siteId } = await params
  if (!session || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId))
    return new Response('<p>This preview is unavailable. <a href="/sign-in">Sign in</a> and try again.</p>', {
      status: 404,
      headers,
    })
  const userId = session.principal.userId
  const [site, rights] = await Promise.all([getSite(userId, siteId), collectionRights(userId, siteId)])
  if (!site || (!rights.editEntries && !rights.manageSchema && !rights.publish))
    return new Response(
      '<p>This preview is unavailable for this account. <a href="/sites">Return to your sites</a>.</p>',
      { status: 404, headers },
    )
  const query = new URL(request.url).searchParams
  const rawPage = Number(query.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  try {
    const html = await buildStoryFeedPreview(
      userId,
      siteId,
      site.slug,
      ['world', 'split'].includes(query.get('widget') ?? '')
        ? { q: '', status: 'all', main: '', secondary: '' }
        : storyListFilters(query),
      page,
      query.get('widget') === 'world' ? worldChoice(query) : undefined,
      storyWidgetQuery(query),
      query.get('widget') === 'split' ? splitChoice(query) : undefined,
    )
    return html
      ? new Response(scriptlessPreviewHtml(html), { headers })
      : new Response(
          '<p>The preview is not ready. <a href="/sites/' +
            siteId +
            '/stories">Back to Stories</a> to save and try again.</p>',
          { status: 422, headers },
        )
  } catch {
    return new Response(
      '<p>The preview could not be opened. Saved drafts are unchanged. <a href="">Try again</a> or go <a href="/sites/' +
        siteId +
        '/stories">Back to Stories</a>.</p>',
      { status: 503, headers },
    )
  }
}
