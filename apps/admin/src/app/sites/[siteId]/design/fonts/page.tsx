import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../../lib/queries.ts'
import { getFontLibraryWorkspace } from '../../../../../server/queries/font-library.ts'
import { publicSiteOrigin } from '../../../../../lib/public-site-url.ts'
import styles from '../../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import { FontLibrary } from './workspace.tsx'
export const dynamic = 'force-dynamic'
export default async function FontsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params,
    site = await getSite(session.principal.userId, siteId)
  if (!site || site.original_design) notFound()
  const user = session.principal.userId
  const [initial, role] = await Promise.all([getFontLibraryWorkspace(user, siteId), roleLabel(user)])
  if (!initial) notFound()
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + styles.page + ' ' + workspaceFormsStyles.compactForm}>
        <FontLibrary
          siteId={siteId}
          initial={initial}
          chapter={site.chapters_enabled === true}
          origin={publicSiteOrigin(site.staging_hostname)}
          liveHost={site.primary_hostname ?? null}
        />
      </main>
    </AppShell>
  )
}
