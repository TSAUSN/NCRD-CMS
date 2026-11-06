import type { ReactNode } from 'react'
import { Crumbs, type Crumb, type HeaderTab } from '../shell.tsx'
import { GuardedLink as Link } from '../guarded-link.tsx'
import { BackLink } from './back-link.tsx'
import styles from './ui.module.css'
export function PageHeader({
  title,
  lede,
  chip,
  sub,
  actions,
  crumbs,
  tabs,
  tabsLabel,
  showWayfinding = true,
  stacked,
  density,
}: {
  title: ReactNode
  lede?: ReactNode
  chip?: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  density?: 'compact'
  stacked?: boolean
  showWayfinding?: boolean
  crumbs?: readonly Crumb[]
  tabs?: readonly HeaderTab[]
  tabsLabel?: string
}) {
  const supplied =
    crumbs ??
    (typeof title === 'string' && title !== 'All sites'
      ? [{ label: 'All sites', href: '/sites' }, { label: title }]
      : [{ label: 'All sites' }])
  const trail = supplied.map(crumb => ({
    ...crumb,
    label: crumb.label === 'Sites' ? 'All sites' : crumb.label,
    href: ['Sites', 'All sites'].includes(crumb.label) && crumb.href === '/' ? '/sites' : crumb.href,
  }))
  const parent =
    trail
      ?.slice(0, -1)
      .reverse()
      .find(crumb => crumb.href)?.href ?? '/'
  return (
    <header className={styles.header} data-density={density} data-stacked={stacked || undefined}>
      {showWayfinding && (
        <div className={styles.wayfinding}>
          <BackLink fallback={parent} />
          {trail && <Crumbs trail={trail} />}
        </div>
      )}
      <div className={styles.headingBlock}>
        <div className={styles.headingRow}>
          <div className={styles.headingMain}>
            <h1 className={styles.title}>
              {title}
              {chip}
            </h1>
            {!stacked && sub && <div className={styles.subtitle}>{sub}</div>}
            {lede && <p className={styles.lede}>{lede}</p>}
          </div>
          {actions && <div className={styles.headerActions}>{actions}</div>}
        </div>
        {stacked && sub && <div className={styles.subtitle}>{sub}</div>}
      </div>
      {tabs && (
        <nav className="page-tabs" aria-label={tabsLabel ?? 'In this area'}>
          {tabs.map(tab => (
            <Link key={tab.href} href={tab.href} aria-current={tab.current ? 'page' : undefined}>
              {tab.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
