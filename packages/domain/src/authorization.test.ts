import { describe, expect, it } from 'vitest'
import { assignedSiteIds, can, siteRoleOf, pageRoleOf, type Principal } from './authorization.ts'

const principal = (over: Partial<Principal> = {}): Principal => ({
  userId: 'u1',
  status: 'active',
  isSuperAdmin: false,
  memberships: new Map([['site-a', 'editor']]),
  ...over,
})

describe('the capability matrix mirrors SPEC §4', () => {
  it('a contributor edits drafts but does not publish', () => {
    const p = principal({ memberships: new Map([['site-a', 'contributor']]) })
    expect(can(p, 'edit_draft', 'site-a')).toBe(true)
    expect(can(p, 'publish', 'site-a')).toBe(false)
    expect(can(p, 'review', 'site-a')).toBe(false)
  })

  it('an editor publishes and reviews but does not change site settings', () => {
    const p = principal()
    expect(can(p, 'publish', 'site-a')).toBe(true)
    expect(can(p, 'manage_site', 'site-a')).toBe(false)
  })

  it('a site admin manages the site but cannot approve raw markup', () => {
    const p = principal({ memberships: new Map([['site-a', 'site_admin']]) })
    expect(can(p, 'manage_site', 'site-a')).toBe(true)
    expect(can(p, 'approve_trusted_code', 'site-a')).toBe(false)
  })

  it('only a super admin approves raw markup or manages the platform', () => {
    const p = principal({ isSuperAdmin: true, memberships: new Map() })
    expect(can(p, 'approve_trusted_code', 'site-a')).toBe(true)
    expect(can(p, 'manage_platform', null)).toBe(true)
  })
})

describe('scoping', () => {
  it('grants nothing on a site the person is not a member of', () => {
    const p = principal()
    expect(can(p, 'edit_draft', 'site-b')).toBe(false)
    expect(siteRoleOf(p, 'site-b')).toBeNull()
  })

  it('a disabled user has no capability anywhere, super admin included', () => {
    const p = principal({ status: 'disabled', isSuperAdmin: true })
    expect(can(p, 'edit_draft', 'site-a')).toBe(false)
    expect(can(p, 'manage_platform', null)).toBe(false)
    expect(assignedSiteIds(p)).toEqual([])
  })

  it('a site-scoped capability is never granted with a null site', () => {
    expect(can(principal(), 'publish', null)).toBe(false)
  })
})

it('page scopes grant only that page, never whole-site or management capabilities', () => {
  const p = principal({
    memberships: new Map(),
    pageScopes: new Map([
      ['one', { siteId: 'site-a', role: 'contributor' }],
      ['two', { siteId: 'site-a', role: 'editor' }],
    ]),
  })
  expect(pageRoleOf(p, 'site-a', 'one')).toBe('contributor')
  expect(pageRoleOf(p, 'site-a', 'two')).toBe('editor')
  expect(pageRoleOf(p, 'site-a', 'three')).toBeNull()
  expect(pageRoleOf(p, 'site-b', 'one')).toBeNull()
  for (const capability of ['edit_draft', 'publish', 'review', 'manage_pages', 'manage_site'] as const)
    expect(can(p, capability, 'site-a')).toBe(false)
  expect(assignedSiteIds(p)).toEqual(['site-a'])
  expect(pageRoleOf({ ...p, status: 'disabled' }, 'site-a', 'one')).toBeNull()
})

it('division scopes identify assigned sites without granting whole-site or arbitrary page capabilities', () => {
  const p = principal({
    memberships: new Map(),
    divisionScopes: new Map([['team', { siteId: 'site-a', name: 'Example division (sample)' }]]),
  })
  expect(assignedSiteIds(p)).toEqual(['site-a'])
  expect(pageRoleOf(p, 'site-a', 'unknown')).toBeNull()
  expect(siteRoleOf(p, 'site-a')).toBeNull()
  expect(can(p, 'manage_site', 'site-a')).toBe(false)
  expect(assignedSiteIds({ ...p, status: 'disabled' })).toEqual([])
})
