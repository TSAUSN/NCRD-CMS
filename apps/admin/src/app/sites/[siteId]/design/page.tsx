import { canvasSiteHostname } from '../../../../lib/canvas-frame-policy.ts'
import { publicSiteOrigin } from '../../../../lib/public-site-url.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import {
  canManageTheme,
  getSite,
  getThemeWorkspace,
  getGlobalElementsWorkspace,
  canManageGlobalElements,
  getNavigationWorkspace,
  listMediaAssets,
  roleLabel,
} from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { SiteLookWorkspace } from './site-look-workspace.tsx'
import styles from '../../../../components/workspace.module.css'

export const dynamic = 'force-dynamic'

export default async function DesignPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [workspace, canManage, role, frame, canFrame, media, hostname, menu] = await Promise.all([
    getThemeWorkspace(session.principal.userId, site.id),
    canManageTheme(session.principal.userId, site.id),
    roleLabel(session.principal.userId),
    getGlobalElementsWorkspace(session.principal.userId, site.id),
    canManageGlobalElements(session.principal.userId, site.id),
    listMediaAssets(session.principal.userId, site.id),
    canvasSiteHostname(session.principal.userId, site.id, 'site'),
    getNavigationWorkspace(session.principal.userId, site.id),
  ])
  if (!workspace || !frame || !menu) notFound()

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + styles.page}>
        <PageHeader
          showWayfinding={site.original_design === true}
          density={site.original_design ? undefined : 'compact'}
          tabs={
            site.original_design
              ? undefined
              : [
                  { label: 'Colours', href: '/sites/' + site.id + '/design', current: true },
                  ...(canManage ? [{ label: 'Fonts', href: '/sites/' + site.id + '/design/fonts' }] : []),
                  { label: 'Buttons', href: '/sites/' + site.id + '/design#theme-button-title' },
                ]
          }
          crumbs={[
            { label: 'Sites', href: '/' },
            { label: site.name, href: `/sites/${site.id}` },
            { label: site.original_design ? 'Menu & footer' : 'Site look' },
          ]}
          title={site.original_design ? 'Menu & footer' : 'Site look'}
          lede={
            site.original_design
              ? 'Edit text and links on the real site. Its original design stays in place. Save a draft, then review the changes in Publish.'
              : 'Colours, type and buttons for every page and section on this site.'
          }
        />
        <SiteLookWorkspace
          isolatedOrigin={publicSiteOrigin(hostname)}
          siteId={site.id}
          siteName={site.name}
          menu={menu.draft}
          theme={workspace}
          frame={frame}
          canTheme={canManage}
          canFrame={canFrame}
          media={media.filter(asset => asset.status === 'ready')}
        />
      </main>
    </AppShell>
  )
}
