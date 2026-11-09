'use client'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { IconMenu } from './icons.tsx'
import type { NavGroup } from './nav.ts'
import { AppSidebar } from './app-sidebar.tsx'
import { BrandMark } from './brand-mark.tsx'
import { useSidebarLayout } from './use-sidebar-layout.ts'
import styles from './app-shell.module.css'

export function AppShell({
  email,
  role,
  groups,
  children,
}: {
  email: string
  /** What this person is, in the words the product uses. */
  role: string
  groups: NavGroup[]
  children: ReactNode
}) {
  const pathname = usePathname()
  const currentSite = groups.find(group => group.label !== 'CMS')

  const layout = useSidebarLayout(pathname)
  const { open, setOpen, rail, compact, opener, closeDrawer } = layout
  const globalItems = groups.find(group => group.label === 'CMS')?.items ?? []
  const siteItems = groups.filter(group => group.label !== 'CMS').flatMap(group => group.items)
  const nativeSite = Boolean(currentSite && !siteItems.some(item => item.label === 'Menu & footer'))

  return (
    <div
      className={`app ${styles.frame} ${rail ? styles.rail : ''}`}
      data-rail={rail ? 'on' : 'off'}
      data-site-shell={nativeSite ? 'native' : currentSite ? 'original' : 'global'}
      data-drawer={open ? 'open' : 'shut'}
    >
      {/* The scrim is a button so it is dismissible by pointer and announced as
          a control; the drawer is what has focus, so this stays out of the tab
          order. */}
      <button type="button" className="app-scrim" tabIndex={-1} aria-hidden="true" onClick={closeDrawer} />

      <AppSidebar
        email={email}
        role={role}
        pathname={pathname}
        currentSite={currentSite}
        nativeSite={nativeSite}
        globalItems={globalItems}
        siteItems={siteItems}
        layout={layout}
      />
      <div className="app-main" inert={compact && open ? true : undefined}>
        <div className="app-topbar">
          <button
            ref={opener}
            type="button"
            className="icon-btn"
            aria-label="Open navigation"
            aria-controls="cms-sidebar"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <IconMenu size={20} />
          </button>
          <span className="app-topbar-title">
            <BrandMark className={styles.wordmark} />
            NCRD CMS
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}
