import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { Card } from '../../../components/ui/index.ts'
import { pageStatus, StatusChip } from '../../../components/status.tsx'
import { IconCheck, IconPage, IconCollection, IconSettings } from '../../../components/icons.tsx'
import type { getCollectionWorkspace } from '../../../lib/collection-queries.ts'
import type { listWorkspacePages } from '../../../lib/workspace-queries.ts'
import type { listReviewSubmissions } from '../../../lib/review-queries.ts'
import styles from '../../../components/workspace.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'

type Pages = Awaited<ReturnType<typeof listWorkspacePages>>

export function OriginalSiteOverviewSections({
  siteId,
  editorCanvasOrigin,
  scopedOnly,
  canManagePages,
  pages,
  unpublishedPages,
  reviews,
  lists,
}: {
  siteId: string
  editorCanvasOrigin: string | null
  scopedOnly: boolean
  canManagePages: boolean
  pages: Pages
  unpublishedPages: Pages
  reviews: Awaited<ReturnType<typeof listReviewSubmissions>>
  lists: Awaited<ReturnType<typeof getCollectionWorkspace>> | null
}) {
  const home = pages.find(page => page.slug === '')
  const samplePages = pages.filter(page => page.live_samples)
  return (
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
          {home && (
            <Link className={siteSummaryStyles.task} editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + home.id}>
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
              <strong>Edit menu &amp; footer</strong>
            </Link>
          )}
        </div>
      </section>
      <div className={styles.twoColumns}>
        <div className={styles.stack}>
          <Card title="Needs attention" density="compact">
            <ul className={siteSummaryStyles.rowList}>
              {unpublishedPages.length === 0 && reviews.length === 0 && !samplePages.length && (
                <li>
                  <span className={siteSummaryStyles.taskIcon}>
                    <IconCheck size={18} />
                  </span>
                  <div className={recordTableStyles.rowCopy}>
                    Everything saved is live. There is nothing waiting for attention.
                  </div>
                </li>
              )}
              {unpublishedPages.map(page => (
                <li key={page.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <strong>{page.title}</strong>
                    <span className={recordTableStyles.meta}>
                      {page.published_version_id ? 'Changes not live' : 'Draft'}
                    </span>
                  </div>
                  <Link className="btn secondary" editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + page.id}>
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
              {samplePages.map(page => (
                <li key={'sample' + page.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <strong>{page.title}</strong>
                    <span className={recordTableStyles.meta}>Sample content is live</span>
                  </div>
                  <Link className="btn secondary" editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + page.id}>
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
                      {list.totalEntries} {list.totalEntries === 1 ? 'item' : 'items'} · {list.changedEntries} with
                      changes not live
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
  )
}
