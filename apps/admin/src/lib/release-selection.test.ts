import { expect, it } from 'vitest'
import type { ReleaseItem } from './releases.ts'
import { initialReleasePick, selectedReleaseKeys } from './release-selection.ts'
import { publishTogetherReviewHref } from './publish-together-copy.ts'
const first = '00000000-0000-4000-8000-000000000001',
  second = '00000000-0000-4000-8000-000000000002'
const items = [
  { key: 'first', id: first, type: 'page', requiresAdmin: false },
  { key: 'other', id: second, type: 'page', requiresAdmin: false },
  { key: 'look', id: first, type: 'theme', requiresAdmin: true },
  { key: 'list', id: first, type: 'collection_schema', requiresAdmin: true },
] as ReleaseItem[]
it('keeps default and Site look selection while respecting administration permissions', () => {
  expect(selectedReleaseKeys(items, true)).toEqual(['first', 'other', 'look', 'list'])
  expect(selectedReleaseKeys(items, false)).toEqual(['first', 'other'])
  expect(selectedReleaseKeys(items, true, 'site-look')).toEqual(['look'])
})
it('selects only requested page dependencies and named areas, never unrelated drafts', () => {
  expect(selectedReleaseKeys(items, true, undefined, initialReleasePick(first, '1', '1'))).toEqual([
    'first',
    'look',
    'list',
  ])
  expect(selectedReleaseKeys(items, false, undefined, initialReleasePick(first, '1', '1'))).toEqual(['first'])
  expect(selectedReleaseKeys(items, true, undefined, initialReleasePick('invalid', '1', undefined))).toEqual(['look'])
  expect(initialReleasePick(undefined, '1', '1')).toBeUndefined()
  expect(initialReleasePick([first, second], '1', '1')).toEqual({ pages: [], siteLook: false, lists: false })
  expect(initialReleasePick(first + ',' + first + ',bad', undefined, undefined)?.pages).toEqual([first])
})
it('names the exact related review in the navigation hint without approving samples', () => {
  const href = publishTogetherReviewHref(first, {
      siteId: second,
      pages: [{ id: second, title: 'Visit', path: '/visit' }],
      siteWide: true,
      collections: true,
    }),
    url = new URL(href, 'http://localhost')
  expect(url.pathname).toBe(`/sites/${second}/publishing`)
  expect(
    initialReleasePick(url.searchParams.get('pages'), url.searchParams.get('siteLook'), url.searchParams.get('lists')),
  ).toEqual({ pages: [first, second], siteLook: true, lists: true })
  expect(url.searchParams.has('samplesConfirmed')).toBe(false)
})

it('limits frame-task reviews to their saved menu and frame changes', () => {
  const pending = [
    ...items,
    { key: 'menu', id: first, type: 'navigation', requiresAdmin: true },
    { key: 'frame', id: first, type: 'frame', requiresAdmin: true },
    { key: 'files', id: first, type: 'site_files', requiresAdmin: true },
  ] as ReleaseItem[]
  expect(selectedReleaseKeys(pending, true, 'header-menu')).toEqual(['menu', 'frame'])
  expect(selectedReleaseKeys(pending, true, 'footer')).toEqual(['frame'])
  expect(selectedReleaseKeys(pending, false, 'header-menu')).toEqual([])
  expect(selectedReleaseKeys(pending, false, 'footer')).toEqual([])
})
