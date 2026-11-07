import { currentSession } from '../../../lib/session.ts'
import { listSiteChoices } from '../../../lib/site-choice-queries.ts'
export const dynamic = 'force-dynamic'
export async function GET() {
  const headers = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }
  const session = await currentSession()
  if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401, headers })
  const sites = await listSiteChoices(session.principal.userId)
  return Response.json({ sites }, { headers })
}
