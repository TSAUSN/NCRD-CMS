import { notFound } from 'next/navigation'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../components/nav.ts'
import { PageHeader, ButtonLink, Note } from '../../../../../components/ui/index.ts'
import { currentSession } from '../../../../../lib/session.ts'
import { getSite, roleLabel } from '../../../../../lib/queries.ts'
import { StoriesSetup } from './form.tsx'
import shared from '../../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
export const dynamic = 'force-dynamic'
export default async function StoriesSetupPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site || !(session.principal.isSuperAdmin || session.principal.memberships.get(siteId) === 'site_admin'))
    notFound()
  const role = await roleLabel(session.principal.userId)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap ' + shared.page + ' ' + workspaceFormsStyles.compactForm}>
        <PageHeader
          density="compact"
          showWayfinding={false}
          title={site.has_stories ? 'Stories is on' : 'Turn on Stories'}
          lede={site.name}
          actions={
            <ButtonLink variant="secondary" href={'/sites/' + siteId + '/settings?tab=publishing'}>
              Back
            </ButtonLink>
          }
        />
        {site.has_stories ? (
          <Note>
            This site already has Stories.{' '}
            <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories'}>
              Open Stories
            </ButtonLink>
          </Note>
        ) : site.status === 'archived' ? (
          <Note>Restore this site before turning on Stories.</Note>
        ) : (
          <StoriesSetup siteId={siteId} />
        )}
      </main>
    </AppShell>
  )
}
