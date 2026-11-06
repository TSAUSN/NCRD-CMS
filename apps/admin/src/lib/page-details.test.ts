import { expect, it } from 'vitest'
import { pageInMenu, pageMenuVisibility, pageMenuLocations } from './page-details.ts'
import type { NavTree } from '@cms/schema'
const id = '11111111-1111-4111-8111-111111111111'
it('removes a page link while keeping its children, and adds a visible page without duplicate links', () => {
  const tree: NavTree = [
    {
      label: 'Visit',
      visible: true,
      target: { type: 'page', page_id: id },
      children: [{ label: 'Travel', visible: true, target: { type: 'url', url: '/travel' } }],
    },
  ]
  expect(pageInMenu(tree, id)).toBe(true)
  const removed = pageMenuVisibility(tree, id, 'Visit', false)
  expect(removed.map(node => node.label)).toEqual(['Travel'])
  expect(pageInMenu(removed, id)).toBe(false)
  expect(pageMenuVisibility(removed, id, 'Visit', true).map(node => node.label)).toEqual(['Travel', 'Visit'])
  expect(tree[0]!.children).toHaveLength(1)
})

it('keeps an automatically offered menu name within its existing limit without changing the page title', () => {
  const title = 'A long page title '.repeat(10)
  expect(pageMenuVisibility([], id, title, true)[0]!.label).toBe(title.slice(0, 80))
  expect(title.length).toBeGreaterThan(80)
})

it('reports visible nested menu locations without changing labels or exposing hidden groups', () => {
  const tree: NavTree = [
    {
      label: 'Ways We Help',
      visible: true,
      target: { type: 'url', url: '/' },
      dropdownGroup: true,
      children: [{ label: 'Protection', visible: true, target: { type: 'page', page_id: id } }],
    },
    {
      label: 'Private',
      visible: false,
      target: { type: 'url', url: '/' },
      dropdownGroup: true,
      children: [{ label: 'Hidden choice', visible: true, target: { type: 'page', page_id: id } }],
    },
  ]
  expect(pageMenuLocations(tree, id)).toEqual(['Ways We Help › Protection'])
  expect(tree[0]!.children![0]!.label).toBe('Protection')
})
