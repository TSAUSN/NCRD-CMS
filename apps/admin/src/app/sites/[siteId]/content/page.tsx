import shared from '../../../../components/workspace.module.css'
import { listCollectionReviews } from '../../../../lib/collection-review.ts'
import { notFound } from 'next/navigation'
import { AppShell } from '../../../../components/app-shell.tsx'
import { navigationFor } from '../../../../components/nav.ts'
import { PageHeader } from '../../../../components/shell.tsx'
import {
  collectionRights,
  getCollectionWorkspace,
  listCollectionDocuments,
} from '../../../../lib/collection-queries.ts'
import { getSite, listMediaAssets, roleLabel } from '../../../../lib/queries.ts'
import { currentSession } from '../../../../lib/session.ts'
import { CollectionsWorkspace } from './collections-workspace.tsx'

export const dynamic = 'force-dynamic'

export default async function ContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ collection?: string; entry?: string; all?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const { collection, entry, all } = await searchParams
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const [workspace, rights, role, media, reviews, documents] = await Promise.all([
    getCollectionWorkspace(session.principal.userId, site.id, collection),
    collectionRights(session.principal.userId, site.id),
    roleLabel(session.principal.userId),
    listMediaAssets(session.principal.userId, site.id),
    listCollectionReviews(session.principal.userId, { siteId: site.id }),
    listCollectionDocuments(session.principal.userId, site.id),
  ])

  const unavailable = Boolean(collection && !workspace.collections.some(list => list.id === collection))
  const totalItems = workspace.collections.reduce((sum, item) => sum + item.totalEntries, 0)
  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main id="main" className={'wrap wrap-wide ' + shared.page + ' ' + shared.compactForm} data-layout="compact">
        <PageHeader
          density="compact"
          showWayfinding={false}
          actions={<div id={'list-actions-' + site.id} />}
          crumbs={[{ label: 'Sites', href: '/' }, { label: site.name, href: `/sites/${site.id}` }, { label: 'Lists' }]}
          title="Lists"
          sub={
            <>
              <span>Update something once and every page that shows it changes.</span>
              <span aria-hidden="true">·</span>
              <span>
                {workspace.collections.length} {workspace.collections.length === 1 ? 'list' : 'lists'}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {totalItems} {totalItems === 1 ? 'item' : 'items'}
              </span>
            </>
          }
          lede={undefined}
        />
        {unavailable && <p role="status">That list is unavailable. Choose a list below.</p>}
        <CollectionsWorkspace
          actorId={session.principal.userId}
          headerActionsId={'list-actions-' + site.id}
          initialEntryId={entry && /^[0-9a-f-]{36}$/i.test(entry) ? entry : undefined}
          siteId={site.id}
          siteName={site.name}
          initial={all === '1' || unavailable ? { ...workspace, selected: null } : workspace}
          rights={rights}
          reviews={reviews}
          documents={documents}
          media={media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
        />
      </main>
    </AppShell>
  )
}
