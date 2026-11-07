import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { currentSession } from '../../../../lib/session.ts'
import {
  getSite,
  getGlobalElementsWorkspace,
  getNavigationWorkspace,
  getDraftTheme,
  canManageTheme,
  roleLabel,
} from '../../../../lib/queries.ts'
import { publicSiteOrigin } from '../../../../lib/public-site-url.ts'
import { readHeaderLogoChoices } from './logo-choices.ts'
import { HeaderMenuWorkspace } from './workspace.tsx'
import styles from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function HeaderPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site || site.original_design) notFound()
  const user = session.principal.userId
  const [frame, menu, theme, allowed, role] = await Promise.all([
    getGlobalElementsWorkspace(user, siteId),
    getNavigationWorkspace(user, siteId),
    getDraftTheme(user, siteId),
    canManageTheme(user, siteId),
    roleLabel(user),
  ])
  if (!frame || !menu || !theme || !allowed) notFound()
  const media = await readHeaderLogoChoices(user, siteId, frame.header.draft)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + styles.page + ' ' + workspaceFormsStyles.compactForm}>
        <HeaderMenuWorkspace
          key={siteId}
          siteId={siteId}
          siteName={site.name}
          initial={frame}
          navigation={menu}
          theme={theme}
          media={media}
          superAdmin={session.principal.isSuperAdmin}
          origin={publicSiteOrigin(site.staging_hostname)}
        />
      </main>
    </AppShell>
  )
}
