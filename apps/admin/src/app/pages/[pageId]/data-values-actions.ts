'use server'
import { currentSession } from '../../../lib/session.ts'
import { pageDataValues } from '../../../lib/data-values.ts'
export async function readPageNumbers(pageId: string) {
  const session = await currentSession()
  if (!session) return { ok: false as const, message: 'Sign in again before choosing a saved number.' }
  try {
    return { ok: true as const, numbers: await pageDataValues(session.principal.userId, pageId) }
  } catch {
    return {
      ok: false as const,
      message: 'The saved numbers could not be loaded. Keep your typed number or try again.',
    }
  }
}
