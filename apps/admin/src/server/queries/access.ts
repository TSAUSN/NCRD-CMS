import { roleDisplayName } from '../../lib/role-display.ts'
import 'server-only'
import { asUser } from '@cms/platform'

export type AuthoringRights = {
  /** May author a section every site can use. */
  global: boolean
  /** May author a section for this one site. */
  site: boolean
}

/**
 * What this person is allowed to author, asked of the database's own predicates.
 *
 * Deliberately the same two functions migration 0029's command calls, so the
 * screen and the command cannot disagree about who may do what. A UI that
 * offered a choice the command refuses is a UI that teaches people their work
 * was lost; one that hid a choice the command allows is a feature nobody can
 * find. Both are the same bug — the screen guessing — and this removes the
 * guess rather than making it more careful.
 */
export function authoringRights(userId: string, siteId: string): Promise<AuthoringRights> {
  return asUser({ userId }, async client => {
    const { rows } = await client.query<{ global: boolean; site: boolean }>(
      'SELECT app.is_super_admin() AS global, app.can_administer_site($1) AS site',
      [siteId],
    )
    const row = rows[0]
    return { global: row?.global === true, site: row?.site === true || row?.global === true }
  })
}

/** Whether this person is a super admin, asked of the database's own predicate. */
/**
 * What to call this person in the sidebar.
 *
 * Read rather than assumed. `global_roles` is self-visible under RLS, so a
 * reader can always learn their own role and never anybody else's, and a person
 * with no global role is described by what they can actually do — edit the
 * sites somebody put them on — rather than being given a title the database
 * does not record.
 */
export function roleLabel(userId: string): Promise<string> {
  return asUser({ userId }, async client => {
    const global = (await client.query<{ role: string }>('SELECT role FROM global_roles WHERE user_id = $1', [userId]))
      .rows[0]
    if (global) {
      return roleDisplayName(global.role)
    }
    const site = (
      await client.query<{ role: string }>(
        `SELECT role FROM site_memberships WHERE user_id = $1
        ORDER BY CASE role WHEN 'site_admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END
        LIMIT 1`,
        [userId],
      )
    ).rows[0]
    if (!site) {
      const scopeRow = (
        await client.query<{ scopes: Record<string, { role: string }>; divisions: Record<string, unknown> }>(
          'SELECT app.current_page_scopes() AS scopes,app.current_division_scopes() AS divisions',
        )
      ).rows[0]
      const scopes = scopeRow?.scopes ?? {}
      return Object.keys(scopeRow?.divisions ?? {}).length
        ? roleDisplayName('editor') + ' · division'
        : Object.values(scopes).some(scope => scope.role === 'editor')
          ? roleDisplayName('editor') + ' · assigned pages'
          : Object.keys(scopes).length
            ? roleDisplayName('contributor') + ' · assigned pages'
            : 'No site access'
    }
    return roleDisplayName(site.role)
  })
}

export function isSuperAdmin(userId: string): Promise<boolean> {
  return asUser(
    { userId },
    async client => (await client.query<{ ok: boolean }>('SELECT app.is_super_admin() AS ok')).rows[0]?.ok === true,
  )
}
