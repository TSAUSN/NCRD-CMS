import type { Queryable } from '@cms/platform'
import { NavTree, type NavNode } from '@cms/schema'
export type PageDetailsInput = {
  pageId: string
  title: string
  address: string
  parentId: string | null
  inMenu: boolean | null
  menuRevision: number
}
export function pageInMenu(tree: NavTree, id: string): boolean {
  return tree.some(
    node =>
      node.visible &&
      ((node.target.type === 'page' && node.target.page_id === id) || pageInMenu(node.children ?? [], id)),
  )
}
/** Read-only menu paths use saved labels and never rewrite navigation. */
export function pageMenuLocations(tree: NavTree, id: string, parents: string[] = []): string[] {
  return tree
    .filter(node => node.visible)
    .flatMap(node => {
      const path = [...parents, node.label]
      return [
        ...(node.target.type === 'page' && node.target.page_id === id ? [path.join(' › ')] : []),
        ...pageMenuLocations(node.children ?? [], id, path),
      ]
    })
}
/** Removing a parent link keeps its child links, so a checkbox never loses a submenu. */
export function pageMenuVisibility(tree: NavTree, pageId: string, title: string, visible: boolean): NavTree {
  let saved: NavNode | undefined
  const next: NavTree = []
  for (const node of tree) {
    if (node.target.type === 'page' && node.target.page_id === pageId) {
      saved = node
      next.push(...(node.children ?? []))
      continue
    }
    const children = (node.children ?? []).filter(child => {
      if (child.target.type === 'page' && child.target.page_id === pageId) {
        saved = child
        return false
      }
      return true
    })
    next.push({ ...node, ...(node.children ? { children } : {}) })
  }
  if (visible)
    next.push({ label: saved?.label ?? title.slice(0, 80), target: { type: 'page', page_id: pageId }, visible: true })
  return NavTree.parse(next)
}
export async function savePageDetails(client: Queryable, input: PageDetailsInput, expectedRevision: number) {
  const row = (
    await client.query<{
      revision: string
      draft_version_id: string | null
      menu_revision: string
      title: string
      address: string
      parent_page_id: string | null
      in_menu: boolean
    }>('SELECT * FROM app.save_page_details($1,$2,$3,$4,$5,$6,$7)', [
      input.pageId,
      expectedRevision,
      input.title,
      input.address,
      input.parentId,
      input.inMenu,
      input.menuRevision,
    ])
  ).rows[0]!
  return {
    revision: Number(row.revision),
    versionId: row.draft_version_id,
    menuRevision: Number(row.menu_revision),
    title: row.title,
    address: row.address,
    parentId: row.parent_page_id,
    inMenu: row.in_menu,
  }
}
