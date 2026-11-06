import { expect, it } from 'vitest'
import { personAccessSummary, personRoles } from './people-access.ts'
const empty = { super_admin: false, memberships: [], pageAssignments: [], divisionAssignments: [] }
it('describes zero, one and many independent scopes without implying whole-site access', () => {
  expect(personAccessSummary(empty)).toBe('No assigned access')
  const page = { pageId: 'page', siteId: 'site', chapterId: 'chapter', title: 'Chapter', enabled: true }
  expect(personAccessSummary({ ...empty, pageAssignments: [page] })).toBe('1 chapter page')
  expect(personRoles({ ...empty, pageAssignments: [page] })).toBe('Content creator')
  const mixed = {
    ...empty,
    memberships: [{ siteId: 'a', role: 'editor' as const }],
    pageAssignments: [page, page],
    divisionAssignments: [{ divisionId: 'division', siteId: 'site', name: '[Division]' }],
  }
  expect(personAccessSummary(mixed)).toBe('1 site · 2 chapter pages · 1 division')
  expect(personRoles(mixed)).toBe('Site editor · Content creator · Site editor · division')
  expect(personAccessSummary({ ...mixed, super_admin: true })).toBe('All sites')
  expect(personRoles({ ...mixed, super_admin: true })).toBe('Super admin')
})
