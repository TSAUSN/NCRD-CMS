import {
  decodeSourceText,
  attribute,
  depthOf,
  elements,
  parseHtml,
  type HtmlElement,
  type HtmlNode,
  type SourceRange,
} from './source-html.ts'
import type { SlotDef } from '@cms/schema'

export type OrganizedSource = {
  originalHtml: string
  originalCss: string
  sourceHtml: string
  sourceCss: string
  fields: SlotDef[]
  samples: Record<string, unknown>
  notes: string[]
  blocking: string[]
}
type Edit = SourceRange & { value: string }
const TOKENS = /\{\{\s*([a-zA-Z][\w-]{0,63})\s*\}\}/g
const ACTIVE = new Set([
  'html',
  'head',
  'body',
  'script',
  'iframe',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'audio',
  'video',
  'canvas',
])
const COPY = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'span',
  'strong',
  'em',
  'small',
  'figcaption',
  'dt',
  'dd',
  'a',
  'div',
  'section',
  'article',
])
const RICH_BLOCKS = new Set(['p', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'br', 'strong', 'em', 'b', 'i', 's', 'a'])

/** Source offsets allow replacements without reserializing authored markup.
 * This is a proposal generator. The unchanged production compiler and mandatory
 * preview still judge every proposed or manually corrected definition. */
export function organizeSource(html: string, css: string, existing: readonly SlotDef[] = []): OrganizedSource {
  const result: OrganizedSource = {
    originalHtml: html,
    originalCss: css,
    sourceHtml: html,
    sourceCss: css,
    fields: [...existing],
    samples: {},
    notes: [],
    blocking: [],
  }
  if (html.length + css.length > 300_000) {
    result.blocking.push('Use one section fragment smaller than 300 KB.')
    return result
  }
  const parsed = parseHtml(html, { locations: true, styles: true })
  if (!parsed.ok) {
    result.blocking.push(`Correct the source before organizing: ${parsed.refusal}.`)
    return result
  }
  const all = elements(parsed.nodes)
  if (all.length > 2000 || depthOf(parsed.nodes) > 40) {
    result.blocking.push('Use a section with at most 2,000 elements and 40 nesting levels.')
    return result
  }
  const edits: Edit[] = [],
    used = new Set([...html.matchAll(TOKENS)].map(match => match[1]!)),
    fieldIds = new Set(existing.map(field => field.id))
  const idElements = new Map<string, HtmlElement[]>()
  const label = (value: string) => value.replace(/[-_]+/g, ' ').replace(/^./, value => value.toUpperCase())
  function propose(base: string, kind: SlotDef['kind'], sample: unknown): string {
    base =
      base
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 52) || 'content'
    if (!/^[a-z]/.test(base)) base = `field-${base}`
    let id = base,
      n = 2
    while (used.has(id) || fieldIds.has(id)) id = `${base}-${n++}`
    used.add(id)
    fieldIds.add(id)
    result.fields.push({ id, kind, label: label(id), constraints: { sourceSample: sample } })
    result.samples[id] = sample
    return id
  }
  function replace(range: SourceRange | undefined, value: string) {
    if (range) edits.push({ ...range, value })
  }
  function token(value: string) {
    return `{{${value}}}`
  }
  function raw(node: HtmlElement) {
    return html.slice(node.source!.start, node.source!.end)
  }
  function hasToken(node: HtmlElement) {
    return /\{\{/.test(raw(node))
  }
  for (const node of all) {
    if (ACTIVE.has(node.tag))
      result.blocking.push(
        `Line ${node.line}: <${node.tag}> needs manual correction; only an inert section fragment can be organized.`,
      )
    for (const attr of node.attributes) {
      if (/^on/i.test(attr.name) || ['srcdoc', 'action', 'formaction'].includes(attr.name))
        result.blocking.push(`Line ${node.line}: remove the active ${attr.name} attribute.`)
      if (
        ['href', 'src', 'poster'].includes(attr.name) &&
        /^\s*(?:javascript|data|vbscript):/i.test(decodeSourceText(attr.value))
      )
        result.blocking.push(`Line ${node.line}: replace the unsupported ${attr.name} address.`)
    }
    const rawId = attribute(node, 'id'),
      id = rawId ? decodeSourceText(rawId) : undefined
    if (id) {
      const list = idElements.get(id) ?? []
      list.push(node)
      idElements.set(id, list)
    }
  }
  if (result.blocking.length) return result
  // Ambiguous duplicate identifiers need a deliberate owner choice. References
  // inside each repeated subtree can be repaired; references outside it keep
  // the original first target, exactly as browser getElementById does.
  for (const [id, nodes] of idElements) {
    if (nodes.length < 2) continue
    if (!/^[A-Za-z][\w-]*$/.test(id)) {
      result.blocking.push(`Duplicate id “${id}” needs a simple identifier before it can be repaired.`)
      continue
    }
    nodes.slice(1).forEach((node, index) => {
      let next = `${id}-${index + 2}`,
        suffix = index + 2
      while (idElements.has(next)) next = `${id}-${++suffix}`
      idElements.set(next, [node])
      replace(node.attributes.find(attr => attr.name === 'id')?.valueRange, next)
      for (const child of elements([node]))
        for (const attr of child.attributes) {
          if (attr.name === 'href' && decodeSourceText(attr.value) === `#${id}`) replace(attr.valueRange, `#${next}`)
          if (['for', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'headers'].includes(attr.name)) {
            const values = decodeSourceText(attr.value)
              .split(/\s+/)
              .map(value => (value === id ? next : value))
              .join(' ')
            if (values !== attr.value) replace(attr.valueRange, values)
          }
        }
      result.notes.push(
        `Renamed duplicate #${id} to #${next}; references inside that element follow it. Outside references still select #${id}.`,
      )
    })
    if (
      new RegExp(`#${id}(?![\\w-])`).test(css) ||
      all.some(node => node.tag === 'style' && new RegExp(`#${id}(?![\\w-])`).test(raw(node)))
    ) {
      result.blocking.push(
        `Styles select duplicate #${id}. Change that styling to a shared class before organizing so every copy keeps its appearance.`,
      )
    }
  }
  if (result.blocking.length) return result
  const styleParts: string[] = []
  function richSafe(nodes: HtmlNode[]): boolean {
    return nodes.every(
      node =>
        node.kind === 'text' ||
        (RICH_BLOCKS.has(node.tag) &&
          node.attributes.every(attr => node.tag === 'a' && ['href', 'title', 'target', 'rel'].includes(attr.name)) &&
          richSafe(node.children)),
    )
  }
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      if (node.tag === 'style') {
        if (node.attributes.some(attr => attr.name !== 'type' || attr.value !== 'text/css')) {
          result.blocking.push(
            `Line ${node.line}: remove style attributes other than type="text/css" before separating CSS.`,
          )
          continue
        }
        styleParts.push(html.slice(node.source!.openEnd, node.source!.closeStart))
        replace(node.source, '')
        continue
      }
      // Existing deliberate fields and their surrounding content are untouched.
      if (hasToken(node)) {
        walk(node.children)
        continue
      }
      if (node.tag === 'img') {
        if (attribute(node, 'srcset') !== undefined || attribute(node, 'sizes') !== undefined) {
          result.notes.push(
            `Line ${node.line}: responsive image kept unchanged; choose governed media and review its source variants manually.`,
          )
          continue
        }
        const src = node.attributes.find(attr => attr.name === 'src'),
          alt = node.attributes.find(attr => attr.name === 'alt')
        if (!src?.valueRange || !alt?.valueRange) {
          result.notes.push(`Line ${node.line}: image needs quoted src and alt before it can become an editable field.`)
          continue
        }
        const id = propose('image', 'image', {
          src: decodeSourceText(src.value),
          alt: decodeSourceText(alt.value),
          decorative: alt.value === '',
        })
        replace(src.valueRange, token(id))
        replace(alt.valueRange, token(id))
        const role = node.attributes.find(attr => attr.name === 'role')
        if (role?.valueRange) replace(role.valueRange, token(id))
        else {
          const end = node.source!.openEnd - (html[node.source!.openEnd - 2] === '/' ? 2 : 1)
          replace({ start: end, end }, ` role="${token(id)}"`)
        }
        continue
      }
      if (node.tag === 'a') {
        const href = node.attributes.find(attr => attr.name === 'href')
        if (href?.valueRange && !href.value.startsWith('#')) {
          const id = propose('link', 'link', {
            url: decodeSourceText(href.value),
            label:
              decodeSourceText(
                node.children
                  .filter(child => child.kind === 'text')
                  .map(child => child.text)
                  .join('')
                  .trim(),
              ) || 'Link',
          })
          replace(href.valueRange, token(id))
          result.notes.push(
            `“${label(id)}” controls the destination; the text stays a separate editable field so the original anchor styling is preserved.`,
          )
        }
      }
      if (
        ['div', 'section', 'article'].includes(node.tag) &&
        node.children.some(child => child.kind === 'element' && ['p', 'ul', 'ol', 'blockquote'].includes(child.tag)) &&
        richSafe(node.children)
      ) {
        const id = propose('body', 'richtext', html.slice(node.source!.openEnd, node.source!.closeStart))
        replace({ start: node.source!.openEnd, end: node.source!.closeStart }, token(id))
        continue
      }
      if (
        COPY.has(node.tag) &&
        node.children.every(child => child.kind === 'text') &&
        node.children.some(child => child.kind === 'text' && child.text.trim())
      ) {
        // Comments remain byte-for-byte intact; replace individual text nodes.
        for (const child of node.children)
          if (child.kind === 'text' && child.text.trim()) {
            const id = propose(
              /^h[1-6]$/.test(node.tag) ? 'heading' : node.tag === 'a' ? 'link-text' : 'text',
              'text',
              decodeSourceText(child.text.trim()),
            )
            const leading = child.text.match(/^\s*/)?.[0] ?? '',
              trailing = child.text.match(/\s*$/)?.[0] ?? ''
            replace(child.source, `${leading}${token(id)}${trailing}`)
          }
      } else walk(node.children)
    }
  }
  walk(parsed.nodes)
  if (result.blocking.length) return { ...result, fields: [...existing], samples: {} }
  // Reject overlap instead of applying a partially understandable proposal.
  const ordered = edits.sort((a, b) => a.start - b.start)
  if (ordered.some((edit, index) => index > 0 && edit.start < ordered[index - 1]!.end)) {
    return {
      ...result,
      fields: [...existing],
      samples: {},
      blocking: ['Overlapping source changes need manual correction; the original was preserved.'],
    }
  }
  result.sourceHtml = ordered.reduceRight(
    (source, edit) => source.slice(0, edit.start) + edit.value + source.slice(edit.end),
    html,
  )
  result.sourceCss = [...styleParts, css].filter(Boolean).join('\n\n')
  result.notes.push(
    'Original source is retained for comparison. Review proposed fields, sample content and the compiled preview before saving.',
  )
  return result
}
