import shared from '../../../../components/workspace.module.css'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader, siteAreaTabs } from '../../../../components/shell.tsx'
import { authoringRights, getSite, roleLabel } from '../../../../lib/queries.ts'
import { listMediaLibrary } from '../../../../lib/media-organization-repository.ts'
import { currentSession } from '../../../../lib/session.ts'
import { MediaWorkspace } from './media-workspace.tsx'

export const dynamic = 'force-dynamic'

export default async function MediaLibraryPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()

  const initialQuery = {
    search: '',
    status: 'all' as const,
    scope: 'all' as const,
    folder: '',
    tag: '',
    sort: 'newest' as const,
    page: 1,
    pageSize: 24,
  }
  const [library, role, rights] = await Promise.all([
    listMediaLibrary(session.principal.userId, site.id, initialQuery),
    roleLabel(session.principal.userId),
    authoringRights(session.principal.userId, site.id),
  ])

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main
        id="main"
        className={site.original_design ? 'wrap wrap-wide' : 'wrap wrap-wide ' + shared.page + ' ' + shared.compactForm}
      >
        {site.original_design && (
          <PageHeader
            crumbs={[
              { label: 'Sites', href: '/' },
              { label: site.name, href: `/sites/${site.id}` },
              { label: 'Media' },
            ]}
            title="Media"
            lede="Upload pictures, organise files, and see where they are used. Descriptions can be adjusted for each use."
            tabs={siteAreaTabs(site.id, 'media', 'media')}
          />
        )}
        <MediaWorkspace
          native={!site.original_design}
          siteId={site.id}
          initialResult={library}
          canManage={rights.site}
          canManageShared={rights.global}
        />
      </main>
    </AppShell>
  )
}
