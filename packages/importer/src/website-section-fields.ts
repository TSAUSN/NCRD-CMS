import {
  type Element,
  walk,
  type Node,
  attr,
  setAttr,
  textOf,
  type ParentNode,
  replaceChildrenWithText,
} from './website-tree.ts'
import { type SlotDef } from '@cms/schema'
import { serialize } from 'parse5'
import { type StyleInventory } from './reference-css-closure.ts'
import { ROOT_CLASS } from './website-styles.ts'

const FIELD_KINDS = new Set(['text', 'richtext', 'image', 'link'])
export const slugPart = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** Fields from explicit tags: only what the HTML names becomes editable. */
export function taggedFields(node: Element): { fields: SlotDef[]; samples: Record<string, unknown> } | null {
  const tagged = [...walk({ childNodes: [node] } as unknown as Node)].filter(el =>
    FIELD_KINDS.has(attr(el, 'data-cms-editable') ?? ''),
  )
  if (!tagged.length) return null
  const fields: SlotDef[] = [],
    samples: Record<string, unknown> = {},
    used = new Set<string>()
  const idFor = (el: Element, kind: string) => {
    const base =
      slugPart(attr(el, 'data-cms-id') ?? attr(el, 'id') ?? `${kind}-${fields.length + 1}`) ||
      `${kind}-${fields.length + 1}`
    let id = /^[a-z]/.test(base) ? base : `field-${base}`,
      n = 2
    while (used.has(id)) id = `${base}-${n++}`
    used.add(id)
    return id
  }
  const label = (id: string) => id.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  for (const el of tagged) {
    const kind = attr(el, 'data-cms-editable')!
    const id = idFor(el, kind)
    if (kind === 'image' && el.tagName === 'img') {
      samples[id] = {
        src: attr(el, 'src') ?? '',
        alt: attr(el, 'alt') ?? '',
        decorative: (attr(el, 'alt') ?? '') === '',
      }
      setAttr(el, 'src', `{{${id}}}`)
      setAttr(el, 'alt', `{{${id}}}`)
      setAttr(el, 'role', `{{${id}}}`)
      fields.push({ id, kind: 'image', label: label(id), constraints: {} })
    } else if (kind === 'link' && el.tagName === 'a') {
      samples[id] = { url: attr(el, 'href') ?? '', label: textOf(el).trim() || 'Link' }
      setAttr(el, 'href', `{{${id}}}`)
      fields.push({ id, kind: 'link', label: label(id), constraints: {} })
    } else if (kind === 'richtext') {
      samples[id] = serialize(el as unknown as ParentNode).trim()
      replaceChildrenWithText(el, `{{${id}}}`)
      fields.push({ id, kind: 'richtext', label: label(id), constraints: {} })
    } else {
      samples[id] = textOf(el).trim()
      replaceChildrenWithText(el, `{{${id}}}`)
      fields.push({ id, kind: 'text', label: label(id), constraints: {} })
    }
  }
  return { fields, samples }
}

/** The tags, classes and IDs a section contains, plus the wrapper it is placed in. */
export function styleInventory(node: Element): StyleInventory {
  const found: StyleInventory = {
    tags: new Set(['div']),
    classes: new Set([ROOT_CLASS]),
    ids: new Set(),
    uncertain: false,
  }
  for (const el of [node, ...walk(node)]) {
    found.tags.add(el.tagName)
    for (const name of (attr(el, 'class') ?? '').split(/\s+/)) if (name) found.classes.add(name)
    const id = attr(el, 'id')
    if (id) found.ids.add(id)
  }
  return found
}

/** Keep elements the proposal step would refuse (inline icons) out of its way. */
export function shelter(html: string): { html: string; restore: (value: string) => string } {
  const kept: string[] = []
  const sheltered = html.replace(/<svg\b[\s\S]*?<\/svg>/gi, svg => {
    kept.push(svg)
    return `<span data-cms-kept="${kept.length - 1}"></span>`
  })
  return {
    html: sheltered,
    restore: value =>
      value.replace(/<span data-cms-kept="(\d+)"><\/span>/g, (_m, index: string) => kept[Number(index)] ?? ''),
  }
}
