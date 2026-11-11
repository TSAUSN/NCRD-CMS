import { GuardedLink as Link } from './guarded-link.tsx'
import { signOut } from '../app/actions/auth.ts'
import {
  IconHome,
  IconInfo,
  IconLocation,
  IconBrush,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconClose,
  IconCollection,
  IconFrame,
  IconImage,
  IconLock,
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
import { siteInitials } from '../lib/site-initials.ts'
import { Button, IconButton } from './ui/button.tsx'
import { Menu } from './ui/menu.tsx'
import { BrandMark } from './brand-mark.tsx'
import { navItemIsCurrent, type NavGroup, type NavIconName } from './nav.ts'
import { useSidebarData } from './sidebar-data.tsx'
import { usePasswordSignIn } from './account-options.tsx'
import type { SidebarLayout } from './use-sidebar-layout.ts'
import styles from './app-shell.module.css'

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

type SidebarProps = {
  email: string
  role: string
  pathname: string
  currentSite: NavGroup | undefined
  nativeSite: boolean
  globalItems: NavGroup['items']
  siteItems: NavGroup['items']
  layout: SidebarLayout
}

export function AppSidebar({
  email,
  role,
  pathname,
  currentSite,
  nativeSite,
  globalItems,
  siteItems,
  layout,
}: SidebarProps) {
  const { sites, sitesError, inboxCount } = useSidebarData()
  const passwordSignIn = usePasswordSignIn()
  const { open, rail, compact, sidebar, closeButton, closeDrawer, toggleRail } = layout
  const openSearch = () => window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))
  const contentSite = Boolean(currentSite?.content)
  const siteWide = new Set(['Header & menu', 'Footer', 'Site look'])
  const publishing = new Set(['Publish', 'Settings'])
  const advanced = siteItems.filter(item => item.label === 'Sections' || item.label === 'Template')

  const siteBadge = siteInitials(currentSite?.label ?? '')
  function siteSwitcher() {
    return (
      currentSite && (
        <div className={styles.switcher}>
          <Menu
            accessibleLabel={`Switch site · ${currentSite.label}`}
            label={
              <>
                <span className={styles.siteBadge} aria-hidden="true">
                  {siteBadge}
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
    <aside
      ref={sidebar}
      id="cms-sidebar"
      className="sidebar"
      aria-label="CMS navigation"
      aria-hidden={compact && !open ? true : undefined}
      inert={compact && !open ? true : undefined}
    >
      <div className={`sidebar-brand ${styles.brand}`}>
        <BrandMark className={styles.wordmark} />
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
          <IconButton variant="tertiary" tooltip="Search or jump to · ⌘K" onClick={openSearch}>
            <IconSearch size={18} />
          </IconButton>
        ) : (
          <Button variant="tertiary" className={styles.searchButton} onClick={openSearch}>
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
                  [item.href, ...(item.also ?? [])].some(href => pathname === href || pathname.startsWith(href + '/')),
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
        <Link
          href="/help"
          className="navlink"
          aria-label="Help"
          aria-current={pathname === '/help' ? 'page' : undefined}
          title={rail ? 'Help' : undefined}
        >
          <span className="navlink-icon">
            <IconInfo size={18} />
          </span>
          <span className="navlink-label">Help</span>
        </Link>
        {passwordSignIn && (
          <Link
            href="/account/password"
            className="navlink"
            aria-label="Password"
            aria-current={pathname === '/account/password' ? 'page' : undefined}
            title={rail ? 'Password' : undefined}
          >
            <span className="navlink-icon">
              <IconLock size={18} />
            </span>
            <span className="navlink-label">Password</span>
          </Link>
        )}
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
  )
}
