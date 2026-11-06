'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { Button, ButtonLink, SearchField, Note, EmptyState, SegmentedControl } from '../../../components/ui/index.ts'
import { IconDrag, IconChevronRight } from '../../../components/icons.tsx'
import { StatusChip, pageStatus } from '../../../components/status.tsx'
import { pageInMenu, pageMenuLocations } from '../../../lib/page-details.ts'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import type { PageListControls } from '../../../lib/page-list-workspace.ts'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { changePageList } from './page-list-actions.ts'
import { PageManagement } from './page-management.tsx'
import styles from '../../../components/workspace.module.css'
export function NativePagesTable({
  siteId,
  pages,
  canManage,
  canAdmin,
  initial,
  liveOrigin,
}: {
  siteId: string
  pages: WorkspacePage[]
  canManage: boolean
  canAdmin: boolean
  initial: PageListControls | null
  liveOrigin: string | null
}) {
  const [search, setSearch] = useState(''),
    [tab, setTab] = useState('main'),
    [controls, setControls] = useState(initial),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    busy = useRef(false),
    drag = useRef<string | null>(null)
  useEffect(() => setControls(initial), [initial])
  useNavigationGuard(() => ({ dirty: false, pending: pending || busy.current }))
  const ordinary = useMemo(
      () =>
        pages
          .filter(
            page =>
              !page.slug.startsWith('stories/') &&
              !controls?.stories.some(story => story.path === (page.slug ? '/' + page.slug : '/')),
          )
          .sort((a, b) => (controls?.order.indexOf(a.id) ?? 0) - (controls?.order.indexOf(b.id) ?? 0)),
      [pages, controls],
    ),
    sectors = ordinary.filter(page => page.slug.startsWith('ways-we-help/')),
    main = ordinary.filter(page => !page.slug.startsWith('ways-we-help/')),
    drafts = ordinary.filter(page => !page.published_version_id),
    term = search.trim().toLowerCase(),
    rows = (term ? ordinary : tab === 'sectors' ? sectors : tab === 'drafts' ? drafts : main).filter(
      page => !term || (page.title + ' ' + page.slug).toLowerCase().includes(term),
    ),
    stories = term
      ? (controls?.stories.filter(story => (story.title + ' ' + story.path).toLowerCase().includes(term)) ?? [])
      : []
  async function save(
    pageId: string,
    kind: 'menu' | 'footer' | 'move',
    options: { on?: boolean; beforeId?: string } = {},
  ) {
    if (!controls || busy.current) return
    busy.current = true
    setPending(true)
    setNotice('')
    setError('')
    try {
      const result = await changePageList({ siteId, pageId, kind, ...options, controls })
      if (result.ok) {
        setControls(result.controls)
        setNotice(result.message)
      } else setError(result.message)
    } catch {
      setError('The save could not be confirmed. Reload to compare before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <div className={styles.denseStack}>
      <div className={styles.listToolbar}>
        <div className={styles.actions}>
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
            <Link className={styles.countLink} href={'/sites/' + siteId + '/stories'}>
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
        <div className={styles.tableWrap}>
          <table
            className={styles.table + ' ' + styles.compactTable + ' ' + styles.denseTable}
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
            <tbody>
              {rows.map((page, index) => {
                const locations = controls ? pageMenuLocations(controls.menu, page.id) : [],
                  under = locations[0]?.split(' › ').slice(0, -1).join(' › '),
                  reorder = canAdmin && !term && tab !== 'drafts'
                return (
                  <tr
                    key={page.id}
                    onDragOver={event => {
                      if (reorder && !pending && drag.current && drag.current !== page.id) event.preventDefault()
                    }}
                    onDrop={event => {
                      event.preventDefault()
                      const id = drag.current
                      drag.current = null
                      if (reorder && id && id !== page.id) void save(id, 'move', { beforeId: page.id })
                    }}
                  >
                    <td>
                      <div className={styles.title}>
                        {reorder && (
                          <span
                            draggable={!pending}
                            role="button"
                            tabIndex={pending ? -1 : 0}
                            aria-disabled={pending || undefined}
                            aria-label={'Move ' + page.title}
                            aria-description="Use the Up and Down arrow keys to move this page."
                            onDragStart={event => {
                              drag.current = page.id
                              event.dataTransfer.setData('application/x-cms-page', page.id)
                            }}
                            onDragEnd={() => {
                              drag.current = null
                            }}
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
                        <div className={styles.rowCopy}>
                          <Link href={'/pages/' + page.id}>{page.title}</Link>
                          <span className={styles.meta} title={'/' + page.slug}>
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
                          <div className={styles.toggleRow} data-layout="inline">
                            <input
                              type="checkbox"
                              role="switch"
                              aria-label={page.title + ' in the menu'}
                              disabled={pending}
                              checked={pageInMenu(controls.menu, page.id)}
                              onChange={event => void save(page.id, 'menu', { on: event.target.checked })}
                            />
                            {under && <small className={styles.meta}>Under {under}</small>}
                          </div>
                        </td>
                        <td>
                          <div className={styles.toggleRow} data-layout="inline">
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
                      <time className={styles.meta} dateTime={page.edited_at}>
                        {new Date(page.edited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </time>
                    </td>
                    <td>
                      <div className={styles.tableActions}>
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
                    <div className={styles.rowCopy}>
                      <Link href={'/sites/' + siteId + '/stories/' + story.id}>{story.title}</Link>
                      <span className={styles.meta}>Story · {story.path}</span>
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
