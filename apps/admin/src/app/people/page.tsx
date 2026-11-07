import workspace from '../../components/workspace.module.css'
import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import { TextLink as Link } from '../../components/ui/text-link.tsx'
import { Card } from '../../components/ui/card.tsx'
import { listWorkspacePages } from '../../lib/workspace-queries.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../components/app-shell.tsx'
import { navigationFor } from '../../components/nav.ts'
import { PageHeader } from '../../components/shell.tsx'
import { listPeople } from '../../lib/people.ts'
import { listSites, roleLabel } from '../../lib/queries.ts'
import { currentSession } from '../../lib/session.ts'
import { PeopleWorkspace } from './people-workspace.tsx'

export const dynamic = 'force-dynamic'

export default async function PeoplePage() {
  const session = await currentSession()
  if (!session) notFound()
  const [sites, people, role, pages] = await Promise.all([
    listSites(session.principal.userId),
    session.principal.isSuperAdmin ? listPeople(session.principal.userId) : Promise.resolve([]),
    roleLabel(session.principal.userId),
    session.principal.isSuperAdmin ? Promise.resolve([]) : listWorkspacePages(session.principal.userId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(undefined, session.principal)}>
      <main
        id="main"
        className={'wrap wrap-wide ' + workspace.page + ' ' + workspaceFormsStyles.compactForm}
        data-layout="compact"
      >
        <PageHeader
          density="compact"
          showWayfinding={false}
          actions={session.principal.isSuperAdmin ? <div id="people-actions" /> : undefined}
          title={session.principal.isSuperAdmin ? 'People' : 'Your access'}
          sub={
            session.principal.isSuperAdmin
              ? 'See who can edit each site, chapter page or division, and manage account access.'
              : 'Your assigned sites, chapter pages and divisions. Ask your site team if your access needs to change.'
          }
        />
        {session.principal.isSuperAdmin ? (
          <PeopleWorkspace
            headerActionsId="people-actions"
            people={people}
            currentUserId={session.principal.userId}
            sites={sites.map(({ id, name, status }) => ({ id, name, archived: status === 'archived' }))}
            localMail={
              process.env['MAILER_PROVIDER'] === 'recording' ||
              (process.env.NODE_ENV !== 'production' && !process.env['MAILER_PROVIDER'])
            }
            invitationsEnabled={process.env['INVITATION_EMAIL_ENABLED'] !== 'false'}
          />
        ) : (
          <div className="grid grid-cards">
            {sites.map(site => {
              const whole = session.principal.memberships.get(site.id)
              const divisions = [...(session.principal.divisionScopes?.values() ?? [])].filter(
                scope => scope.siteId === site.id,
              )
              const assigned = pages.filter(
                page => page.site_id === site.id && session.principal.pageScopes?.has(page.id),
              )
              return (
                <Card key={site.id} title={<Link href={'/sites/' + site.id}>{site.name}</Link>}>
                  {whole && (
                    <p>
                      {
                        (
                          {
                            contributor: 'Content creator · changes need approval',
                            editor: 'Site editor · edit and publish',
                            site_admin: 'Admin · manage this site',
                          } as Record<string, string>
                        )[whole]
                      }
                    </p>
                  )}
                  {divisions.map(division => (
                    <p key={division.name}>
                      Site editor · {division.name}. You can edit and approve this division’s chapter pages.
                    </p>
                  ))}
                  {assigned.length > 0 && (
                    <>
                      <h3>Your chapter pages</h3>
                      <ul>
                        {assigned.map(page => (
                          <li key={page.id}>
                            <Link href={'/pages/' + page.id}>{page.title}</Link>
                            {session.principal.pageScopes?.get(page.id)?.role === 'contributor'
                              ? ' · changes need approval'
                              : ' · edit and approve'}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {!whole && divisions.length === 0 && assigned.length > 0 && (
                    <p>
                      Only your assigned pages are available. Shared sections, menu and site look are kept by the site
                      team.
                    </p>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </main>
    </AppShell>
  )
}
