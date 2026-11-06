// The icon drawings V1's sections use, as a code-owned set (LIB-02). V1 let an
// editor change a card's icon; its section markup carries each card's own SVG.
// When numbered cards become a list, an item's icon is chosen from this set by
// name, and the renderer draws the set's markup byte for byte: content never
// stores SVG. Only drawings V1's own section catalogue already ships are
// included, each checked to be passive line art, so the set adds no new asset
// and no active markup. Names come from V1's icon library where a drawing is
// the same shape, otherwise from the section that uses it.
import { createHash } from 'node:crypto'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'
import type { V1Catalogue } from './source.ts'

const SHAPES = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g'])
const ATTRIBUTES = new Set([
  'viewbox',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'fill-rule',
  'clip-rule',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'xmlns',
  'aria-hidden',
  'focusable',
  'transform',
  'opacity',
  'class',
])

/** A drawing is passive line art: shapes and presentation attributes only, with no URL, script or event anywhere. */
export function isPassiveDrawing(svg: string): boolean {
  const parsed = parseHtml(svg)
  if (!parsed.ok) return false
  const roots = parsed.nodes.filter((node): node is HtmlElement => node.kind === 'element')
  if (
    roots.length !== 1 ||
    roots[0]!.tag !== 'svg' ||
    parsed.nodes.some(node => node.kind === 'text' && node.text.trim() !== '')
  )
    return false
  const passive = (element: HtmlElement): boolean =>
    SHAPES.has(element.tag) &&
    element.attributes.every(
      a => ATTRIBUTES.has(a.name.toLowerCase()) && !/[<>]|url\s*\(|javascript:|expression\s*\(/i.test(a.value),
    ) &&
    element.children.every(child => (child.kind === 'text' ? child.text.trim() === '' : passive(child)))
  return passive(roots[0]!) && !/<\s*\/?\s*(script|style|foreignobject|use|image|a)\b|\bon[a-z]+\s*=/i.test(svg)
}

export function drawingKey(svg: string): string {
  return `d${createHash('sha256').update(svg).digest('hex').slice(0, 10)}`
}

/** The shapes a drawing is made of, ignoring order, classes and spelling, to match V1's library. */
function shapeOf(svg: string): string {
  const parsed = parseHtml(svg)
  if (!parsed.ok) return ''
  const shapes: string[] = []
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (node.tag !== 'svg' && node.tag !== 'g') {
        shapes.push(
          `${node.tag}:${node.attributes
            .filter(a => /^(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points)$/.test(a.name))
            .map(a => `${a.name}=${a.value.replace(/\s+/g, ' ').trim()}`)
            .sort()
            .join(';')}`,
        )
      }
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return shapes.sort().join('|')
}

/** V1's icon library, read as the JSON array it declares, never run. */
export function readIconLibrary(text: string): { label: string; svg: string }[] {
  const start = text.indexOf('[', text.indexOf('iconLibrary'))
  if (start < 0) return []
  // The array's own closing bracket, skipping brackets inside its strings.
  let depth = 0,
    inString = false,
    end = -1
  for (let at = start; at < text.length && end < 0; at += 1) {
    const char = text[at]!
    if (inString) {
      if (char === '\\') at += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '[') depth += 1
    else if (char === ']' && --depth === 0) end = at
  }
  if (end < 0) return []
  const entries = JSON.parse(text.slice(start, end + 1)) as unknown[]
  return entries.filter(
    (entry): entry is { label: string; svg: string } =>
      !!entry &&
      typeof (entry as { label?: unknown }).label === 'string' &&
      typeof (entry as { svg?: unknown }).svg === 'string',
  )
}

export type SourceDrawing = { key: string; label: string; svg: string }

/** Every drawing a V1 section draws inside an icon region, once, in catalogue order. */
export function collectSourceDrawings(
  catalogue: Pick<V1Catalogue, 'definitions' | 'siteVariants'>,
  library: readonly { label: string; svg: string }[] = [],
): SourceDrawing[] {
  const known = library.map(entry => ({
    label: entry.label,
    shapes: new Set(shapeOf(entry.svg).split('|').filter(Boolean)),
  }))
  // The library entry sharing most of a drawing's shapes (Lucide redraws a
  // few strokes of the same symbol), when it shares at least half of them.
  const nameOf = (svg: string): string | undefined => {
    const shapes = shapeOf(svg).split('|').filter(Boolean)
    let best: { label: string; score: number } | undefined
    for (const entry of known) {
      const shared = shapes.filter(shape => entry.shapes.has(shape)).length
      const score = shared / Math.max(shapes.length, entry.shapes.size)
      if (shared > 0 && score >= 0.5 && (!best || score > best.score)) best = { label: entry.label, score }
    }
    return best?.label
  }
  const drawings = new Map<string, SourceDrawing>()
  const used = new Map<string, number>()
  for (const definition of [...catalogue.definitions, ...catalogue.siteVariants]) {
    const parsed = parseHtml(definition.html)
    if (!parsed.ok) continue
    const walk = (nodes: HtmlNode[]) => {
      for (const node of nodes) {
        if (node.kind !== 'element') continue
        if (attribute(node, 'data-editable') === 'icon' && node.children.some(child => child.kind === 'element')) {
          const svg = serializeLegacy(node.children).trim()
          const key = drawingKey(svg)
          if (!drawings.has(key) && isPassiveDrawing(svg)) {
            const count = (used.get(definition.name) ?? 0) + 1
            used.set(definition.name, count)
            drawings.set(key, { key, svg, label: nameOf(svg) ?? `${definition.name} icon ${count}` })
          }
          continue
        }
        walk(node.children)
      }
    }
    walk(parsed.nodes)
  }
  return [...drawings.values()]
}

/** The generated module @cms/schema ships. */
export function sourceDrawingsModule(drawings: readonly SourceDrawing[]): string {
  const body = drawings
    .map(
      drawing =>
        `  ${JSON.stringify(drawing.key)}: { label: ${JSON.stringify(drawing.label)}, svg: ${JSON.stringify(drawing.svg)} },`,
    )
    .join('\n')
  return (
    `// GENERATED from V1's section catalogue by \`pnpm --filter @cms/importer migration drawings\`. Do not edit by hand.\n` +
    `// Each drawing is passive line art V1's own sections draw (packages/importer/src/source-drawings.ts).\n` +
    `export const SOURCE_DRAWINGS = {\n${body}\n} as const satisfies Record<string, { label: string; svg: string }>\n`
  )
}
