import { describe, expect, it } from 'vitest'
import { navigationFor, navItemIsCurrent } from './nav.ts'

// The sidebar's contents are the product's claim about what it can do, so they
// are asserted rather than eyeballed. Two properties matter and neither is
// visual: that a site-local destination never appears outside a site, and that
// nothing is listed which does not exist.
const superAccess = { isSuperAdmin: true, memberships: new Map<string, string>() }
describe('the sidebar’s destinations', () => {
  it('offers only the global group when no site is open', () => {
    const groups = navigationFor(undefined, superAccess)
    expect(groups.map(group => group.label)).toEqual(['CMS'])
    expect(groups[0]!.items.map(item => item.href)).toEqual([
      '/',
      '/sites',
      '/inbox',
      '/people',
      '/domains',
      '/activity',
    ])
  })

  it('adds a group named after the site, and only then', () => {
    const groups = navigationFor({ id: 'abc', name: 'Human Needs Index' }, superAccess)
    expect(groups.map(group => group.label)).toEqual(['CMS', 'Human Needs Index'])
    expect(groups[1]!.items.map(item => item.href)).toEqual([
      '/sites/abc',
      '/sites/abc/pages',
      '/sites/abc/content',
      '/sites/abc/data',
      '/sites/abc/media',
      '/sites/abc/header',
      '/sites/abc/footer',
      '/sites/abc/design',
      '/sites/abc/publishing',
      '/sites/abc/settings',
      '/sites/abc/sections',
    ])
    // Screens that belong to a destination keep it current.
    const items = groups[1]!.items
    expect(items.find(item => item.label === 'Site look')?.also).toEqual([
      '/sites/abc/global-elements',
      '/sites/abc/navigation',
    ])
    expect(items.find(item => item.label === 'Media')?.also).toEqual(['/sites/abc/documents'])
    expect(items.find(item => item.label === 'Sections')?.also).toEqual(['/sites/abc/recipes'])
    expect(items.find(item => item.label === 'Settings')?.also).toEqual(['/sites/abc/domains', '/sites/abc/redirects'])
  })

  /**
   * The one that would otherwise be found by a person clicking it.
   *
   * `Overview` lives at the site's own path, and `Sections` lives below it. If
   * `Overview` matched by prefix it would be marked current while somebody was
   * looking at Sections, so the sidebar would say they were in two places.
   */
  it('marks Overview by an exact path and Sections by prefix', () => {
    const site = navigationFor({ id: 'abc', name: 'Demo' }, superAccess)[1]!
    expect(site.items.find(item => item.label === 'Overview')?.match).toBe('exact')
    expect(site.items.find(item => item.label === 'Sections')?.match).toBe('prefix')
  })

  it('shows only role-appropriate administration links for the current site', () => {
    const site = { id: 'abc', name: 'Demo' },
      labels = (access?: Parameters<typeof navigationFor>[1]) =>
        navigationFor(site, access).flatMap(group => group.items.map(item => item.label))
    expect(labels()).not.toContain('People & access')
    expect(labels()).not.toContain('Sections')
    for (const role of ['contributor', 'editor', 'reviewer']) {
      const actual = labels({
        isSuperAdmin: false,
        memberships: new Map([
          ['abc', role],
          ['another-site', 'site_admin'],
        ]),
      })
      expect(actual).not.toContain('People & access')
      expect(actual).not.toContain('Sections')
      expect(actual).toContain('Pages')
      expect(actual).toContain('Lists')
      expect(actual).not.toContain('Site look')
      expect(actual).not.toContain('Settings')
    }
    expect(labels({ isSuperAdmin: false, memberships: new Map([['abc', 'site_admin']]) })).toContain('Sections')
    expect(labels({ isSuperAdmin: false, memberships: new Map([['abc', 'site_admin']]) })).not.toContain(
      'People & access',
    )
    expect(labels(superAccess)).toEqual(expect.arrayContaining(['People & access', 'Sections']))
  })

  it('names an icon this build actually has', () => {
    const names = navigationFor({ id: 'abc', name: 'Demo' }, superAccess).flatMap(group =>
      group.items.map(item => item.icon),
    )
    expect(new Set(names)).toEqual(
      new Set([
        'sites',
        'home',
        'inbox',
        'people',
        'pages',
        'collections',
        'design',
        'globalElements',
        'navigation',
        'publishing',
        'sections',
        'media',
        'settings',
        'activity',
      ]),
    )
  })
  it('offers Menu & footer for a reviewed original design while ordinary sites keep Site look', () => {
    const site = { id: 'abc', name: 'Original design', original_design: true }
    const items = navigationFor(site, superAccess)[1]!.items
    expect(items.find(item => item.label === 'Menu & footer')).toMatchObject({
      href: '/sites/abc/design',
      also: ['/sites/abc/global-elements', '/sites/abc/navigation'],
    })
    expect(items.some(item => item.label === 'Site look')).toBe(false)
    expect(
      navigationFor({ ...site, original_design: false }, superAccess)[1]!.items.some(
        item => item.label === 'Site look',
      ),
    ).toBe(true)
  })
})

it('page-scoped users see their pages and inbox without whole-site tools', () => {
  const groups = navigationFor(
    { id: 'abc', name: 'Chapters', chapters_enabled: true },
    {
      isSuperAdmin: false,
      memberships: new Map(),
      pageScopes: new Map([['one', { siteId: 'abc', role: 'contributor' }]]),
    },
  )
  expect(groups[1]!.items.map(item => item.label)).toEqual(['Home', 'Pages'])
  expect(groups[0]!.items.map(item => item.label)).not.toContain('People & access')
})

it('division staff with no pages can reach only their chapter workspace and ordinary scoped screens', () => {
  const groups = navigationFor(
    { id: 'abc', name: 'Chapters', chapters_enabled: true },
    {
      isSuperAdmin: false,
      memberships: new Map(),
      divisionScopes: new Map([['team', { siteId: 'abc', name: 'Example division (sample)' }]]),
    },
  )
  expect(groups[1]!.items.map(item => item.label)).toEqual(['Home', 'Pages', 'Chapters'])
  expect(groups[0]!.items.map(item => item.label)).not.toContain('Activity')
})

it('adds the Stories destination only for a site with a Stories list', () => {
  const site = { id: 'stories', name: 'Stories site', has_stories: true }
  expect(navigationFor(site, superAccess)[1]!.items.find(item => item.label === 'Stories')?.href).toBe(
    '/sites/stories/stories',
  )
  expect(
    navigationFor({ ...site, has_stories: false }, superAccess)[1]!.items.some(item => item.label === 'Stories'),
  ).toBe(false)
})

it('offers the national template only to Super admins on eligible native sites', () => {
  const site = { id: 'abc', name: '[Site]', national_template: true }
  expect(
    navigationFor(site, superAccess)
      .flatMap(group => group.items)
      .find(item => item.label === 'Template')?.href,
  ).toBe('/sites/abc/template')
  expect(
    navigationFor(site, { isSuperAdmin: false, memberships: new Map([['abc', 'site_admin']]) })
      .flatMap(group => group.items)
      .some(item => item.label === 'Template'),
  ).toBe(false)
  expect(
    navigationFor({ ...site, original_design: true }, superAccess)
      .flatMap(group => group.items)
      .some(item => item.label === 'Template'),
  ).toBe(false)
})

it('keeps the native header screen to Site admins and Super admins', () => {
  const site = { id: 'own', name: '[Site]' }
  for (const role of ['editor', 'contributor'])
    expect(
      navigationFor(site, { isSuperAdmin: false, memberships: new Map([['own', role]]) })
        .flatMap(group => group.items)
        .some(item => item.label === 'Header & menu'),
    ).toBe(false)
  expect(
    navigationFor(site, { isSuperAdmin: false, memberships: new Map([['own', 'site_admin']]) })
      .flatMap(group => group.items)
      .some(item => item.href === '/sites/own/header'),
  ).toBe(true)
  expect(
    navigationFor({ ...site, original_design: true }, superAccess)
      .flatMap(group => group.items)
      .some(item => item.label === 'Header & menu'),
  ).toBe(false)
})

it('keeps Footer in site administration and out of Editor, Contributor and imported navigation', () => {
  const site = { id: 'own', name: '[Site]' }
  for (const role of ['editor', 'contributor'])
    expect(
      navigationFor(site, { isSuperAdmin: false, memberships: new Map([['own', role]]) })
        .flatMap(group => group.items)
        .some(item => item.label === 'Footer'),
    ).toBe(false)
  expect(
    navigationFor(site, { isSuperAdmin: false, memberships: new Map([['own', 'site_admin']]) })
      .flatMap(group => group.items)
      .some(item => item.href === '/sites/own/footer'),
  ).toBe(true)
  expect(
    navigationFor({ ...site, original_design: true }, superAccess)
      .flatMap(group => group.items)
      .some(item => item.label === 'Footer'),
  ).toBe(false)
})

it('keeps original-design navigation unchanged while hiding native site-wide screens from other-site admins', () => {
  const access = {
      isSuperAdmin: false,
      memberships: new Map([
        ['abc', 'editor'],
        ['other', 'site_admin'],
      ]),
    },
    native = navigationFor({ id: 'abc', name: '[Site]' }, access).flatMap(group => group.items),
    original = navigationFor({ id: 'abc', name: '[Site]', original_design: true }, access).flatMap(group => group.items)
  expect(native.some(item => item.label === 'Settings' || item.label === 'Site look')).toBe(false)
  expect(original.some(item => item.label === 'Settings')).toBe(true)
  expect(original.some(item => item.label === 'Menu & footer')).toBe(true)
})

it('keeps native content menus short without losing existing lists or scoped home context', () => {
  const editor = { isSuperAdmin: false, memberships: new Map([['site', 'editor']]) },
    site = { id: 'site', name: '[Site]', has_stories: true, has_content_lists: false },
    groups = navigationFor(site, editor),
    items = groups[1]!.items
  expect(groups[1]!.content).toBe(true)
  expect(items.map(item => item.label)).toEqual(['Home', 'Pages', 'Stories', 'Media', 'Publish'])
  expect(items[0]).toMatchObject({ href: '/?site=site', alsoExact: ['/'] })
  expect(
    navigationFor({ ...site, has_content_lists: true }, editor)[1]!.items.some(item => item.label === 'Lists'),
  ).toBe(true)
  expect(
    navigationFor(site, { isSuperAdmin: false, memberships: new Map([['site', 'contributor']]) })[1]!.items.some(
      item => item.label === 'Publish',
    ),
  ).toBe(false)
})

it('keeps the Data values list admin-only and out of brought-in sites', () => {
  const site = { id: 'abc', name: '[Site]' }
  expect(
    navigationFor(site, { isSuperAdmin: false, memberships: new Map([['abc', 'editor']]) })
      .flatMap(group => group.items)
      .some(item => item.label === 'Data values'),
  ).toBe(false)
  expect(
    navigationFor({ ...site, original_design: true }, superAccess)
      .flatMap(group => group.items)
      .some(item => item.label === 'Data values'),
  ).toBe(false)
})

it('keeps site overview and page history out of contributor Home', () => {
  const groups = navigationFor(
      { id: 'site', name: 'Example' },
      { isSuperAdmin: false, memberships: new Map([['site', 'editor']]) },
    ),
    items = groups.flatMap(group => group.items),
    home = groups[1]!.items[0]!
  expect(navItemIsCurrent(home, '/')).toBe(true)
  expect(navItemIsCurrent(home, '/sites/site')).toBe(false)
  expect(navItemIsCurrent(home, '/pages/page/history')).toBe(false)
  expect(items.filter(item => navItemIsCurrent(item, '/pages/page/history')).map(item => item.label)).toEqual(['Pages'])
})
