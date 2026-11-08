'use client'
import { useMemo, useState } from 'react'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import type { CSSProperties } from 'react'
import { reviewDate } from '../../../lib/review-time.ts'
import type { WorkspacePage } from '../../../lib/workspace-queries.ts'
import { pageTree } from '../../../lib/workspace-model.ts'
import { editorialPosture } from '../../../lib/editorial-posture.ts'
import { StatusChip, pageStatus } from '../../../components/status.tsx'
import { Field, EmptyState, Menu, SegmentedControl } from '../../../components/ui/index.ts'
import { PageManagement } from './page-management.tsx'
import { IconMore } from '../../../components/icons.tsx'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import ownedStyles from './pages-table-styles.module.css'
export function PagesTable({
  pages,
  canManage,
  liveOrigin,
  editorCanvasOrigin,
  compactActions = false,
}: {
  pages: WorkspacePage[]
  canManage: boolean
  liveOrigin: string | null
  editorCanvasOrigin?: string | null
  compactActions?: boolean
}) {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all')
  const rows = useMemo(
    () =>
      pageTree(
        pages.filter(
          page =>
            (page.title + ' ' + page.slug).toLowerCase().includes(search.toLowerCase()) &&
            (filter === 'all' ||
              (filter === 'draft' && !page.published_version_id) ||
              (filter === 'live' &&
                Boolean(page.published_version_id) &&
                !editorialPosture(page).hasUnpublishedChanges) ||
              (filter === 'changed' &&
                Boolean(page.published_version_id) &&
                editorialPosture(page).hasUnpublishedChanges)),
        ),
      ),
    [pages, search, filter],
  )
  return (
    <>
      <div className={workspaceFormsStyles.filters + ' ' + ownedStyles.compactFilters}>
        <Field id="pages-search" label="Search pages">
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Page name or address"
          />
        </Field>
        <SegmentedControl
          label="Status"
          appearance="pills"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All pages' },
            { value: 'live', label: 'Live' },
            { value: 'changed', label: 'Changes not live' },
            { value: 'draft', label: 'Draft' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={pages.length ? 'No matching pages' : 'No pages yet'}
          children={
            pages.length
              ? 'Try another page name or choose All pages.'
              : canManage
                ? 'Add a page above. It begins as a private draft.'
                : 'An editor can add the first page.'
          }
        />
      ) : (
        <div className={recordTableStyles.tableWrap}>
          <table
            className={
              recordTableStyles.table + ' ' + recordTableStyles.compactTable + ' ' + recordTableStyles.denseTable
            }
            aria-label="Pages"
            data-density={compactActions ? 'summary' : undefined}
          >
            <thead>
              <tr>
                <th scope="col">Page</th>
                <th scope="col">Address</th>
                <th scope="col">Status</th>
                <th scope="col">In menu</th>
                <th scope="col">Last edited</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ page, depth }) => (
                <tr key={page.id}>
                  <td>
                    <div
                      className={recordTableStyles.title}
                      style={{ paddingInlineStart: `calc(var(--space-5) * ${depth})` } as CSSProperties}
                    >
                      {depth > 0 && <span aria-hidden="true">↳</span>}
                      <Link editorCanvasOrigin={editorCanvasOrigin} href={'/pages/' + page.id} title={page.title}>
                        {page.title}
                      </Link>
                    </div>
                  </td>
                  <td>
                    <code title={'/' + page.slug}>/{page.slug}</code>
                  </td>
                  <td>
                    <StatusChip status={pageStatus(page)} compact={compactActions} />
                  </td>
                  <td>{page.in_menu ? 'Yes' : 'No'}</td>
                  <td>
                    <span className={recordTableStyles.meta} title={page.edited_by}>
                      {page.edited_by}
                      <br />
                      <time dateTime={page.edited_at}>{reviewDate(page.edited_at)}</time>
                    </span>
                  </td>
                  <td>
                    <div className={recordTableStyles.tableActions}>
                      {compactActions ? (
                        canManage ? (
                          <PageManagement
                            pageId={page.id}
                            title={page.title}
                            slug={page.slug}
                            revision={page.revision}
                            live={Boolean(page.published_version_id)}
                            navigation={{
                              liveHref: liveOrigin && page.live_path ? liveOrigin + page.live_path : undefined,
                            }}
                          />
                        ) : (
                          <Menu accessibleLabel={'More actions for ' + page.title} label={<IconMore size={16} />}>
                            <Link
                              editorCanvasOrigin={editorCanvasOrigin}
                              href={'/pages/' + page.id}
                              aria-label={'Edit ' + page.title}
                            >
                              Edit
                            </Link>
                            {liveOrigin && page.live_path && (
                              <a
                                href={liveOrigin + page.live_path}
                                target="_blank"
                                rel="noopener"
                                aria-label={'View ' + page.title + ' on the live site'}
                              >
                                View live
                              </a>
                            )}
                          </Menu>
                        )
                      ) : (
                        <>
                          <Link
                            className={`btn secondary small ${recordTableStyles.edit}`}
                            editorCanvasOrigin={editorCanvasOrigin}
                            href={'/pages/' + page.id}
                            aria-label={'Edit ' + page.title}
                          >
                            Edit
                          </Link>
                          {liveOrigin && page.live_path && (
                            <a
                              className="btn ghost small"
                              href={liveOrigin + page.live_path}
                              target="_blank"
                              rel="noopener"
                              aria-label={'View ' + page.title + ' on the live site'}
                            >
                              View live
                            </a>
                          )}
                          {canManage && (
                            <PageManagement
                              pageId={page.id}
                              title={page.title}
                              slug={page.slug}
                              revision={page.revision}
                              live={Boolean(page.published_version_id)}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
