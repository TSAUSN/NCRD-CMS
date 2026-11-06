import { dropMenuItem } from './menu-editing.ts'
import { expect, it } from 'vitest'
import { canAppendMenuItem, menuHasPage, reorderMenuItem, editMenuItem, moveMenuItem } from './menu-editing.ts'
import { NavTree } from '@cms/schema'
const tree = () =>
  NavTree.parse([
    { label: 'Home', visible: true, target: { type: 'url', url: '/' } },
    { label: 'Visit', visible: true, target: { type: 'url', url: '/visit' } },
    { label: 'Program', visible: true, target: { type: 'url', url: '/program' } },
  ])
it('renames and reorders without mutating saved menu content', () => {
  const before = tree(),
    named = editMenuItem(before, '1', node => ({ ...node, label: 'Plan a visit' }))
  expect(named[1]!.label).toBe('Plan a visit')
  expect(before[1]!.label).toBe('Visit')
  expect(moveMenuItem(named, '1', 'up').map(node => node.label)).toEqual(['Plan a visit', 'Home', 'Program'])
  expect(moveMenuItem(named, '0', 'up')).toBe(named)
  expect(editMenuItem(before, '1.0.0', node => node)).toBe(before)
})
it('indents and moves out within the supported two-level tree without losing links', () => {
  const nested = moveMenuItem(tree(), '1', 'indent')
  expect(nested.map(node => node.label)).toEqual(['Home', 'Program'])
  expect(nested[0]!.children?.[0]).toMatchObject({ label: 'Visit', target: { type: 'url', url: '/visit' } })
  const restored = moveMenuItem(nested, '0.0', 'outdent')
  expect(restored).toEqual(tree())
  expect(NavTree.safeParse(restored).success).toBe(true)
  expect(moveMenuItem(nested, '0', 'indent')).toBe(nested)
  expect(moveMenuItem(nested, '0.0', 'remove')[0]!.children).toBeUndefined()
})

it('reorders actual-header sibling paths without allowing a drag to silently change nesting', () => {
  const tree = [
    { label: 'Home', target: { type: 'url' as const, url: '/' }, visible: true },
    { label: 'Visit', target: { type: 'url' as const, url: '/visit' }, visible: true },
  ]
  expect(reorderMenuItem(tree, '0', '1').map(item => item.label)).toEqual(['Visit', 'Home'])
  expect(reorderMenuItem(tree, '0', '1.0')).toBe(tree)
  expect(reorderMenuItem(tree, '0', '99')).toBe(tree)
  expect(tree.map(item => item.label)).toEqual(['Home', 'Visit'])
})

it('keeps hidden page destinations discoverable without dropping children or allowing excess links', () => {
  const id = '00000000-0000-4000-8000-000000000001',
    before = NavTree.parse([
      {
        label: 'Visit',
        target: { type: 'page', page_id: id },
        visible: false,
        children: [{ label: 'Help', target: { type: 'url', url: '/help' }, visible: true }],
      },
    ])
  expect(menuHasPage(before, id)).toBe(true)
  const shown = editMenuItem(before, '0', node => ({ ...node, visible: true }))
  expect(shown[0]!.children).toEqual(before[0]!.children)
  expect(before[0]!.visible).toBe(false)
  const moved = editMenuItem(shown, '0.0', node => ({
    ...node,
    target: { type: 'url', url: 'https://example.org/help' },
  }))
  expect(moved[0]!.children![0]!.target).toEqual({ type: 'url', url: 'https://example.org/help' })
  expect(NavTree.safeParse(moved).success).toBe(true)
  expect(canAppendMenuItem(before)).toBe(true)
  expect(canAppendMenuItem(Array.from({ length: 50 }, () => tree()[0]!))).toBe(false)
  const full = Array.from({ length: 5 }, () => ({
    ...tree()[0]!,
    children: Array.from({ length: 19 }, () => tree()[1]!),
  }))
  expect(canAppendMenuItem(full)).toBe(false)
  expect(menuHasPage(moved, '00000000-0000-4000-8000-000000000002')).toBe(false)
})

it('drags between levels without a third level or an empty group', () => {
  const tree: NavTree = [
    {
      label: 'Group',
      target: { type: 'url', url: '/' },
      visible: true,
      dropdownGroup: true,
      children: [{ label: 'One', target: { type: 'url', url: '/one' }, visible: true }],
    },
    { label: 'Two', target: { type: 'url', url: '/two' }, visible: true },
    { label: 'Three', target: { type: 'url', url: '/three' }, visible: true },
  ]
  const nested = dropMenuItem(tree, '1', '0', true)
  expect(nested[0]!.children!.map(item => item.label)).toEqual(['One', 'Two'])
  expect(tree).toHaveLength(3)
  expect(dropMenuItem(tree, '0', '1', true)).toEqual(tree)
  const moved = dropMenuItem(tree, '0.0', '2')
  expect(moved.map(item => item.label)).toEqual(['Two', 'One', 'Three'])
  expect(moved.every(item => !item.dropdownGroup)).toBe(true)
})
