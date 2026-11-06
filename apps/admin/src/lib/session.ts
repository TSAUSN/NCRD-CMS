// Server-side session resolution (SPEC §6.1, D12). Every admin screen awaits
// this before it renders anything user-specific, so there is no auth flash and
// no client-side race to lose.
import 'server-only'
import { cookies } from 'next/headers'
import { cache } from 'react'
import {
  HOSTED_SESSION_COOKIE,
  SESSION_COOKIE,
  configuredAuthProvider,
  resolvePrincipal,
  type AuthProvider,
  type Session,
} from '@cms/platform'

/**
 * The provider seam. Supabase Auth (magic link, then Microsoft/Entra) slots in
 * here without any screen changing; SPEC §12 introduces the hosted account
 * only once the code that needs it exists.
 */
export function authProvider(): AuthProvider {
  return configuredAuthProvider()
}

export const currentSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies()
  if (!jar.has(SESSION_COOKIE) && !jar.has(HOSTED_SESSION_COOKIE)) return null
  const provider = authProvider()
  const token = jar.get(provider.name === 'local' ? SESSION_COOKIE : HOSTED_SESSION_COOKIE)?.value ?? null
  if (!token) return null
  const subject = await provider.verify(token)
  // Authenticated is not authorized: a verified sign-in with no active product
  // record resolves to no session at all.
  return subject ? resolvePrincipal(subject) : null
})
