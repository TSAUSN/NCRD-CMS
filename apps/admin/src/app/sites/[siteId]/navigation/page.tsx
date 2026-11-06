import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import { canManageNavigation, getNavigationWorkspace, getSite, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { NavigationEditor } from './navigation-editor.tsx'

export const dynamic = 'force-dynamic'

export default async function NavigationPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [workspace, canManage, role] = await Promise.all([
    getNavigationWorkspace(session.principal.userId, site.id),
    canManageNavigation(session.principal.userId, site.id),
    roleLabel(session.principal.userId),
  ])
  if (!workspace) notFound()

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap wrap-wide">
        <PageHeader
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${site.id}` },
            { label: 'Navigation' },
          ]}
          title="Navigation"
          sub={
            <>
              <span>
                {workspace.published.length} live menu {workspace.published.length === 1 ? 'item' : 'items'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{workspace.mode === 'auto' ? 'Pages sync automatically' : 'Manual menu'}</span>
            </>
          }
          lede="Arrange how visitors move through this site. Hiding or removing a menu item never deletes its page."
        />
        <NavigationEditor siteId={site.id} siteName={site.name} initial={workspace} canManage={canManage} />
      </main>
    </AppShell>
  )
}
