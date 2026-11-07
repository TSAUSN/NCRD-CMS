import { NativeSiteOverview } from './native-site-overview.tsx'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { getCollectionWorkspace } from '../../../lib/collection-queries.ts'
import { listWorkspacePages } from '../../../lib/workspace-queries.ts'
import { listReviewSubmissions } from '../../../lib/review-queries.ts'
import { Card, Disclosure } from '../../../components/ui/index.ts'
import { getPageListControls } from '../../../lib/page-list-workspace.ts'
import { NativePagesTable } from './native-pages-table.tsx'
import { NativeNewPage } from './native-new-page.tsx'
import { PagesTable } from './pages-table.tsx'
import styles from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import { publicSiteOrigin } from '../../../lib/public-site-url.ts'
import { notFound } from 'next/navigation'
import { currentSession } from '../../../lib/session.ts'
import { getSite, listArchivedPages, listSectionLibrary, roleLabel } from '../../../lib/queries.ts'
import { PageHeader } from '../../../components/shell.tsx'
import { AppShell } from '../../../components/app-shell.tsx'
import { navigationFor } from '../../../components/nav.ts'
import { pageStatus, StatusChip, siteStatus } from '../../../components/status.tsx'
import { NewPageForm } from './new-page.tsx'
import { editorialPosture } from '../../../lib/editorial-posture.ts'
import {
  IconAlert,
  IconCheck,
  IconExternal,
  IconPage,
  IconCollection,
  IconSettings,
} from '../../../components/icons.tsx'
import { PageManagement } from './page-management.tsx'
import { SiteHostingNotice } from '../../../components/site-hosting-notice.tsx'

export async function SiteWorkspace({
  params,
  searchParams,
  area = 'overview',
}: {
  area?: 'overview' | 'pages'
  params: Promise<{ siteId: string }>
  searchParams: Promise<{ error?: string; created?: string; siteCreated?: string }>
}) {
  const session = await currentSession()
  if (!session) notFound()
  const { siteId } = await params
  const { error, created, siteCreated } = await searchParams

  // A site the session cannot see returns null here because RLS filtered it —
  // the same answer a site that does not exist gives. No existence oracle.
  const site = await getSite(session.principal.userId, siteId)
  if (!site) notFound()
  const editorCanvasOrigin =
    site.status !== 'archived' && site.has_isolated_page_canvas ? publicSiteOrigin(site.staging_hostname) : null

  const siteRole = session.principal.memberships.get(site.id)
  const scopedOnly = !session.principal.isSuperAdmin && !session.principal.memberships.has(site.id)
  const canManagePages = session.principal.isSuperAdmin || siteRole === 'editor' || siteRole === 'site_admin'
  const nativePages = area === 'pages' && !site.original_design
  // The native overview and native pages use neither the library nor its cards.
  const needsLibrary = canManagePages && (area === 'overview' ? site.original_design : !nativePages)
  const [pages, archivedPages, role, library, reviews, lists] = await Promise.all([
    listWorkspacePages(session.principal.userId, siteId),
    canManagePages ? listArchivedPages(session.principal.userId, siteId) : Promise.resolve([]),
    roleLabel(session.principal.userId),
    needsLibrary
      ? listSectionLibrary(session.principal.userId, site.id).then(entries =>
          entries.filter(entry => (entry.placement ?? 'page') === 'page'),
        )
      : Promise.resolve([]),
    listReviewSubmissions(session.principal.userId, { siteId, includeDecided: false }),
    area === 'overview' && !scopedOnly
      ? getCollectionWorkspace(session.principal.userId, siteId)
      : Promise.resolve(null),
  ])
  const canAdmin = session.principal.isSuperAdmin || siteRole === 'site_admin'
  let pageControlError = false
  const pageControls =
    !site.original_design && !scopedOnly
      ? await getPageListControls(session.principal.userId, siteId).catch(() => {
          pageControlError = true
          return null
        })
      : null
  const ordinaryPages = pages.filter(
    page =>
      !page.slug.startsWith('stories/') &&
      !pageControls?.stories.some(story => story.path === (page.slug ? '/' + page.slug : '/')),
  )
  const liveOrigin =
    site.status === 'archived' || (!site.primary_hostname && site.hosting_status && site.hosting_status !== 'ready')
      ? null
      : publicSiteOrigin(site.primary_hostname || site.staging_hostname)
  const published = pages.filter(page => page.published_version_id !== null).length
  const changed = pages.filter(page => editorialPosture(page).hasUnpublishedChanges).length

  if (area === 'overview' && !site.original_design)
    return (
      <NativeSiteOverview
        site={site}
        editorCanvasOrigin={editorCanvasOrigin}
        principal={session.principal}
        email={session.email}
        role={role}
        pages={ordinaryPages}
        storyCount={pageControls?.stories.length ?? 0}
        archivedPages={archivedPages}
        lists={lists}
        reviews={reviews}
        canManagePages={canManagePages}
        liveOrigin={liveOrigin}
        created={created}
        error={error}
      />
    )

  return (
    <AppShell email={session.email} role={role} groups={navigationFor(site, session.principal)}>
      <main
        id="main"
        className={
          'wrap ' + (nativePages ? styles.page + ' ' + workspaceFormsStyles.compactForm + ' ' + styles.denseStack : '')
        }
        data-layout={nativePages ? 'compact' : undefined}
      >
        <PageHeader
          density={nativePages ? 'compact' : undefined}
          showWayfinding={!nativePages}
          crumbs={
            area === 'pages'
              ? [
                  { label: 'All sites', href: '/sites' },
                  { label: site.name, href: '/sites/' + site.id },
                  { label: 'Pages' },
                ]
              : [{ label: 'All sites', href: '/sites' }, { label: site.name }]
          }
          title={area === 'pages' ? 'Pages' : site.name}
          chip={
            area === 'overview' ? (
              site.status === 'archived' ? (
                <span className="chip chip-neutral">Archived</span>
              ) : (
                <StatusChip
                  status={siteStatus({ ...site, published_count: String(published), changed_count: String(changed) })}
                  size="lg"
                />
              )
            ) : undefined
          }
          sub={
            nativePages ? (
              'Stories are kept in their own place, so this list stays short.'
            ) : (
              <>
                {site.primary_hostname && (
                  <>
                    <span className="mono">{site.primary_hostname}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>
                  {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                </span>
                <span aria-hidden="true">·</span>
                <span>{published === 0 ? 'nothing published yet' : `${published} published`}</span>
                {changed > 0 && published > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="attention-copy">{changed} with changes not live</span>
                  </>
                )}
              </>
            )
          }
          lede={nativePages ? undefined : 'Editing a page changes nothing on the live site until you press Publish.'}
          actions={
            <>
              {nativePages && canAdmin && (
                <Link className="btn secondary" href={'/sites/' + siteId + '/header'}>
                  Edit menu
                </Link>
              )}
              {nativePages && canManagePages && (
                <NativeNewPage siteId={siteId} canAdmin={canAdmin} pages={ordinaryPages} />
              )}
              {!nativePages && canManagePages && (
                <NewPageForm
                  primary
                  siteId={site.id}
                  siteName={site.name}
                  siteAddress={site.staging_hostname ?? site.slug}
                  library={library}
                  pages={pages}
                  designs={
                    site.has_stories
                      ? pages.filter(page =>
                          ['', 'ways-we-help', 'ways-we-help/health', 'annual-reports'].includes(page.slug),
                        )
                      : []
                  }
                  prompt={!pages.length}
                />
              )}
              {!nativePages && liveOrigin && published > 0 && (
                <a className="btn secondary" href={liveOrigin} rel="noopener" target="_blank">
                  <IconExternal size={15} /> {site.primary_hostname ? 'View the live site' : 'View the site'}
                </a>
              )}
            </>
          }
        />

        {!nativePages && !site.primary_hostname && site.status !== 'archived' && (
          <SiteHostingNotice status={site.hosting_status} />
        )}
        {site.initial_release_required && (
          <div className="notice notice-ok" role="status">
            <span className="notice-body">
              <strong>Your new site is private until you publish it.</strong> Open the home page below and click any
              words to change them.
              <p>
                When you press Publish there, the site goes live with its design, header, footer and menu. Speakers,
                sessions and resources are added in <Link href={`/sites/${siteId}/content`}>Lists</Link>, and{' '}
                <Link href={`/sites/${siteId}/publishing`}>Publish</Link> puts several pages live at once.
              </p>
            </span>
          </div>
        )}
        {site.status === 'archived' && (
          <p className="notice" role="status">
            This site is archived and is not available at its public addresses. Its content and history are retained
            here.
          </p>
        )}
        {created && (
          <p className="notice notice-ok" role="status">
            <IconCheck size={16} />
            <span className="notice-body">
              “{created}” was created as a draft. It is not on the live site until you publish it.
            </span>
          </p>
        )}
        {error && (
          <p className="notice notice-error" role="alert">
            <IconAlert size={16} />
            <span className="notice-body">{error}</span>
          </p>
        )}

        <div className={styles.stack}>
          {area === 'overview' && (
            <>
              <section aria-label="Quick actions" className={styles.stack}>
                <h2 className={selectionControlsStyles.visuallyHidden}>Quick actions</h2>
                <div className={styles.grid}>
                  {scopedOnly && pages[0] && (
                    <Link
                      className={siteSummaryStyles.task}
                      editorCanvasOrigin={editorCanvasOrigin}
                      href={'/pages/' + pages[0].id}
                    >
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconPage size={18} />
                      </span>
                      <strong>Edit {pages[0].title}</strong>
                    </Link>
                  )}
                  {pages.find(page => page.slug === '') && (
                    <Link
                      className={siteSummaryStyles.task}
                      editorCanvasOrigin={editorCanvasOrigin}
                      href={'/pages/' + pages.find(page => page.slug === '')!.id}
                    >
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconPage size={18} />
                      </span>
                      <strong>Edit home page</strong>
                    </Link>
                  )}
                  {canManagePages && (
                    <Link className={siteSummaryStyles.task} href={`/sites/${siteId}/pages`}>
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconPage size={18} />
                      </span>
                      <strong>Manage pages</strong>
                    </Link>
                  )}
                  {!scopedOnly && (
                    <Link className={siteSummaryStyles.task} href={`/sites/${siteId}/content`}>
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconCollection size={18} />
                      </span>
                      <strong>Update lists</strong>
                    </Link>
                  )}
                  {!scopedOnly && (
                    <Link className={siteSummaryStyles.task} href={`/sites/${siteId}/design`}>
                      <span className={siteSummaryStyles.taskIcon}>
                        <IconSettings size={18} />
                      </span>
                      <strong>{site.original_design ? 'Edit menu & footer' : 'Change site look'}</strong>
                    </Link>
                  )}
                </div>
              </section>
              <div className={styles.twoColumns}>
                <div className={styles.stack}>
                  <Card title="Needs attention" density="compact">
                    <ul className={siteSummaryStyles.rowList}>
                      {changed === 0 && reviews.length === 0 && !pages.some(page => page.live_samples) && (
                        <li>
                          <span className={siteSummaryStyles.taskIcon}>
                            <IconCheck size={18} />
                          </span>
                          <div className={recordTableStyles.rowCopy}>
                            Everything saved is live. There is nothing waiting for attention.
                          </div>
                        </li>
                      )}
                      {pages
                        .filter(page => editorialPosture(page).hasUnpublishedChanges)
                        .map(page => (
                          <li key={page.id}>
                            <div className={recordTableStyles.rowCopy}>
                              <strong>{page.title}</strong>
                              <span className={recordTableStyles.meta}>
                                {page.published_version_id ? 'Changes not live' : 'Draft'}
                              </span>
                            </div>
                            <Link
                              className="btn secondary"
                              editorCanvasOrigin={editorCanvasOrigin}
                              href={'/pages/' + page.id}
                            >
                              Open page
                            </Link>
                          </li>
                        ))}
                      {reviews.length > 0 && (
                        <li>
                          <div className={recordTableStyles.rowCopy}>
                            <strong>
                              {reviews.length} {reviews.length === 1 ? 'page is' : 'pages are'} in review
                            </strong>
                          </div>
                          <Link className="btn secondary" href={`/sites/${siteId}/publishing`}>
                            Review submissions
                          </Link>
                        </li>
                      )}
                      {pages
                        .filter(page => page.live_samples)
                        .map(page => (
                          <li key={'sample' + page.id}>
                            <div className={recordTableStyles.rowCopy}>
                              <strong>{page.title}</strong>
                              <span className={recordTableStyles.meta}>Sample content is live</span>
                            </div>
                            <Link
                              className="btn secondary"
                              editorCanvasOrigin={editorCanvasOrigin}
                              href={'/pages/' + page.id}
                            >
                              Replace samples
                            </Link>
                          </li>
                        ))}
                    </ul>
                  </Card>
                  <Card title="Recent changes" density="compact">
                    <ul className={siteSummaryStyles.rowList}>
                      {[...pages]
                        .sort((a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at))
                        .slice(0, 4)
                        .map(page => (
                          <li key={page.id}>
                            <span className={siteSummaryStyles.taskIcon}>
                              <IconPage size={18} />
                            </span>
                            <div className={recordTableStyles.rowCopy}>
                              <Link
                                editorCanvasOrigin={editorCanvasOrigin}
                                href={'/pages/' + page.id}
                                aria-label={'Open recent change: ' + page.title}
                              >
                                {page.title}
                              </Link>
                              <span className={recordTableStyles.meta}>
                                {page.edited_by} ·{' '}
                                {new Date(page.edited_at).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            <StatusChip status={pageStatus(page)} />
                          </li>
                        ))}
                    </ul>
                  </Card>
                </div>
                {!scopedOnly && (
                  <Card title="Lists" density="compact">
                    <ul className={siteSummaryStyles.rowList}>
                      {lists?.collections.map(list => (
                        <li key={list.id}>
                          <div className={recordTableStyles.rowCopy}>
                            <Link
                              href={
                                list.readerKey === 'stories'
                                  ? `/sites/${siteId}/stories`
                                  : `/sites/${siteId}/content?collection=${list.id}`
                              }
                            >
                              <strong>{list.name}</strong>
                            </Link>
                            <span className={recordTableStyles.meta}>
                              {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'} · {list.changedEntries}{' '}
                              with changes not live
                            </span>
                          </div>
                        </li>
                      ))}
                      {!lists?.collections.length && (
                        <li>
                          <div className={recordTableStyles.rowCopy}>
                            No lists yet.<Link href={`/sites/${siteId}/content`}>Open Lists to get started</Link>
                          </div>
                        </li>
                      )}
                    </ul>
                  </Card>
                )}
              </div>
            </>
          )}
          {pageControlError && (
            <p role="alert">
              Menu and footer choices could not be loaded. Reload to try again, or open{' '}
              <Link href={'/sites/' + siteId + '/header'}>Header &amp; menu</Link>.
            </p>
          )}
          <section
            aria-labelledby={area === 'overview' ? 'site-pages-title' : undefined}
            aria-label={area === 'pages' ? 'Pages' : undefined}
          >
            {area === 'overview' && <h2 id="site-pages-title">Pages</h2>}
            {nativePages ? (
              <NativePagesTable
                siteId={siteId}
                pages={pages}
                canManage={canManagePages}
                canAdmin={canAdmin && Boolean(pageControls)}
                initial={pageControls}
                editorCanvasOrigin={editorCanvasOrigin}
                liveOrigin={liveOrigin}
              />
            ) : (
              <PagesTable
                editorCanvasOrigin={editorCanvasOrigin}
                pages={pages}
                canManage={canManagePages}
                liveOrigin={liveOrigin}
              />
            )}
          </section>
        </div>

        {canManagePages && archivedPages.length > 0 && (
          // Kept out of the way: archived pages are for putting back, not for work.
          <Disclosure className="archived-pages" title={<>Archived pages ({archivedPages.length})</>}>
            <p>These pages can be restored with their full history.</p>
            <ul className="archived-list">
              {archivedPages.map(page => (
                <li className="archived-row" key={page.id}>
                  <div>
                    <strong>{page.title}</strong>
                    <p>
                      <span className="mono">{page.slug ? `/${page.slug}` : '/'}</span> · Full history retained
                    </p>
                  </div>
                  <PageManagement
                    pageId={page.id}
                    title={page.title}
                    slug={page.slug}
                    revision={page.revision}
                    live={false}
                    archived
                  />
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </main>
    </AppShell>
  )
}
