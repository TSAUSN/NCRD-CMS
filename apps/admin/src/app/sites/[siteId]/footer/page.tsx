import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { currentSession } from '../../../../lib/session.ts'
import { readNativeFrameScreen } from '../read-native-frame-screen.ts'
import { publicSiteOrigin } from '../../../../lib/public-site-url.ts'
import { FooterWorkspace } from './workspace.tsx'
import styles from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function FooterPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const screen = await readNativeFrameScreen(session.principal.userId, siteId, 'footer')
  if (!screen) notFound()
  const { site, role, frame, menu, theme, logos } = screen
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + styles.page + ' ' + workspaceFormsStyles.compactForm}>
        <FooterWorkspace
          key={siteId}
          siteId={siteId}
          siteName={site.name}
          initial={frame}
          navigation={menu}
          theme={theme}
          savedLogos={logos}
          superAdmin={session.principal.isSuperAdmin}
          origin={publicSiteOrigin(site.staging_hostname)}
        />
      </main>
    </AppShell>
  )
}
