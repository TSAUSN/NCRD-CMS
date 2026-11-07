import 'server-only'
import { createHash } from 'node:crypto'
import type { Session } from '@cms/platform'

/** The tab may reuse names only after the server verifies the same person and grants. */
export function sidebarScope({ principal, authenticatedAt }: Session) {
  const order = <T>(map?: ReadonlyMap<string, T>) => [...(map ?? [])].sort(([a], [b]) => a.localeCompare(b))
  const grants = [
    principal.userId,
    authenticatedAt ?? null,
    principal.isSuperAdmin,
    order(principal.memberships),
    order(principal.pageScopes).map(([id, scope]) => [id, scope.siteId, scope.role]),
    order(principal.divisionScopes).map(([id, scope]) => [id, scope.siteId]),
  ]
  return createHash('sha256').update(JSON.stringify(grants)).digest('base64url')
}
