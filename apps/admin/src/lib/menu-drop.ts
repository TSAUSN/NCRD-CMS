import type { NavNode, NavTree } from '@cms/schema'

export type MenuDropPosition = 'before' | 'after' | 'inside'
type Located = { node: NavNode; parent: NavNode | null; list: NavNode[]; index: number }
type DropPlan =
  | { status: 'blocked'; reason: string }
  | { status: 'unchanged' }
  | { status: 'move'; source: Located; destination: Located; position: MenuDropPosition }

function locate(tree: NavTree, path: string): Located | null {
  if (!/^\d+(?:\.\d+)?$/.test(path)) return null
  const [root, child] = path.split('.').map(Number)
  const parent = child === undefined ? null : tree[root!]
  const list = child === undefined ? tree : parent?.children
  const index = child ?? root!
  const node = list?.[index]
  return list && node ? { node, parent: parent ?? null, list, index } : null
}

/** Use the same decision while showing the insertion line and on release. */
export function planMenuDrop(tree: NavTree, from: string, to: string, position: MenuDropPosition): DropPlan {
  const source = locate(tree, from)
  const destination = locate(tree, to)
  if (!source || !destination) return { status: 'blocked', reason: 'That menu item is no longer available.' }
  if (source.node === destination.node) return { status: 'unchanged' }
  if (source.node === destination.parent)
    return { status: 'blocked', reason: 'Move a menu item outside its own dropdown.' }
  const parent = position === 'inside' ? destination.node : destination.parent
  if (parent) {
    if (source.node.dropdownGroup || source.node.children?.length || (position === 'inside' && destination.parent))
      return { status: 'blocked', reason: 'Menus go two levels deep. Move the links under this item first.' }
    if (parent !== source.parent && (parent.children?.length ?? 0) >= 20)
      return { status: 'blocked', reason: 'This dropdown is full. Move a link out before adding another.' }
  } else if (source.parent && tree.length >= 50) {
    return { status: 'blocked', reason: 'The main menu is full. Move an item into a dropdown first.' }
  }
  if (source.parent === parent) {
    const gap = position === 'inside' ? source.list.length : destination.index + Number(position === 'after')
    if (gap === source.index || gap === source.index + 1) return { status: 'unchanged' }
  }
  return { status: 'move', source, destination, position }
}

export function dropMenuItem(tree: NavTree, from: string, to: string, position: MenuDropPosition): NavTree {
  if (planMenuDrop(tree, from, to, position).status !== 'move') return tree
  const next = structuredClone(tree)
  const plan = planMenuDrop(next, from, to, position)
  if (plan.status !== 'move') return tree
  const { source, destination } = plan
  const node = source.node
  const nesting = position === 'inside' || destination.parent !== null
  source.list.splice(source.index, 1)
  const item = nesting ? { label: node.label, target: node.target, visible: node.visible } : node
  if (position === 'inside') (destination.node.children ??= []).push(item)
  else {
    const target = destination.list.indexOf(destination.node)
    destination.list.splice(target + Number(position === 'after'), 0, item)
  }
  if (source.parent?.children?.length === 0) {
    if (source.parent.dropdownGroup) next.splice(next.indexOf(source.parent), 1)
    else delete source.parent.children
  }
  return next
}
