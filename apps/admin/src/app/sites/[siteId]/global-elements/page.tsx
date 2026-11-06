import { contentCountsForPages } from '../../../../lib/content-counts.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import {
  canManageGlobalElements,
  getGlobalElementsWorkspace,
  getSite,
  isSuperAdmin,
  listMediaAssets,
  roleLabel,
} from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { GlobalElementsEditor } from './global-elements-editor.tsx'

export const dynamic = 'force-dynamic'

export default async function GlobalElementsPage({ params }: { params: Promise<{ siteId: string }> }) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [workspace, canManage, superAdmin, media, role] = await Promise.all([
    getGlobalElementsWorkspace(session.principal.userId, site.id),
    canManageGlobalElements(session.principal.userId, site.id),
    isSuperAdmin(session.principal.userId),
    listMediaAssets(session.principal.userId, site.id),
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
            { label: 'Header & footer' },
          ]}
          title="Header & footer"
          sub={
            <span>
              Applies to {workspace.contentSummary ?? contentCountsForPages(workspace.pages)} on {site.name}
            </span>
          }
          lede="The header and footer appear on every page of this site. A change here changes them everywhere."
          actions={
            superAdmin ? (
              <a className="btn secondary" href={`/sites/${site.id}/sections/frames`}>
                Custom designs
              </a>
            ) : undefined
          }
        />
        <GlobalElementsEditor
          siteId={site.id}
          siteName={site.name}
          initial={workspace}
          canManage={canManage}
          superAdmin={superAdmin}
          initialSitePreview={site.initial_release_required || !site.has_published_pages ? 'draft' : 'published'}
          media={media
            .filter(
              asset =>
                asset.status === 'ready' && asset.deletedAt === null && asset.variants.thumbnail && asset.variants.wide,
            )
            .map(asset => ({ id: asset.id, name: asset.name, url: asset.previewUrl ?? '', alt: asset.altText }))}
        />
      </main>
    </AppShell>
  )
}
