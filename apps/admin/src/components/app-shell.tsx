'use client'
// The sidebar keeps the current site and the available destinations visible.
// On narrow screens the drawer closes by button, Escape or scrim. Folding
// the desktop rail hides labels visually without changing the tab order.
import { GuardedLink as Link } from './guarded-link.tsx'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { signOut } from '../app/actions/auth.ts'
import {
  IconHome,
  IconLocation,
  IconBrush,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconClose,
  IconCollection,
  IconFrame,
  IconImage,
  IconMail,
  IconMenu,
  IconPage,
  IconSearch,
  IconSections,
  IconSignOut,
  IconSite,
  IconPeople,
  IconSettings,
} from './icons.tsx'
import { COMMAND_SEARCH_EVENT } from '../lib/command-search-model.ts'
import { Button, IconButton } from './ui/button.tsx'
import { Menu } from './ui/menu.tsx'
import styles from './app-shell.module.css'
import { navItemIsCurrent, type NavGroup, type NavIconName } from './nav.ts'
import { useSidebarData } from './sidebar-data.tsx'

const NAV_ICON = {
  home: IconHome,
  chapters: IconLocation,
  sites: IconSite,
  pages: IconPage,
  collections: IconCollection,
  design: IconBrush,
  globalElements: IconFrame,
  navigation: IconMenu,
  sections: IconSections,
  media: IconImage,
  inbox: IconMail,
  publishing: IconClock,
  people: IconPeople,
  settings: IconSettings,
  activity: IconClock,
} as const
function NavIcon({ name }: { name: NavIconName }) {
  const Glyph = NAV_ICON[name]
  return <Glyph size={16} />
}

const RAIL_KEY = 'cms.sidebar.rail'

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
  const { sites, sitesError, inboxCount } = useSidebarData()
  const [open, setOpen] = useState(false)
  const [rail, setRail] = useState(false)
  const [compact, setCompact] = useState(false)
  const sidebar = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement>(null)

  // Read once on mount rather than during render: the server has no
  // localStorage, and a value read during render is a hydration mismatch.
  useEffect(() => {
    try {
      setRail(window.localStorage.getItem(RAIL_KEY) === '1')
    } catch {
      /* private mode */
    }
  }, [])

  // `inert` is an HTML behaviour, not a CSS behaviour. Applying it whenever
  // the mobile drawer is shut also disables the *visible desktop sidebar*.
  // Follow the same breakpoint as the stylesheet and only inert the rail when
  // it is actually off-canvas. Starting at false keeps the server and first
  // client render identical; matchMedia updates it immediately after mount.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 60rem)')
    const update = () => {
      const nextCompact = query.matches
      setCompact(nextCompact)
      // A mobile drawer is modal state. Once the layout becomes desktop it is
      // an ordinary sidebar again, so retain neither the open flag nor its
      // focus trap for a future resize back to mobile.
      if (!nextCompact) setOpen(false)
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // A route change closes the drawer. Without this, tapping a link on a phone
  // navigates behind a sheet that is still covering the screen.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open || !compact) return
    closeButton.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer()
      if (event.key !== 'Tab') return
      const controls = [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter(control => control.getClientRects().length > 0)
      if (controls.length === 0) return
      const first = controls[0]!
      const last = controls.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, compact])

  function closeDrawer() {
    setOpen(false)
    // While open, `.app-main` is inert and the opener inside it cannot accept
    // focus. Restore it after React has removed inert, not in the same event
    // that merely requested the state change.
    window.requestAnimationFrame(() => opener.current?.focus())
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault()
        toggleRail()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function toggleRail() {
    setRail(current => {
      const next = !current
      try {
        window.localStorage.setItem(RAIL_KEY, next ? '1' : '0')
      } catch {
        /* private mode */
      }
      return next
    })
  }

  const globalItems = groups.find(group => group.label === 'CMS')?.items ?? []
  const siteItems = groups.filter(group => group.label !== 'CMS').flatMap(group => group.items)
  const contentSite = Boolean(currentSite?.content)
  const nativeSite = Boolean(currentSite && !siteItems.some(item => item.label === 'Menu & footer'))
  const siteWide = new Set(['Header & menu', 'Footer', 'Site look']),
    publishing = new Set(['Publish', 'Settings']),
    advanced = siteItems.filter(item => item.label === 'Sections' || item.label === 'Template')
  const siteBadge =
    currentSite?.label
      .trim()
      .split(/\s+/)
      .map(word => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? ''
  function siteSwitcher() {
    return (
      currentSite && (
        <div className={styles.switcher}>
          <Menu
            accessibleLabel={`Switch site · ${currentSite.label}`}
            label={
              <>
                <span className={styles.siteBadge} aria-hidden="true">
                  {siteBadge.length === 1 ? currentSite.label.slice(0, 2).toUpperCase() : siteBadge}
                </span>
                <span className={styles.siteName}>{currentSite.label}</span>
                <IconChevronDown size={14} />
              </>
            }
          >
            <Link href="/sites">All sites</Link>
            {sites?.map(site => (
              <Link key={site.id} href={`/sites/${site.id}`}>
                {site.name}
              </Link>
            ))}
            {!sites && (
              <p role="status">{sitesError ? 'Couldn’t load sites. Open All sites to try again.' : 'Loading sites…'}</p>
            )}
          </Menu>
        </div>
      )
    )
  }
  function navGroup(label: string, items: NavGroup['items']) {
    return (
      items.length > 0 && (
        <div className={styles.navGroup}>
          {label && <h2 className={styles.groupLabel}>{label}</h2>}
          {navItems(items)}
        </div>
      )
    )
  }
  function navItems(items: NavGroup['items']) {
    return items.map(item => {
      const current = navItemIsCurrent(item, pathname)
      return (
        <Link
          key={item.href}
          href={item.href}
          className="navlink"
          aria-label={item.label}
          aria-describedby={item.icon === 'inbox' && inboxCount !== null ? 'inbox-count-description' : undefined}
          aria-current={current ? 'page' : undefined}
          title={rail ? item.label : undefined}
        >
          <span className="navlink-icon">
            <NavIcon name={item.icon} />
          </span>
          <span className="navlink-label">{item.label}</span>
          {item.icon === 'inbox' && inboxCount !== null && (
            <>
              {inboxCount > 0 && (
                <span className="nav-count" aria-hidden="true">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              )}
              <span className="sr-only" id="inbox-count-description">
                {inboxCount} open requests, reviews and recorded failures
              </span>
            </>
          )}
        </Link>
      )
    })
  }

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

      <aside
        ref={sidebar}
        id="cms-sidebar"
        className="sidebar"
        aria-label="CMS navigation"
        aria-hidden={compact && !open ? true : undefined}
        inert={compact && !open ? true : undefined}
      >
        <div className={`sidebar-brand ${styles.brand}`}>
          <span className={styles.wordmark} aria-hidden="true">
            C
          </span>
          <span className="sidebar-brandtext">
            <strong>NCRD CMS</strong>
            <span>Content manager</span>
          </span>
          <IconButton
            className={styles.fold}
            variant="tertiary"
            tooltip={rail ? 'Expand sidebar · ⌘\\' : 'Collapse sidebar · ⌘\\'}
            onClick={toggleRail}
            aria-expanded={!rail}
            aria-controls="cms-sidebar"
          >
            <IconChevronLeft size={16} />
          </IconButton>
          <button
            ref={closeButton}
            type="button"
            className="sidebar-close"
            aria-label="Close navigation"
            onClick={closeDrawer}
          >
            <IconClose size={18} />
          </button>
        </div>

        {siteSwitcher()}
        <div className={styles.searchArea}>
          {rail ? (
            <IconButton
              variant="tertiary"
              tooltip="Search or jump to · ⌘K"
              onClick={() => window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))}
            >
              <IconSearch size={18} />
            </IconButton>
          ) : (
            <Button
              variant="tertiary"
              className={styles.searchButton}
              onClick={() => window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))}
            >
              <IconSearch size={18} />
              <span>Search or jump to…</span>
              <kbd>⌘K</kbd>
            </Button>
          )}
        </div>
        <nav className={`sidebar-nav ${styles.navigation}`} aria-label="Sections of the CMS">
          {!currentSite && (
            <>
              {navGroup('', globalItems)}
              {sites &&
                navGroup(
                  'Your sites',
                  sites.map(site => ({ href: '/sites/' + site.id, label: site.name, icon: 'sites', match: 'exact' })),
                )}
            </>
          )}
          {currentSite && (
            <>
              {navGroup(
                '',
                siteItems.filter(
                  item => !siteWide.has(item.label) && !publishing.has(item.label) && !advanced.includes(item),
                ),
              )}
              {nativeSite && !contentSite ? (
                <>
                  {navGroup(
                    'Site-wide',
                    siteItems.filter(item => siteWide.has(item.label)),
                  )}
                  {navGroup(
                    'Publishing',
                    siteItems.filter(item => publishing.has(item.label)),
                  )}
                </>
              ) : (
                navGroup(
                  '',
                  siteItems.filter(item => siteWide.has(item.label) || publishing.has(item.label)),
                )
              )}
              {advanced.length > 0 && (
                <details
                  className={styles.advanced}
                  open={advanced.some(item =>
                    [item.href, ...(item.also ?? [])].some(
                      href => pathname === href || pathname.startsWith(href + '/'),
                    ),
                  )}
                >
                  <summary aria-label="Advanced site tools" title={rail ? 'Advanced site tools' : undefined}>
                    <span className="navlink-icon">
                      <IconSections size={16} />
                    </span>
                    <span className="navlink-label">Advanced</span>
                    <span className={styles.advancedChevron}>
                      <IconChevronDown size={14} />
                    </span>
                  </summary>
                  {navItems(advanced)}
                </details>
              )}
              {contentSite
                ? navGroup(
                    '',
                    globalItems.filter(
                      item => item.icon === 'inbox' && (Boolean(inboxCount) || pathname.startsWith('/inbox')),
                    ),
                  )
                : navGroup('Workspace', globalItems)}
            </>
          )}
        </nav>

        <div className="sidebar-foot">
          <div className="whoami" title={rail ? `${email} — ${role}` : undefined}>
            <span className="whoami-initial" aria-hidden="true">
              {email.slice(0, 1).toUpperCase()}
            </span>
            <span className="navlink-label whoami-text">
              <span className="whoami-email" title={email}>
                {email}
              </span>
              <span className="whoami-role" title={role}>
                {role}
              </span>
            </span>
            <span className="sr-only">
              Signed in as {email}, {role}
            </span>
          </div>
          <form action={signOut}>
            <button type="submit" className="navlink navlink-button" title={rail ? 'Sign out' : undefined}>
              <span className="navlink-icon">
                <IconSignOut size={18} />
              </span>
              <span className="navlink-label">Sign out</span>
            </button>
          </form>
        </div>
      </aside>

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
            <span className={styles.wordmark} aria-hidden="true">
              C
            </span>
            NCRD CMS
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}
