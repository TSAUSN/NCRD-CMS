// The capability matrix from SPEC §4, in one place. The database enforces the
// same tiers in app.can_publish/app.can_administer_site; this copy exists so
// the product can *show* the right affordances without a round trip, and
// authorization.test.ts asserts the two agree on every cell.
//
// It is never the only check. A UI that hides a button is a courtesy; the
// command is what refuses.

export type SiteRole = 'contributor' | 'editor' | 'site_admin'
export type Capability =
  | 'edit_draft'
  | 'publish'
  | 'review'
  | 'manage_pages'
  | 'manage_site'
  | 'approve_trusted_code'
  | 'manage_platform'

export type Principal = {
  userId: string
  status: 'active' | 'disabled'
  isSuperAdmin: boolean
  memberships: ReadonlyMap<string, SiteRole>
  divisionScopes?: ReadonlyMap<string, { siteId: string; name: string }>
  pageScopes?: ReadonlyMap<string, { siteId: string; role: 'contributor' | 'editor' }>
}

const TIERS: Record<SiteRole, readonly Capability[]> = {
  contributor: ['edit_draft'],
  editor: ['edit_draft', 'publish', 'review', 'manage_pages'],
  site_admin: ['edit_draft', 'publish', 'review', 'manage_pages', 'manage_site'],
}

// Raw markup and platform-wide objects are super-admin only — v1's trusted-code
// boundary, kept exactly (SPEC §4).
const SUPER_ADMIN_ONLY: readonly Capability[] = ['approve_trusted_code', 'manage_platform']

export function siteRoleOf(principal: Principal, siteId: string): SiteRole | null {
  if (principal.status !== 'active') return null
  if (principal.isSuperAdmin) return 'site_admin'
  return principal.memberships.get(siteId) ?? null
}

export function can(principal: Principal, capability: Capability, siteId: string | null): boolean {
  if (principal.status !== 'active') return false
  if (SUPER_ADMIN_ONLY.includes(capability)) return principal.isSuperAdmin
  if (principal.isSuperAdmin) return true
  if (siteId === null) return false
  const role = principal.memberships.get(siteId)
  return role !== undefined && TIERS[role].includes(capability)
}

export function assignedSiteIds(principal: Principal): string[] {
  return principal.status === 'active'
    ? [
        ...new Set([
          ...principal.memberships.keys(),
          ...[...(principal.pageScopes?.values() ?? [])].map(scope => scope.siteId),
          ...[...(principal.divisionScopes?.values() ?? [])].map(scope => scope.siteId),
        ]),
      ]
    : []
}

/** Page assignments never grant a capability on the rest of their site. */
export function pageRoleOf(principal: Principal, siteId: string, pageId: string): SiteRole | null {
  const wholeSite = siteRoleOf(principal, siteId)
  if (wholeSite) return wholeSite
  if (principal.status !== 'active') return null
  const scope = principal.pageScopes?.get(pageId)
  return scope?.siteId === siteId ? scope.role : null
}
