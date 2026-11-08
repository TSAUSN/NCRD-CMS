import { notFound } from 'next/navigation'
import { asUser } from '@cms/platform'
import { AppShell } from '../../../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../../../components/nav.ts'
import { PageHeader } from '../../../../../../components/shell.tsx'
import { currentSession } from '../../../../../../lib/session.ts'
import { getSite, authoringRights, roleLabel } from '../../../../../../lib/queries.ts'
import { getDefinitionSource } from '../../../../../../lib/definition-source.ts'
import { listSectionUpdatePages } from '../../../../../../lib/section-page-updates.ts'
import { SectionPageUpdates } from './section-page-updates.tsx'
export const dynamic = 'force-dynamic'
export default async function UpdatePages({ params }: { params: Promise<{ siteId: string; definitionId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId, definitionId } = await params
  const userId = session.principal.userId
  const site = await getSite(userId, siteId)
  if (!site || site.status === 'archived') notFound()
  const [source, rights, role] = await Promise.all([
    getDefinitionSource(userId, siteId, definitionId),
    authoringRights(userId, siteId),
    roleLabel(userId),
  ])
  if (!source || source.placement !== 'page' || !rights.site) notFound()
  const pages = await asUser({ userId }, client => listSectionUpdatePages(client, siteId, definitionId, source.version))
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className="wrap">
        <PageHeader
          title={`Update pages using ${source.name}`}
          crumbs={[
            { label: 'All sites', href: '/' },
            { label: site.name, href: `/sites/${siteId}` },
            { label: 'Sections', href: `/sites/${siteId}/sections` },
            { label: source.name, href: `/sites/${siteId}/sections/${definitionId}` },
            { label: 'Update pages' },
          ]}
          lede={`Review version ${source.version} on pages you administer. Updates affect saved drafts; publishing remains a separate step.`}
        />
        <SectionPageUpdates siteId={siteId} definitionId={definitionId} version={source.version} pages={pages} />
      </main>
    </AppShell>
  )
}
