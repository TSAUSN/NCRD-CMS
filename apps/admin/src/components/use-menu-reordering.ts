import type { NavTree } from '@cms/schema'
import { dropMenuItem, menuNodeAt, moveMenuItem } from '../lib/menu-editing.ts'
import { menuReorderIntent, type MenuMove } from '../lib/menu-reorder-intent.ts'
import { useReorderableList } from './ui/use-reorderable-list.ts'

export function useMenuReordering(
  tree: NavTree,
  onChange: (tree: NavTree) => void,
  mimeType = 'application/x-cms-menu',
) {
  const reorder = useReorderableList({
    mimeType,
    decide: point => menuReorderIntent(tree, point),
    apply: ({ from, to, position }: MenuMove) => {
      const next = dropMenuItem(tree, from, to, position)
      if (next === tree) return
      onChange(next)
      const target = menuNodeAt(tree, to)
      return 'Moved ' + (position === 'inside' ? 'under ' : position + ' ') + (target?.label || 'the menu item') + '.'
    },
  })
  function moveByKeyboard(path: string, action: 'up' | 'down' | 'indent' | 'outdent') {
    const next = moveMenuItem(tree, path, action)
    if (next === tree) return
    onChange(next)
    const label = menuNodeAt(tree, path)?.label || 'menu item'
    const placement =
      action === 'indent' ? 'under the previous item' : action === 'outdent' ? 'out of the dropdown' : action
    reorder.announce('Moved ' + label + ' ' + placement + '.')
  }
  return { reorder, moveByKeyboard }
}
