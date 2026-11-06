import { validRecoveryHead, type RecoveryHead, type RecoveryScope } from './page-recovery.ts'

type Dependencies = {
  currentUser(): Promise<string | null>
  /** Reads one current head through the caller's RLS identity. Archived pages
   * and sites must return null, because recovery would be a new draft edit. */
  readHead(scope: RecoveryScope): Promise<RecoveryHead | null>
}
const headers = { 'cache-control': 'no-store, private', vary: 'Cookie', 'x-content-type-options': 'nosniff' }

/** Revalidate the principal before exposing a browser copy, including an old
 * editor left open while another tab signs into a different account. This is
 * an authorized read; the ordinary save command retains write/CAS authority. */
export function createPageRecoveryHeadHandler(dependencies: Dependencies) {
  return async (request: Request, pageId: string): Promise<Response> => {
    const userId = await dependencies.currentUser()
    const query = new URL(request.url).searchParams
    if (!userId || userId !== query.get('user')) {
      return Response.json(
        { message: 'Your sign-in changed. Reload this page before opening browser recovery.' },
        { status: 403, headers },
      )
    }
    const siteId = query.get('site')
    if (!siteId || !pageId)
      return Response.json({ message: 'This page is unavailable for recovery.' }, { status: 404, headers })
    const scope = { userId, siteId, pageId }
    const head = await dependencies.readHead(scope)
    if (!head || !validRecoveryHead(head)) {
      return Response.json(
        { message: 'This page is unavailable for recovery. It may have been archived or your access changed.' },
        { status: 404, headers },
      )
    }
    return Response.json({ scope, head }, { headers })
  }
}
