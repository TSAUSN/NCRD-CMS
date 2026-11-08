import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { getSite, roleLabel } from '../../../../lib/queries.ts'
import { collectionRights } from '../../../../lib/collection-queries.ts'
import { DEFAULT_DOCUMENT_LIBRARY_QUERY } from '../../../../lib/document-library.ts'
import { listDocuments } from '../../../../lib/document-repository.ts'
import { currentSession } from '../../../../lib/session.ts'
import { DocumentsWorkspace } from './workspace.tsx'
import './documents.css'

export const dynamic = 'force-dynamic'
export default async function DocumentsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const userId = session.principal.userId
  const site = await getSite(userId, siteId)
  if (!site) notFound()
  const [initial, role, rights] = await Promise.all([
    listDocuments(userId, siteId, DEFAULT_DOCUMENT_LIBRARY_QUERY),
    roleLabel(userId),
    collectionRights(userId, siteId),
  ])
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main
        id="main"
        className={
          site.original_design
            ? 'wrap wrap-wide'
            : 'wrap wrap-wide ' + shared.page + ' ' + workspaceFormsStyles.compactForm
        }
      >
        <PageHeader
          density="compact"
          showWayfinding={Boolean(site.original_design)}
          crumbs={[{ label: 'Sites', href: '/' }, { label: site.name, href: `/sites/${siteId}` }, { label: 'Media' }]}
          title="Media"
          lede="Images and documents for this site. Link a document from any page or list item."
          tabs={siteAreaTabs(siteId, 'media', 'documents')}
        />
        <DocumentsWorkspace
          key={siteId}
          siteId={siteId}
          initial={initial}
          canEdit={rights.editEntries && site.status !== 'archived'}
        />
      </main>
    </AppShell>
  )
}
