import type { NavTree, NavNode } from '@cms/schema'
export function editMenuItem(tree: NavTree, path: string, change: (node: NavNode) => NavNode): NavTree {
  const indices = path.split('.').map(Number)
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(path)) return tree
  return tree.map((node, index) =>
    index !== indices[0]
      ? node
      : indices.length === 1
        ? change(node)
        : { ...node, children: (node.children ?? []).map((child, at) => (at === indices[1] ? change(child) : child)) },
  )
}
export function moveMenuItem(
  tree: NavTree,
  path: string,
  action: 'up' | 'down' | 'indent' | 'outdent' | 'remove',
): NavTree {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(path)) return tree
  const [parent, child] = path.split('.').map(Number),
    next = structuredClone(tree)
  const root = next[parent!]
  if (!root) return tree
  const list = child === undefined ? next : (root.children ?? [])
  const index = child ?? parent!,
    node = list[index]
  if (!node) return tree
  if (action === 'remove') list.splice(index, 1)
  else if (action === 'up' || action === 'down') {
    const to = index + (action === 'up' ? -1 : 1)
    if (to < 0 || to >= list.length) return tree
    ;[list[index], list[to]] = [list[to]!, list[index]!]
  } else if (action === 'indent') {
    if (
      child !== undefined ||
      parent === 0 ||
      (node as NavNode).children?.length ||
      (next[parent! - 1]!.children?.length ?? 0) >= 20
    )
      return tree
    list.splice(index, 1)
    const previous = next[parent! - 1]!
    previous.children = [
      ...(previous.children ?? []),
      { label: node.label, target: node.target, visible: node.visible },
    ]
  } else {
    if (child === undefined || next.length >= 50) return tree
    list.splice(index, 1)
    next.splice(parent! + 1, 0, node)
  }
  if (child !== undefined && root.children?.length === 0) {
    if (root.dropdownGroup) next.splice(parent!, 1)
    else delete root.children
  }
  return next
}

/** Drag between siblings only; indent/outdent remain explicit keyboard-friendly actions. */
export function reorderMenuItem(tree: NavTree, from: string, to: string): NavTree {
  if (!/^\d+(?:\.\d+)?$/.test(from) || !/^\d+(?:\.\d+)?$/.test(to)) return tree
  const a = from.split('.').map(Number),
    b = to.split('.').map(Number)
  if (a.length !== b.length || (a.length === 2 && a[0] !== b[0])) return tree
  const next = structuredClone(tree),
    list = a.length === 1 ? next : next[a[0]!]?.children
  if (!list) return tree
  const start = a.at(-1)!,
    end = b.at(-1)!
  if (!list[start] || !list[end]) return tree
  list.splice(end, 0, list.splice(start, 1)[0]!)
  return next
}

/** Hidden links still own their destination and place in the tree. */
export function menuHasPage(tree: NavTree, pageId: string): boolean {
  return tree.some(
    node => (node.target.type === 'page' && node.target.page_id === pageId) || menuHasPage(node.children ?? [], pageId),
  )
}
export function canAppendMenuItem(tree: NavTree): boolean {
  return tree.length < 50 && tree.reduce((count, node) => count + 1 + (node.children?.length ?? 0), 0) < 100
}

/** Drop before a row, or into a root row when the pointer moves right.
 * Reuses the same bounded two-level tree; no page or command is recreated. */
export function dropMenuItem(tree: NavTree, from: string, to: string, inside = false): NavTree {
  if (!/^\d+(?:\.\d+)?$/.test(from) || !/^\d+(?:\.\d+)?$/.test(to) || from === to) return tree
  const a = from.split('.').map(Number),
    b = to.split('.').map(Number),
    next = structuredClone(tree)
  if (!next[a[0]!] || !next[b[0]!]) return tree
  const sourceParent = a.length === 2 ? next[a[0]!] : null,
    destinationParent = b.length === 2 ? next[b[0]!] : null
  const sourceList = sourceParent?.children ?? next,
    destinationList = inside ? (next[b[0]!]!.children ?? []) : (destinationParent?.children ?? next)
  const source = sourceList[a.at(-1)!] as NavNode | undefined,
    destination = (b.length === 2 ? destinationParent?.children?.[b[1]!] : next[b[0]!]) as NavNode | undefined
  if (!source || !destination || source === destination || source.children?.includes(destination)) return tree
  const nested = inside || Boolean(destinationParent)
  if (nested && (source.children?.length || (inside && (b.length !== 1 || (destination.children?.length ?? 0) >= 20))))
    return tree
  if (!nested && sourceParent && next.length >= 50) return tree
  if (nested && !inside && destinationParent !== sourceParent && destinationList.length >= 20) return tree
  sourceList.splice(a.at(-1)!, 1)
  if (sourceParent?.children?.length === 0 && sourceParent !== destination && sourceParent !== destinationParent) {
    if (sourceParent.dropdownGroup) next.splice(next.indexOf(sourceParent), 1)
    else delete sourceParent.children
  }
  if (nested) {
    const child = { label: source.label, target: source.target, visible: source.visible }
    if (inside) destination.children = [...(destination.children ?? []), child]
    else destinationList.splice(destinationList.indexOf(destination), 0, child)
  } else next.splice(next.indexOf(destination), 0, source)
  return next
}
