import type { NavTree } from '@cms/schema'
import { planMenuDrop, type MenuDropPosition } from './menu-drop.ts'
import type { ReorderDecision, ReorderPoint } from '../components/ui/use-reorderable-list.ts'

const nestDistance = 32
export type MenuMove = { from: string; to: string; position: MenuDropPosition }

/** The row's top/bottom edge reorders; a lateral gesture changes depth. */
export function menuReorderIntent(tree: NavTree, point: ReorderPoint): ReorderDecision<MenuMove> {
  const { from, over, edge, horizontalDistance } = point
  if (from === over) return { status: 'unchanged' }
  const fromChild = from.includes('.')
  const overChild = over.includes('.')
  const rootPath = over.split('.')[0]!
  const root = tree[Number(rootPath)]
  const childCount = root?.children?.length ?? 0
  let to = over
  let position: MenuDropPosition = edge
  if (fromChild && horizontalDistance <= -nestDistance) to = rootPath
  else if (horizontalDistance >= nestDistance) position = 'inside'
  else if (!fromChild && overChild) to = rootPath
  else if (fromChild && !overChild) {
    if (!childCount)
      return { status: 'blocked', message: 'Drag right to move this link under the item, or left to move it out.' }
    to = rootPath + '.' + (edge === 'before' ? '0' : String(childCount - 1))
  }

  const decision = planMenuDrop(tree, from, to, position)
  if (decision.status === 'blocked') return { status: 'blocked', message: decision.reason }
  if (decision.status === 'unchanged') return decision
  const afterChildren = !to.includes('.') && (position === 'inside' || position === 'after') && childCount
  return {
    status: 'move',
    marker: {
      row: afterChildren ? rootPath + '.' + (childCount - 1) : to,
      edge: position === 'inside' ? 'after' : edge,
      indented: position === 'inside' || to.includes('.'),
    },
    move: { from, to, position },
  }
}
