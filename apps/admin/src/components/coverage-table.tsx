'use client'
import { Fragment, useState } from 'react'
import { GuardedLink as Link } from './guarded-link.tsx'
import { Badge } from './ui/status-pill.tsx'
import recordTableStyles from './workspace-styles/record-table.module.css'
import selectionControlsStyles from './workspace-styles/selection-controls.module.css'
import styles from './coverage-table.module.css'
export type CoverageRow = {
  id: string
  label: string
  count: number
  live: number
  status?: { label: string; tone: 'neutral' | 'pending' | 'live' | 'error' }
  items: { id: string; label: string; href: string }[]
  uses: { id: string; label: string; href: string }[]
  emptyLabel: string
}
/** Compact coverage rows and linked details, shared by site content dashboards. */
export function CoverageTable({
  label,
  groupLabel,
  rows,
  initialOpen,
}: {
  label: string
  groupLabel: string
  rows: CoverageRow[]
  initialOpen?: string
}) {
  const [open, setOpen] = useState(initialOpen ?? ''),
    maximum = Math.max(1, ...rows.map(row => row.count))
  return (
    <div className={recordTableStyles.tableWrap}>
      <table className={recordTableStyles.table + ' ' + styles.table} aria-label={label}>
        <thead>
          <tr>
            <th>{groupLabel}</th>
            <th>Stories</th>
            <th>Live</th>
            <th>
              <span className={selectionControlsStyles.visuallyHidden}>Coverage</span>
            </th>
            <th>Shows on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={row.id}>
              <tr data-coverage-id={row.id} data-current-count={row.count} data-live-count={row.live}>
                <td>
                  <button
                    className={styles.title}
                    aria-label={'Stories tagged ' + row.label}
                    aria-expanded={open === row.id}
                    aria-controls={'coverage-details-' + index}
                    onClick={() => setOpen(open === row.id ? '' : row.id)}
                  >
                    {row.label}
                  </button>
                </td>
                <td>
                  <div className={styles.count}>
                    <div
                      className={styles.bar}
                      role="progressbar"
                      aria-label={row.label + ' current stories'}
                      aria-valuenow={row.count}
                      aria-valuemin={0}
                      aria-valuemax={maximum}
                    >
                      <span style={{ width: Math.max(0, Math.min(100, (row.count / maximum) * 100)) + '%' }} />
                    </div>
                    <span>{row.count}</span>
                  </div>
                </td>
                <td>{row.live}</td>
                <td>
                  <Badge tone={row.status?.tone ?? (row.count > 1 ? 'live' : row.count ? 'pending' : 'error')}>
                    {row.status?.label ?? (row.count > 1 ? 'Healthy' : row.count ? 'Only 1' : 'No stories')}
                  </Badge>
                </td>
                <td className={styles.uses}>
                  {row.uses.length ? (
                    <>
                      <Link href={row.uses[0]!.href}>{row.uses[0]!.label}</Link>
                      {row.uses.length > 1 && (
                        <details>
                          <summary aria-label={'Show ' + (row.uses.length - 1) + ' other pages'}>
                            +{row.uses.length - 1}
                          </summary>
                          {row.uses.slice(1).map(use => (
                            <Link key={use.id} href={use.href}>
                              {use.label}
                            </Link>
                          ))}
                        </details>
                      )}
                    </>
                  ) : (
                    <span>No pages yet</span>
                  )}
                </td>
              </tr>
              {open === row.id && (
                <tr id={'coverage-details-' + index}>
                  <td colSpan={5}>
                    <div className={styles.details}>
                      {row.items.length ? (
                        <ul>
                          {row.items.map(item => (
                            <li key={item.id}>
                              <Link href={item.href}>{item.label}</Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>{row.emptyLabel}</p>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
