import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/ui/page-header.tsx'
import { currentSession } from '../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { getRedirectWorkspace } from '../../../../lib/redirects.ts'
import { RedirectWorkspace } from './workspace.tsx'
import { SettingsNavigation } from '../../../../components/settings-navigation.tsx'
import workspace from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function Redirects({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (
    !site ||
    site.status === 'archived' ||
    (!session.principal.isSuperAdmin && session.principal.memberships.get(siteId) !== 'site_admin')
  )
    notFound()
  const [data, role] = await Promise.all([
    getRedirectWorkspace(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  if (!site.original_design)
    return (
      <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
        <main id="main" className={'wrap wrap-wide ' + workspace.page + ' ' + workspaceFormsStyles.compactForm}>
          <div className={workspace.denseStack} data-layout="compact">
            <PageHeader
              title="Settings"
              density="compact"
              showWayfinding={false}
              sub={
                site.name +
                ' · rules for the whole site. Redirects take effect for published destinations as soon as you save.'
              }
            />
            <div className={workspace.workspaceSplit} data-layout="compact">
              <SettingsNavigation siteId={siteId} current="Redirects" />
              <div className={workspace.denseStack}>
                <RedirectWorkspace actorId={session.principal.userId} siteId={siteId} native {...data} />
              </div>
            </div>
          </div>
        </main>
      </AppShell>
    )
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap wrap-wide">
        <PageHeader
          title="Redirects"
          lede="Keep old links working. Visitors go straight to the published page on this site."
          crumbs={[
            { label: 'All sites', href: '/sites' },
            { label: site.name, href: '/sites/' + siteId },
            { label: 'Settings', href: '/sites/' + siteId + '/settings' },
            { label: 'Redirects' },
          ]}
        />
        <RedirectWorkspace actorId={session.principal.userId} siteId={siteId} {...data} />
      </main>
    </AppShell>
  )
}
