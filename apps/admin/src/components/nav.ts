// Which destinations exist, as data.
//
// It is a plain module rather than part of the shell because the shell is a
// client component and this is called from server components: a function
// exported from a `'use client'` module cannot be invoked on the server, and a
// React component cannot be passed across that boundary at all. So the item
// names its icon with a string and the shell resolves it — which also means the
// navigation can be asserted in a test without rendering anything.
//
// It lists what V2 implements and nothing else. A destination joins this list
// only with a real route and command surface; the remaining V1 gaps stay in the
// interaction map rather than appearing here as dead links.
export type NavIconName =
  | 'sites'
  | 'home'
  | 'chapters'
  | 'pages'
  | 'collections'
  | 'design'
  | 'globalElements'
  | 'navigation'
  | 'sections'
  | 'media'
  | 'inbox'
  | 'publishing'
  | 'people'
  | 'settings'
  | 'activity'

export type NavItem = {
  href: string
  label: string
  icon: NavIconName
  /** `prefix` marks the item current for anything below it too. */
  match: 'exact' | 'prefix'
  /** Other screens that belong to this destination, matched by prefix. */
  also?: string[]
  alsoExact?: string[]
}

export type NavGroup = { label: string; items: NavItem[]; content?: boolean }

export type NavigationAccess = {
  isSuperAdmin: boolean
  memberships: ReadonlyMap<string, string>
  divisionScopes?: ReadonlyMap<string, { siteId: string; name: string }>
  pageScopes?: ReadonlyMap<string, { siteId: string; role: string }>
}
export function navigationFor(
  site?: {
    id: string
    name: string
    original_design?: boolean
    chapters_enabled?: boolean
    has_stories?: boolean
    national_template?: boolean
    has_content_lists?: boolean
  },
  access?: NavigationAccess,
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      label: 'CMS',
      items: [
        { href: '/', label: 'Home', icon: 'home', match: 'exact' },
        { href: '/sites', label: 'All sites', icon: 'sites', match: 'exact' },
        { href: '/inbox', label: 'Reviews', icon: 'inbox', match: 'prefix' },
        { href: '/people', label: 'People & access', icon: 'people', match: 'prefix' },
        { href: '/domains', label: 'Domains', icon: 'settings', match: 'prefix' },
        { href: '/activity', label: 'Activity', icon: 'activity', match: 'prefix' },
      ],
    },
  ]
  if (site) {
    // Destinations follow the order an editor reaches for them: what is on
    // the site, how it looks, then publishing and settings. Screens that are
    // part of one of these (documents beside images, page templates beside
    // sections, domains inside settings) are reached from that screen.
    const base = `/sites/${site.id}`
    const member = access?.memberships.get(site.id),
      content = Boolean(
        !site.original_design && access && !access.isSuperAdmin && member !== 'site_admin' && member !== 'reviewer',
      )
    groups.push({
      label: site.name,
      content,
      items: [
        content
          ? { href: '/?site=' + site.id, label: 'Home', icon: 'home', match: 'exact', alsoExact: ['/'] }
          : { href: base, label: 'Overview', icon: 'sites', match: 'exact' },
        { href: `${base}/pages`, label: 'Pages', icon: 'pages', match: 'prefix', also: ['/pages'] },
        ...(site.chapters_enabled &&
        (access?.isSuperAdmin ||
          access?.memberships.get(site.id) === 'site_admin' ||
          [...(access?.divisionScopes?.values() ?? [])].some(scope => scope.siteId === site.id) ||
          [...(access?.pageScopes?.values() ?? [])].some(scope => scope.siteId === site.id && scope.role === 'editor'))
          ? [{ href: `${base}/chapters`, label: 'Chapters', icon: 'chapters' as const, match: 'prefix' as const }]
          : []),
        ...(site.has_stories
          ? [{ href: `${base}/stories`, label: 'Stories', icon: 'collections' as const, match: 'prefix' as const }]
          : []),
        { href: `${base}/content`, label: 'Lists', icon: 'collections', match: 'prefix' },
        ...(!site.original_design && (access?.isSuperAdmin || member === 'site_admin')
          ? [{ href: `${base}/data`, label: 'Data values', icon: 'collections' as const, match: 'prefix' as const }]
          : []),
        { href: `${base}/media`, label: 'Media', icon: 'media', match: 'prefix', also: [`${base}/documents`] },
        ...(!site.original_design && (access?.isSuperAdmin || access?.memberships.get(site.id) === 'site_admin')
          ? [{ href: `${base}/header`, label: 'Header & menu', icon: 'navigation' as const, match: 'prefix' as const }]
          : []),
        ...(!site.original_design && (access?.isSuperAdmin || access?.memberships.get(site.id) === 'site_admin')
          ? [{ href: `${base}/footer`, label: 'Footer', icon: 'globalElements' as const, match: 'prefix' as const }]
          : []),
        {
          href: `${base}/design`,
          label: site.original_design ? 'Menu & footer' : 'Site look',
          icon: 'design',
          match: 'prefix',
          also: [`${base}/global-elements`, `${base}/navigation`],
        },
        { href: `${base}/publishing`, label: 'Publish', icon: 'publishing', match: 'prefix' },
        {
          href: `${base}/settings`,
          label: 'Settings',
          icon: 'settings',
          match: 'prefix',
          also: [`${base}/domains`, ...(!site.original_design ? [`${base}/redirects`] : [])],
        },
        { href: `${base}/sections`, label: 'Sections', icon: 'sections', match: 'prefix', also: [`${base}/recipes`] },
      ],
    })
  }
  if (site?.national_template && !site.original_design && access?.isSuperAdmin)
    groups.push({
      label: 'System',
      items: [{ href: `/sites/${site.id}/template`, label: 'Template', icon: 'sections', match: 'prefix' }],
    })
  const scopedOnly = Boolean(
    site &&
    access &&
    !access.isSuperAdmin &&
    !access.memberships.has(site.id) &&
    ([...(access.divisionScopes?.values() ?? [])].some(scope => scope.siteId === site.id) ||
      [...(access.pageScopes?.values() ?? [])].some(scope => scope.siteId === site.id)),
  )
  return groups.map(group => ({
    ...group,
    items: group.items.filter(item =>
      scopedOnly && group.label !== 'CMS' && !['Home', 'Overview', 'Pages', 'Chapters'].includes(item.label)
        ? false
        : item.icon === 'activity' &&
            access &&
            !access.isSuperAdmin &&
            !access.memberships.size &&
            Boolean(access.pageScopes?.size || access.divisionScopes?.size)
          ? false
          : site &&
              !site.original_design &&
              access &&
              !access.isSuperAdmin &&
              access.memberships.get(site.id) !== 'site_admin' &&
              ['design', 'settings'].includes(item.icon) &&
              item.href.startsWith('/sites/')
            ? false
            : site &&
                !site.original_design &&
                access &&
                !access.isSuperAdmin &&
                access.memberships.get(site.id) === 'contributor' &&
                item.label === 'Publish'
              ? false
              : site &&
                  !site.original_design &&
                  site.has_content_lists === false &&
                  access &&
                  !access.isSuperAdmin &&
                  access.memberships.get(site.id) !== 'site_admin' &&
                  item.label === 'Lists'
                ? false
                : item.href === '/domains'
                  ? access?.isSuperAdmin === true
                  : item.icon === 'people'
                    ? access?.isSuperAdmin === true
                    : item.icon === 'sections'
                      ? access?.isSuperAdmin === true ||
                        Boolean(site && access?.memberships.get(site.id) === 'site_admin')
                      : true,
    ),
  }))
}

export function navItemIsCurrent(item: NavItem, pathname: string) {
  const under = (href: string) => pathname === href || pathname.startsWith(href + '/')
  return (
    (item.match === 'prefix' ? under(item.href) : pathname === item.href) ||
    (item.also ?? []).some(under) ||
    (item.alsoExact ?? []).includes(pathname)
  )
}
