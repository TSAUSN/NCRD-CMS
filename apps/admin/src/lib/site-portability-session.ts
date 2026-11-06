import 'server-only'
import { currentSession, authProvider } from './session.ts'
import { recentlyAuthenticated } from './people.ts'
export async function portabilitySession() {
  const session = await currentSession()
  return session
    ? {
        userId: session.principal.userId,
        isSuperAdmin: session.principal.isSuperAdmin,
        recentlyAuthenticated: authProvider().name === 'local' || recentlyAuthenticated(session.authenticatedAt),
      }
    : null
}
