import { NavTree } from '@cms/schema'
import { expect, it } from 'vitest'
import type { DropEdge } from '../components/ui/use-reorderable-list.ts'
import { dropMenuItem } from './menu-drop.ts'
import { menuReorderIntent } from './menu-reorder-intent.ts'

const link = (label: string) => ({ label, target: { type: 'url', url: '/' }, visible: true })
const tree = NavTree.parse(['Home', 'About', 'Programs', 'Contact'].map(link))
const labels = (menu: NavTree): string[] =>
  menu.map(item => (item.children ? item.label + '[' + labels(item.children).join(',') + ']' : item.label))
const intent = (menu: NavTree, from: string, over: string, edge: DropEdge, horizontalDistance = 0) =>
  menuReorderIntent(menu, { from, over, edge, horizontalDistance })

function moved(menu: NavTree, from: string, over: string, edge: DropEdge, distance = 0) {
  const decision = intent(menu, from, over, edge, distance)
  expect(decision.status).toBe('move')
  if (decision.status !== 'move') throw Error('Expected a move.')
  return {
    order: labels(dropMenuItem(menu, decision.move.from, decision.move.to, decision.move.position)),
    marker: decision.marker,
  }
}

it('moves Contact above or below Home without turning an ordinary row drop into nesting', () => {
  expect(moved(tree, '3', '0', 'before')).toEqual({
    order: ['Contact', 'Home', 'About', 'Programs'],
    marker: { row: '0', edge: 'before', indented: false },
  })
  expect(moved(tree, '3', '0', 'after', 31)).toEqual({
    order: ['Home', 'Contact', 'About', 'Programs'],
    marker: { row: '0', edge: 'after', indented: false },
  })
  expect(moved(tree, '3', '0', 'after', 32)).toEqual({
    order: ['Home[Contact]', 'About', 'Programs'],
    marker: { row: '0', edge: 'after', indented: true },
  })
})

it('moves one row down or to the end and leaves the original gap unchanged', () => {
  expect(moved(tree, '0', '1', 'after').order).toEqual(['About', 'Home', 'Programs', 'Contact'])
  expect(moved(tree, '0', '3', 'after').order).toEqual(['About', 'Programs', 'Contact', 'Home'])
  expect(intent(tree, '0', '1', 'before')).toEqual({ status: 'unchanged' })
  expect(intent(tree, '1', '1', 'after', 50)).toEqual({ status: 'unchanged' })
  expect(labels(tree)).toEqual(['Home', 'About', 'Programs', 'Contact'])
})

it('moves parents as a group, blocks nesting a parent, and uses a deliberate left gesture to move a child out', () => {
  const withChildren = NavTree.parse([
    { ...link('Programs'), children: [link('Details')] },
    link('Home'),
    link('About'),
  ])
  expect(moved(withChildren, '0', '2', 'after').order).toEqual(['Home', 'About', 'Programs[Details]'])
  expect(intent(withChildren, '0', '1', 'after', 32)).toMatchObject({ status: 'blocked', message: /two levels/ })
  expect(intent(withChildren, '0', '0.0', 'after', 32)).toMatchObject({ status: 'blocked' })
  expect(moved(withChildren, '0.0', '1', 'before', -32).order).toEqual(['Programs', 'Details', 'Home', 'About'])
})

it('preserves dropdown and main-menu limits while allowing reorder within a full group', () => {
  const full = NavTree.parse([
    { ...link('Full'), children: Array.from({ length: 20 }, (_, i) => link('Link ' + i)) },
    link('Outside'),
  ])
  expect(intent(full, '1', '0', 'after', 32)).toMatchObject({ status: 'blocked', message: /dropdown is full/ })
  expect(dropMenuItem(full, '0.0', '0.19', 'after')[0]?.children?.at(-1)?.label).toBe('Link 0')
  const fullMenu = NavTree.parse([...full, ...Array.from({ length: 48 }, (_, i) => link('Extra ' + i))])
  expect(intent(fullMenu, '0.0', '1', 'before', -32)).toMatchObject({ status: 'blocked', message: /main menu is full/ })
  expect(dropMenuItem(fullMenu, '0.0', '1', 'before')).toBe(fullMenu)
})
