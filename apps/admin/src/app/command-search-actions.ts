'use server'
import { currentSession } from '../lib/session.ts'
import { commandSearch } from '../lib/command-search.ts'
export async function searchWorkspace(query: string) {
  const session = await currentSession()
  if (!session || typeof query !== 'string' || query.length > 120)
    throw new Error('Search is unavailable. Sign in and try again.')
  return commandSearch(session.principal.userId, query)
}
