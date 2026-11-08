import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { getSite, roleLabel } from '../../../../../lib/queries.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { getSiteSettingsWorkspace } from '../../../../../lib/site-settings.ts'
import { SocialAccountsWorkspace } from './workspace.tsx'
import shared from '../../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function SocialAccounts({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (
    !site ||
    site.original_design ||
    (!session.principal.isSuperAdmin && session.principal.memberships.get(siteId) !== 'site_admin')
  )
    notFound()
  const [initial, role] = await Promise.all([
    getSiteSettingsWorkspace(session.principal.userId, siteId),
    roleLabel(session.principal.userId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm}>
        <SocialAccountsWorkspace
          key={siteId}
          siteId={siteId}
          siteName={site.name}
          archived={site.status === 'archived'}
          initial={initial}
        />
      </main>
    </AppShell>
  )
}
