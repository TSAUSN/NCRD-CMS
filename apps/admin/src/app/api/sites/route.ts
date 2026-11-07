import { currentSession } from '../../../lib/session.ts'
import { listSitesForSidebar } from '../../../lib/queries.ts'
export const dynamic = 'force-dynamic'
export async function GET() {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  const session = await currentSession()
  if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401, headers })
  const sites = await listSitesForSidebar(session.principal.userId)
  return Response.json(
    { sites: sites.filter(site => site.status !== 'archived').map(({ id, name }) => ({ id, name })) },
    { headers },
  )
}
