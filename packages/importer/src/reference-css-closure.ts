import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { attribute, parseHtml, type HtmlNode } from './html.ts'

/** Conservative rule closure for a static reference fragment. A rule is removed
 * only when every parsed selector branch requires a tag, class or ID absent
 * from that fragment. Negative/state selectors and attribute state are retained;
 * declarations, token definitions, media conditions and keyframes are not guessed.
 * This deliberately over-retains ambiguous selectors rather than losing styling. */
export type StyleInventory = { tags: Set<string>; classes: Set<string>; ids: Set<string>; uncertain: boolean }

export function referenceCssClosure(
  html: string,
  css: string,
): {
  css: string
  inputRules: number
  retainedRules: number
  sourceBytes: number
  retainedBytes: number
} {
  const htmlTree = parseHtml(html)
  if (!htmlTree.ok) throw new Error('cannot determine source style dependencies for unreadable markup')
  const found: StyleInventory = { tags: new Set(), classes: new Set(), ids: new Set(), uncertain: false }
  const inventory = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      found.tags.add(node.tag)
      const classNames = attribute(node, 'class') ?? ''
      if (/&(?:#|[A-Za-z])/.test(classNames)) found.uncertain = true
      for (const name of classNames.split(/\s+/)) if (name) found.classes.add(name)
      const id = attribute(node, 'id')
      if (id) found.ids.add(id)
      if (id && /&(?:#|[A-Za-z])/.test(id)) found.uncertain = true
      inventory(node.children)
    }
  }
  inventory(htmlTree.nodes)
  return cssClosure(found, css)
}

/** The same closure for markup another parser has already read: the caller
 * supplies the tags, classes and IDs the fragment contains. */
export function cssClosure(
  { tags, classes, ids, uncertain: uncertainInventory }: StyleInventory,
  css: string,
): {
  css: string
  inputRules: number
  retainedRules: number
  sourceBytes: number
  retainedBytes: number
} {
  const possible = (container: selectorParser.Container): boolean => {
    if (uncertainInventory) return true
    for (const node of container.nodes ?? []) {
      if (node.type === 'class' && !classes.has(node.value)) return false
      if (node.type === 'id' && !ids.has(node.value)) return false
      if (node.type === 'tag' && !tags.has(node.value.toLowerCase())) return false
      if (
        node.type === 'pseudo' &&
        [':is', ':where', ':has'].includes(node.value) &&
        node.nodes?.length &&
        !node.nodes.some(branch => possible(branch))
      )
        return false
      // :not, :nth-child, :hover, attribute states (e.g. [open]) and unknown
      // syntax do not impose positive inventory requirements.
    }
    return true
  }
  const root = postcss.parse(css)
  let inputRules = 0
  root.walkRules(() => {
    inputRules += 1
  })
  root.walkRules(rule => {
    let ancestor: postcss.AnyNode | undefined = rule.parent
    while (ancestor) {
      if (ancestor.type === 'atrule' && /(?:^|-)keyframes$/i.test(ancestor.name)) return
      ancestor = ancestor.parent
    }
    try {
      const selectors = selectorParser().astSync(rule.selector)
      if (!selectors.nodes.some(branch => possible(branch))) rule.remove()
    } catch {
      // The governing compiler still judges safety. Parser uncertainty here
      // can only retain extra source styling, never silently remove it.
    }
  })
  const conditionals: postcss.AtRule[] = []
  root.walkAtRules(at => {
    conditionals.push(at)
  })
  for (const at of conditionals.reverse()) if (at.nodes && at.nodes.every(node => node.type === 'comment')) at.remove()
  let retainedRules = 0
  root.walkRules(() => {
    retainedRules += 1
  })
  const output = root.toString()
  return {
    css: output,
    inputRules,
    retainedRules,
    sourceBytes: Buffer.byteLength(css),
    retainedBytes: Buffer.byteLength(output),
  }
}
