import {
  STRUCTURED_SCHEMA_VERSION,
  type StructuredDocument,
  type StructuredNode,
  type StructuredFieldDef,
} from '@cms/schema'

export type BuilderBlock = 'heading' | 'text' | 'image' | 'link' | 'icon' | 'group' | 'columns'
export const BUILDER_CSS =
  '.builder-root{padding:3rem 1.5rem;max-width:72rem;margin:auto}.builder-root h2{margin:0 0 1rem}.builder-text{line-height:1.7}.builder-image{max-width:100%;height:auto}.builder-link{display:inline-block;margin:.75rem 0}.builder-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}@media(max-width:767px){.builder-columns{grid-template-columns:1fr}}'
const BLOCK_STYLES: Record<string, string> = {
  'builder-text': '.builder-text{line-height:1.7}',
  'builder-image': '.builder-image{max-width:100%;height:auto}',
  'builder-link': '.builder-link{display:inline-block;margin:.75rem 0}',
  'builder-columns':
    '.builder-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}@media(max-width:767px){.builder-columns{grid-template-columns:1fr}}',
}

export function includeNewBlockStyles(before: StructuredDocument, after: StructuredDocument, css: string): string {
  function classes(nodes: StructuredNode[], result = new Set<string>()): Set<string> {
    for (const node of nodes) {
      if (node.type === 'element') {
        for (const name of (node.attributes?.['class'] ?? '').split(/\s+/)) result.add(name)
        classes(node.children ?? [], result)
      } else if (node.type === 'image' || node.type === 'link') {
        for (const name of node.staticAttributes?.class ?? []) result.add(name)
      } else if (node.type === 'repeat') classes(node.item, result)
    }
    return result
  }
  const existing = classes(before.nodes)
  const added = [...classes(after.nodes)].filter(
    name => !existing.has(name) && BLOCK_STYLES[name] && !css.includes(`.${name}`),
  )
  return added.length ? `${css}\n${added.map(name => BLOCK_STYLES[name]).join('')}` : css
}

export function newStructuredSection(): StructuredDocument {
  return {
    schemaVersion: STRUCTURED_SCHEMA_VERSION,
    fields: [
      { name: 'heading', type: 'text', label: 'Heading' },
      { name: 'body', type: 'richtext', label: 'Body' },
    ],
    nodes: [
      {
        type: 'element',
        tag: 'section',
        attributes: { class: 'builder-root' },
        children: [
          { type: 'element', tag: 'h2', children: [{ type: 'text', field: 'heading' }] },
          {
            type: 'element',
            tag: 'div',
            attributes: { class: 'builder-text' },
            children: [{ type: 'richtext', field: 'body' }],
          },
        ],
      },
    ],
  }
}

export function childrenOf(node: StructuredNode): StructuredNode[] {
  return node.type === 'element' ? (node.children ?? []) : node.type === 'repeat' ? node.item : []
}

function changeNode(
  doc: StructuredDocument,
  path: number[],
  change: (node: StructuredNode) => StructuredNode,
): StructuredDocument {
  function walk(nodes: StructuredNode[], depth: number): StructuredNode[] {
    return nodes.map((node, index) => {
      if (index !== path[depth]) return node
      if (depth === path.length - 1) return change(node)
      if (node.type === 'element') return { ...node, children: walk(node.children ?? [], depth + 1) }
      if (node.type === 'repeat') return { ...node, item: walk(node.item, depth + 1) }
      return node
    })
  }
  return { ...doc, nodes: walk(doc.nodes, 0) }
}

function changeChildren(
  doc: StructuredDocument,
  parent: number[],
  change: (nodes: StructuredNode[]) => StructuredNode[],
): StructuredDocument {
  if (!parent.length) return { ...doc, nodes: change(doc.nodes) }
  return changeNode(doc, parent, node =>
    node.type === 'element'
      ? { ...node, children: change(node.children ?? []) }
      : node.type === 'repeat'
        ? { ...node, item: change(node.item) }
        : node,
  )
}

function fieldReferences(nodes: StructuredNode[], found = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === 'element') fieldReferences(node.children ?? [], found)
    else if (node.type !== 'provider-embed') found.add(node.field) // repeat item fields belong to the collection, not this document
  }
  return found
}

export function removeBuilderNode(doc: StructuredDocument, path: number[]): StructuredDocument {
  const before = fieldReferences(doc.nodes)
  const updated = changeChildren(doc, path.slice(0, -1), nodes => nodes.filter((_, index) => index !== path.at(-1)))
  const after = fieldReferences(updated.nodes)
  return { ...updated, fields: updated.fields.filter(field => !before.has(field.name) || after.has(field.name)) }
}

export function moveBuilderNode(doc: StructuredDocument, path: number[], direction: -1 | 1): StructuredDocument {
  return changeChildren(doc, path.slice(0, -1), nodes => {
    const index = path.at(-1)!
    const target = index + direction
    if (!nodes[target]) return nodes
    const next = [...nodes]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return next
  })
}

export function addBuilderBlock(doc: StructuredDocument, parent: number[], kind: BuilderBlock): StructuredDocument {
  let field: StructuredFieldDef | null = null
  let node: StructuredNode
  if (kind === 'group' || kind === 'columns') {
    node = {
      type: 'element',
      tag: 'div',
      attributes: { class: kind === 'columns' ? 'builder-columns' : 'builder-group' },
      children: kind === 'columns' ? [0, 1].map(() => ({ type: 'element', tag: 'div', children: [] })) : [],
    }
  } else {
    let name: string = kind
    let number = 1
    while (doc.fields.some(item => item.name === name)) name = `${kind}${++number}`
    field = {
      name,
      type: kind === 'heading' || kind === 'icon' ? 'text' : kind === 'text' ? 'richtext' : kind,
      label:
        kind === 'heading'
          ? 'Heading'
          : kind === 'text'
            ? 'Body text'
            : kind === 'image'
              ? 'Image'
              : kind === 'icon'
                ? 'Icon'
                : 'Link',
    }
    node =
      kind === 'heading'
        ? { type: 'element', tag: 'h2', children: [{ type: 'text', field: name }] }
        : kind === 'text'
          ? {
              type: 'element',
              tag: 'div',
              attributes: { class: 'builder-text' },
              children: [{ type: 'richtext', field: name }],
            }
          : kind === 'image'
            ? {
                type: 'image',
                field: name,
                staticAttributes: { class: ['builder-image'], loading: 'lazy', decoding: 'async' },
              }
            : kind === 'icon'
              ? { type: 'icon', field: name }
              : { type: 'link', field: name, staticAttributes: { class: ['builder-link'] } }
  }
  const next = changeChildren(doc, parent, nodes => [...nodes, node])
  return field ? { ...next, fields: [...next.fields, field] } : next
}
