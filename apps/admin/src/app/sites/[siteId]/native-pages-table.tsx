'use client'
import { DropIndicator, ReorderAnnouncement } from '../../../components/ui/drop-indicator.tsx'
import { flatReorderIntent } from '../../../components/ui/flat-reorder.ts'
import reorderStyles from '../../../components/ui/reorderable-list.module.css'
import { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import { useMemo, useState } from 'react'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { Button, ButtonLink, SearchField, Note, EmptyState, SegmentedControl } from '../../../components/ui/index.ts'
import { IconDrag, IconChevronRight } from '../../../components/icons.tsx'
import { StatusChip, pageStatus } from '../../../components/status.tsx'
import { pageInMenu, pageMenuLocations } from '../../../lib/page-details.ts'
import { reviewDate } from '../../../lib/review-time.ts'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import type { PageListControls } from '../../../lib/page-list-workspace.ts'
import { usePageListCommands } from './use-page-list-commands.ts'
import { isOrdinaryPage } from '../../../lib/ordinary-page.ts'
import { PageManagement } from './page-management.tsx'
import styles from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import ownedStyles from './native-pages-table-styles.module.css'
export function NativePagesTable({
  siteId,
  pages,
  canManage,
  canAdmin,
  initial,
  liveOrigin,
  editorCanvasOrigin,
}: {
  siteId: string
  pages: WorkspacePage[]
  canManage: boolean
  canAdmin: boolean
  initial: PageListControls | null
  liveOrigin: string | null
  editorCanvasOrigin?: string | null
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('main')
  const { controls, pending, notice, error, save } = usePageListCommands(siteId, initial)
  const ordinary = useMemo(() => {
    const storyPaths = new Set(controls?.stories.map(story => story.path))
    const order = controls ? new Map(controls.order.map((id, index) => [id, index])) : null
    const position = (id: string) => (order ? (order.get(id) ?? -1) : 0)
    return pages.filter(page => isOrdinaryPage(page.slug, storyPaths)).sort((a, b) => position(a.id) - position(b.id))
  }, [pages, controls])
  const sectors = ordinary.filter(page => page.slug.startsWith('ways-we-help/'))
  const main = ordinary.filter(page => !page.slug.startsWith('ways-we-help/'))
  const drafts = ordinary.filter(page => !page.published_version_id)
  const term = search.trim().toLowerCase()
  const rows = (term ? ordinary : tab === 'sectors' ? sectors : tab === 'drafts' ? drafts : main).filter(
    page => !term || (page.title + ' ' + page.slug).toLowerCase().includes(term),
  )
  const stories = term
    ? (controls?.stories.filter(story => (story.title + ' ' + story.path).toLowerCase().includes(term)) ?? [])
    : []
  const rowIds = rows.map(row => row.id)
  const canReorder = canAdmin && !term && tab !== 'drafts'
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-page',
    decide: point => {
      const intent = flatReorderIntent(rowIds, point)
      if (intent.status !== 'move') return intent
      return { ...intent, move: { id: point.from, over: point.over, edge: point.edge } }
    },
    apply: ({ id, over, edge }) => {
      void save(id, 'move', edge === 'before' ? { beforeId: over } : { afterId: over })
      return 'Saving page order.'
    },
  })
  return (
    <div className={styles.denseStack}>
      <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
      <div className={workspaceFormsStyles.listToolbar}>
        <div className={workspaceFormsStyles.actions}>
          <SegmentedControl
            label="Page groups"
            appearance="pills"
            size="s"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'main', label: 'Main pages ' + main.length },
              ...(sectors.length ? [{ value: 'sectors', label: 'Ways We Help ' + sectors.length }] : []),
              { value: 'drafts', label: 'Drafts ' + drafts.length },
            ]}
          />
          {controls?.stories.length ? (
            <Link className={ownedStyles.countLink} href={'/sites/' + siteId + '/stories'}>
              Stories {controls.stories.length}
              <IconChevronRight size={12} />
            </Link>
          ) : null}
        </div>
        <SearchField
          id="pages-search"
          label="Search pages and stories"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      {pending && <p role="status">Saving the menu and footer draft…</p>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload to compare
          </Button>
        </div>
      )}
      {!rows.length && !stories.length ? (
        <EmptyState title={ordinary.length ? 'No matching pages' : 'No pages yet'}>
          {ordinary.length
            ? 'Try another page or story name.'
            : canManage
              ? 'Create a page above. It begins as a private draft.'
              : 'An editor can add the first page.'}
        </EmptyState>
      ) : (
        <div className={recordTableStyles.tableWrap}>
          <table
            className={
              recordTableStyles.table + ' ' + recordTableStyles.compactTable + ' ' + recordTableStyles.denseTable
            }
            aria-label="Pages"
            data-density="content"
          >
            <thead>
              <tr>
                <th>Page</th>
                <th>Status</th>
                {canAdmin && (
                  <>
                    <th>In the menu</th>
                    <th>In the footer</th>
                  </>
                )}
                <th>Last edited</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody data-reorder-list className={reorderStyles.list}>
              {rows.map((page, index) => {
                const locations = controls ? pageMenuLocations(controls.menu, page.id) : [],
                  under = locations[0]?.split(' › ').slice(0, -1).join(' › ')
                return (
                  <tr key={page.id} {...reorder.row(page.id, !canReorder || pending, false)}>
                    <td>
                      <DropIndicator marker={reorder.marker} row={page.id} />
                      <div className={recordTableStyles.title}>
                        {canReorder && (
                          <span
                            {...reorder.grip(page.id, pending)}
                            role="button"
                            tabIndex={pending ? -1 : 0}
                            aria-disabled={pending || undefined}
                            aria-label={'Move ' + page.title}
                            aria-description="Use the Up and Down arrow keys to move this page."
                            onKeyDown={event => {
                              if (event.key === 'ArrowUp' && index > 0) {
                                event.preventDefault()
                                void save(page.id, 'move', { beforeId: rows[index - 1]!.id })
                              }
                              if (event.key === 'ArrowDown' && index < rows.length - 1) {
                                event.preventDefault()
                                void save(rows[index + 1]!.id, 'move', { beforeId: page.id })
                              }
                            }}
                          >
                            <IconDrag size={14} />
                          </span>
                        )}
                        <div className={recordTableStyles.rowCopy}>
                          <Link editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + page.id}>
                            {page.title}
                          </Link>
                          <span className={recordTableStyles.meta} title={'/' + page.slug}>
                            /{page.slug}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={pageStatus(page)} />
                    </td>
                    {canAdmin && controls && (
                      <>
                        <td>
                          <div className={selectionControlsStyles.toggleRow} data-layout="inline">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={page.title + ' in the menu'}
                              disabled={pending}
                              checked={pageInMenu(controls.menu, page.id)}
                              onChange={event => void save(page.id, 'menu', { on: event.target.checked })}
                            />
                            {under && <small className={recordTableStyles.meta}>Under {under}</small>}
                          </div>
                        </td>
                        <td>
                          <div className={selectionControlsStyles.toggleRow} data-layout="inline">
                            {controls.inFooter[page.id] === null ? (
                              <Link href={'/sites/' + siteId + '/footer'}>Open Footer</Link>
                            ) : (
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={page.title + ' in the footer'}
                                disabled={pending}
                                checked={Boolean(controls.inFooter[page.id])}
                                onChange={event => void save(page.id, 'footer', { on: event.target.checked })}
                              />
                            )}
                          </div>
                        </td>
                      </>
                    )}
                    <td>
                      <time className={recordTableStyles.meta} dateTime={page.edited_at}>
                        {reviewDate(page.edited_at)}
                      </time>
                    </td>
                    <td>
                      <div className={recordTableStyles.tableActions}>
                        {canManage ? (
                          <PageManagement
                            pageId={page.id}
                            title={page.title}
                            slug={page.slug}
                            revision={page.revision}
                            live={Boolean(page.published_version_id)}
                            navigation={liveOrigin && page.live_path ? { liveHref: liveOrigin + page.live_path } : {}}
                          />
                        ) : (
                          liveOrigin &&
                          page.live_path && (
                            <ButtonLink
                              variant="tertiary"
                              size="s"
                              href={liveOrigin + page.live_path}
                              target="_blank"
                              rel="noopener"
                              aria-label={'View ' + page.title + ' on the live site'}
                            >
                              View live
                            </ButtonLink>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {stories.map(story => (
                <tr key={'story-' + story.id}>
                  <td>
                    <div className={recordTableStyles.rowCopy}>
                      <Link href={'/sites/' + siteId + '/stories/' + story.id}>{story.title}</Link>
                      <span className={recordTableStyles.meta}>Story · {story.path}</span>
                    </div>
                  </td>
                  <td colSpan={canAdmin ? 5 : 3}>
                    <Link className="btn secondary small" href={'/sites/' + siteId + '/stories/' + story.id}>
                      Edit story
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canAdmin && (
        <Note>
          The switches change the site menu and footer, the same as Edit menu. They save as a draft and go live with
          Publish. Drag the handle to change the order in this list and in the menu.{' '}
        </Note>
      )}
    </div>
  )
}
