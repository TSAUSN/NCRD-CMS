import { FooterConfig, NavTree, type NavNode } from '@cms/schema'
import { pageInMenu } from './page-details.ts'
import { readFooterLinks, writeFooterLinks } from './footer-links.ts'
export function pageMenuSwitch(
  tree: NavTree,
  published: NavTree,
  page: { id: string; title: string; slug: string },
  on: boolean,
): NavTree {
  if (pageInMenu(tree, page.id) === on) return tree
  if (!on) {
    const next: NavTree = []
    for (const node of tree) {
      if (node.target.type === 'page' && node.target.page_id === page.id) {
        next.push(...(node.children ?? []))
        continue
      }
      const children = node.children?.filter(
        child => !(child.target.type === 'page' && child.target.page_id === page.id),
      )
      if (node.dropdownGroup && !children?.length) continue
      next.push({ ...node, ...(children ? { children } : {}) })
    }
    return NavTree.parse(next)
  }
  const hidden = tree.some(
    node =>
      (node.target.type === 'page' && node.target.page_id === page.id) ||
      (node.children ?? []).some(child => child.target.type === 'page' && child.target.page_id === page.id),
  )
  if (hidden)
    return NavTree.parse(
      tree.map(node => ({
        ...node,
        ...(node.target.type === 'page' && node.target.page_id === page.id ? { visible: true } : {}),
        ...(node.children
          ? {
              children: node.children.map(child => ({
                ...child,
                ...(child.target.type === 'page' && child.target.page_id === page.id ? { visible: true } : {}),
              })),
            }
          : {}),
      })),
    )
  const existing = (nodes: NavTree) =>
    nodes
      .flatMap(node => [node, ...(node.children ?? [])])
      .find(node => node.target.type === 'page' && node.target.page_id === page.id)
  const old = existing(tree) ?? existing(published)
  const item = {
    label: old?.label ?? page.title.slice(0, 80),
    target: { type: 'page' as const, page_id: page.id },
    visible: true,
  }
  const parent = published.find(node =>
    node.children?.some(child => child.target.type === 'page' && child.target.page_id === page.id),
  )
  const group = tree.findIndex(node =>
    parent ? node.label === parent.label : page.slug.startsWith('ways-we-help/') && node.label === 'Ways We Help',
  )
  if (group >= 0)
    return NavTree.parse(
      tree.map((node, index) => (index === group ? { ...node, children: [...(node.children ?? []), item] } : node)),
    )
  return NavTree.parse([...tree, item])
}
export function reorderPageMenu(tree: NavTree, ids: string[]): NavTree {
  const rank = new Map(ids.map((id, index) => [id, index]))
  const order = <T extends NavNode>(nodes: T[]) => {
    const pages = nodes
      .filter(node => !node.dropdownGroup && node.target.type === 'page' && rank.has(node.target.page_id))
      .sort(
        (a, b) =>
          rank.get((a.target as { page_id: string }).page_id)! - rank.get((b.target as { page_id: string }).page_id)!,
      )
    let index = 0
    return nodes.map(node =>
      !node.dropdownGroup && node.target.type === 'page' && rank.has(node.target.page_id) ? pages[index++]! : node,
    )
  }
  return NavTree.parse(
    order(tree.map(node => ({ ...node, ...(node.children ? { children: order(node.children) } : {}) }))),
  )
}
export function footerPageMembership(footer: FooterConfig, page: { id: string; slug: string }): boolean | null {
  const path = page.slug ? '/' + page.slug : '/'
  if (footer.schemaVersion === 1)
    return footer.groups.some(group =>
      group.links.some(link =>
        link.target.type === 'page' ? link.target.page_id === page.id : link.target.url === path,
      ),
    )
  const links = readFooterLinks(footer.component.values.links)
  return links ? links.some(link => link.url === path) : null
}
export function footerPageSwitch(
  footer: FooterConfig,
  page: { id: string; title: string; slug: string },
  on: boolean,
): FooterConfig {
  if (footerPageMembership(footer, page) === on) return footer
  const path = page.slug ? '/' + page.slug : '/'
  if (footer.schemaVersion === 2) {
    const links = readFooterLinks(footer.component.values.links)
    if (!links) throw Error('Open Footer to edit these formatted links without losing their content.')
    return FooterConfig.parse({
      ...footer,
      component: {
        ...footer.component,
        values: {
          ...footer.component.values,
          links: writeFooterLinks(
            on ? [...links, { label: page.title.slice(0, 120), url: path }] : links.filter(link => link.url !== path),
          ),
        },
      },
    })
  }
  const groups = footer.groups.flatMap(group => {
    const links = group.links.filter(
      link => !(link.target.type === 'page' ? link.target.page_id === page.id : link.target.url === path),
    )
    return links.length || !group.links.length ? [{ ...group, links }] : []
  })
  if (on) {
    const group = groups.find(group => group.links.length < 6)
    if (group) group.links.push({ label: page.title.slice(0, 80), target: { type: 'page', page_id: page.id } })
    else
      groups.push({
        heading: 'Pages',
        links: [{ label: page.title.slice(0, 80), target: { type: 'page', page_id: page.id } }],
      })
  }
  return FooterConfig.parse({ ...footer, groups })
}
export function menuChangeWords(before: NavTree, after: NavTree): string[] {
  const flatten = (tree: NavTree): NavNode[] =>
    tree.flatMap<NavNode>(node => [node, ...(node.children ?? [])]).filter(node => node.visible && !node.dropdownGroup)
  const key = (node: NavNode) => (node.target.type === 'page' ? node.target.page_id : node.target.url)
  const old = flatten(before)
  const next = flatten(after)
  const words: string[] = []
  const added = next.filter(item => !old.some(node => key(node) === key(item)))
  const removed = old.filter(item => !next.some(node => key(node) === key(item)))
  const changed = added.filter(
    item =>
      added.filter(node => node.label === item.label).length === 1 &&
      removed.filter(node => node.label === item.label).length === 1,
  )
  for (const item of changed) words.push('Menu: changed where ' + item.label + ' goes')
  for (const item of added) if (!changed.includes(item)) words.push('Menu: added ' + item.label)
  for (const item of removed)
    if (!changed.some(node => node.label === item.label)) words.push('Menu: removed ' + item.label)
  const oldCommon = old.filter(item => next.some(node => key(node) === key(item)))
  const nextCommon = next.filter(item => old.some(node => key(node) === key(item)))
  for (const item of nextCommon) {
    const previous =
      oldCommon.find(node => key(node) === key(item) && node.label === item.label) ??
      oldCommon.find(node => key(node) === key(item))!
    if (previous.label !== item.label) words.push('Menu: renamed ' + previous.label + ' to ' + item.label)
  }
  if (JSON.stringify(oldCommon.map(key)) !== JSON.stringify(nextCommon.map(key)))
    words.push('Menu: reordered ' + nextCommon.map(item => item.label).join(', '))
  if (!words.length && JSON.stringify(before) !== JSON.stringify(after))
    words.push('Menu: names, links or order changed')
  return words
}
export function footerLinkChangeWords(before: FooterConfig, after: FooterConfig): string[] {
  const links = (footer: FooterConfig) =>
    footer.schemaVersion === 2
      ? readFooterLinks(footer.component.values.links)
      : footer.groups.flatMap(group =>
          group.links.map(link => ({ label: link.label, url: JSON.stringify(link.target) })),
        )
  const old = links(before)
  const next = links(after)
  if (!old || !next) return []
  const added = next.filter(link => !old.some(item => item.url === link.url))
  const removed = old.filter(link => !next.some(item => item.url === link.url))
  const changed = added.filter(
    link =>
      added.filter(item => item.label === link.label).length === 1 &&
      removed.filter(item => item.label === link.label).length === 1,
  )
  return [
    ...changed.map(link => 'Footer: changed where ' + link.label + ' goes'),
    ...added.filter(link => !changed.includes(link)).map(link => 'Footer: added ' + link.label),
    ...removed
      .filter(link => !changed.some(item => item.label === link.label))
      .map(link => 'Footer: removed ' + link.label),
  ]
}
