import { asUser } from '@cms/platform'

export type SiteAssignment = { siteId: string; role: 'contributor' | 'editor' | 'site_admin' }
export type PageAssignment = { pageId: string; siteId: string; chapterId: string; title: string; enabled: boolean }
export type DivisionAssignment = { divisionId: string; siteId: string; name: string }
export type PersonRow = {
  id: string
  email: string
  display_name: string
  status: 'active' | 'disabled'
  revision: string
  accepted: boolean
  super_admin: boolean
  memberships: SiteAssignment[]
  pageAssignments: PageAssignment[]
  divisionAssignments: DivisionAssignment[]
  invitation_status: 'pending' | 'running' | 'delivered' | 'dead' | null
  invitation_error: string | null
  invitation_attempts: number | null
  invitation_cancelled: boolean
}

export function listPeople(userId: string): Promise<PersonRow[]> {
  return asUser(
    { userId },
    async client =>
      (
        await client.query<PersonRow>(`
    SELECT u.id,u.email,u.display_name,u.status,u.revision,u.auth_subject IS NOT NULL AS accepted,
      EXISTS(SELECT 1 FROM global_roles WHERE user_id=u.id) AS super_admin,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('siteId',m.site_id,'role',m.role) ORDER BY m.site_id)
        FROM site_memberships m WHERE m.user_id=u.id),'[]') AS memberships,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('pageId',p.id,'siteId',p.site_id,'chapterId',c.id,'title',v.config->>'name',
        'enabled',u.status='active' AND p.archived_at IS NULL AND s.archived_at IS NULL AND v.config->>'updateMode'='chapter-editors') ORDER BY lower(v.config->>'name'),p.id)
        FROM page_memberships m JOIN pages p ON p.id=m.page_id JOIN sites s ON s.id=p.site_id
        JOIN chapters c ON c.site_id=p.site_id JOIN chapter_versions v ON v.id=c.draft_version_id AND v.config->>'pageId'=p.id::text
        WHERE m.user_id=u.id),'[]') AS "pageAssignments",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('divisionId',d.id,'siteId',d.site_id,'name',d.name) ORDER BY lower(d.name),d.id)
        FROM chapter_division_memberships m JOIN chapter_divisions d ON d.id=m.division_id WHERE m.user_id=u.id),'[]') AS "divisionAssignments",
      invitation.status AS invitation_status,invitation.last_error AS invitation_error,
      invitation.attempts AS invitation_attempts,COALESCE(invitation.cancelled,false) AS invitation_cancelled
    FROM app_users u LEFT JOIN LATERAL (
      SELECT o.status,o.last_error,o.attempts,d.cancelled FROM outbox o
      LEFT JOIN email_deliveries d ON d.event_id=o.id
       WHERE o.event_type='user.invited' AND o.payload->>'user_id'=u.id::text
       ORDER BY o.id DESC LIMIT 1
    ) invitation ON true
    WHERE app.is_super_admin() ORDER BY lower(u.display_name),u.email
  `)
      ).rows,
  )
}

export function recentlyAuthenticated(authenticatedAt: number | undefined, now = Date.now()): boolean {
  return (
    authenticatedAt !== undefined &&
    Number.isFinite(authenticatedAt) &&
    authenticatedAt * 1000 >= now - 15 * 60_000 &&
    authenticatedAt * 1000 <= now + 30_000
  )
}
