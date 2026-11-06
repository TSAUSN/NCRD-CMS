import postcss from 'postcss'
import { escapeText } from '@cms/renderer'
import { isObject, type JsonObject } from './backup.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const escapedAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
export function serializeLegacy(nodes: HtmlNode[]): string {
  return nodes
    .map(node =>
      node.kind === 'text'
        ? node.text
        : `<${node.tag}${node.attributes.map(a => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join('')}>` +
          (VOID.has(node.tag) ? '' : `${serializeLegacy(node.children)}</${node.tag}>`),
    )
    .join('')
}
function set(node: HtmlElement, name: string, value: string | null) {
  node.attributes = node.attributes.filter(a => a.name !== name)
  if (value !== null) node.attributes.push({ name, value: escapedAttribute(value) })
}
function style(node: HtmlElement, property: string, value: string) {
  const css = postcss.parse(`.source{${attribute(node, 'style') ?? ''}}`)
  const rule = css.nodes[0]
  if (!rule || rule.type !== 'rule') throw new Error('style could not be read')
  rule.walkDecls(property, declaration => {
    declaration.remove()
  })
  if (value) rule.append({ prop: property, value })
  const declaration = rule.nodes.map(n => n.toString()).join(';')
  set(node, 'style', declaration || null)
}

/** Pure subset of fieldsForContent/applyBlockToElement, with every unsupported
 * field reported. Unknown style data is retained in the source record, never
 * treated as an applied change. The resulting complete fragment is validated
 * by staticCompatibility before it is eligible for a V2 reference draft. */
export function applyLegacyValues(
  html: string,
  content: JsonObject,
): { html: string; issues: string[]; appliedFields: number } {
  const parsed = parseHtml(html)
  if (!parsed.ok) return { html, issues: ['legacy-value-parser-refused'], appliedFields: 0 }
  const issues = new Set<string>()
  const regions = new Map<string, HtmlElement>()
  const collect = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const id = attribute(node, 'data-block-id') ?? attribute(node, 'data-slot-id')
      if (id) {
        if (regions.has(id)) issues.add('duplicate-legacy-region')
        else regions.set(id, node)
      }
      collect(node.children)
    }
  }
  collect(parsed.nodes)
  let appliedFields = 0
  // Apply in document order: replacing an outer rich region invalidates inner
  // references, which must be reported rather than edited while detached.
  if (Object.keys(content).some(id => !regions.has(id))) issues.add('unmapped-saved-region')
  for (const id of [...regions.keys()]) {
    if (!Object.hasOwn(content, id)) continue
    const value = content[id]
    // Re-query after an outer region replacement; a reference to its detached
    // old child would silently discard the child's saved value.
    regions.clear()
    collect(parsed.nodes)
    const node = regions.get(id)
    if (!node || !isObject(value)) {
      issues.add('unmapped-saved-region')
      continue
    }
    const type = attribute(node, 'data-editable')
    let fullyApplied = true
    const flag = (code: string) => {
      issues.add(code)
      fullyApplied = false
    }
    const fields = isObject(value.fields) ? value.fields : value
    const allowed = new Set(['hidden', 'fields', 'customCss'])
    if (value.hidden !== undefined) set(node, 'hidden', value.hidden ? '' : null)
    if (value.customCss) flag('block-custom-css-review')
    if (value.hidden) {
      if (fullyApplied) appliedFields += 1
      continue
    }
    try {
      if (type === 'image') {
        for (const key of ['src', 'url', 'alt']) allowed.add(key)
        const url = fields.src ?? fields.url
        if (typeof url === 'string' && url) set(node, 'src', url)
        if (typeof fields.alt === 'string') set(node, 'alt', fields.alt)
      } else if (type === 'link') {
        for (const key of ['href', 'text', 'external', 'nofollow', 'style']) allowed.add(key)
        if (typeof fields.href === 'string' && fields.href) set(node, 'href', fields.href)
        if (fields.external) {
          set(node, 'target', '_blank')
          set(node, 'rel', fields.nofollow ? 'noopener noreferrer nofollow' : 'noopener noreferrer')
        } else if (fields.nofollow) {
          set(node, 'target', null)
          set(node, 'rel', 'nofollow')
        } else if (fields.external !== undefined || fields.nofollow !== undefined) {
          set(node, 'target', null)
          set(node, 'rel', null)
        }
        if (typeof fields.text === 'string' && !node.children.some(child => child.kind === 'element')) {
          node.children = [{ kind: 'text', text: escapeText(fields.text), line: node.line }]
        }
        // Derived styles pre-fill V1 controls and deliberately do not mutate markup.
        if (isObject(fields.style) && Object.keys(fields.style).length && !fields.style.derived)
          flag('button-style-review')
      } else if (type === 'text' || type === 'richtext' || type === 'html') {
        for (const key of ['html', 'text', 'content', 'textAlign', 'color', 'shape', 'epoch']) allowed.add(key)
        const text = fields.html ?? fields.content ?? fields.text
        if (typeof fields.textAlign === 'string') style(node, 'text-align', fields.textAlign)
        if (typeof fields.color === 'string') style(node, 'color', fields.color)
        const shape = node.children
          .filter(child => child.kind === 'element')
          .map(child => (child.kind === 'element' ? child.tag : ''))
          .join('>')
        const stale =
          Number(attribute(node, 'data-content-epoch') ?? 0) > Number(fields.epoch ?? 0) ||
          (fields.shape != null && fields.shape !== shape)
        if (stale) flag('stale-saved-region-retained')
        if (typeof text === 'string' && !stale) {
          const fragment = parseHtml(text)
          if (fragment.ok) {
            if (node.children.some(child => child.kind === 'element' && [...regions.values()].includes(child)))
              flag('nested-saved-region-review')
            node.children = fragment.nodes
          } else flag('saved-markup-parser-refused')
        }
      } else if (type === 'icon') {
        for (const key of ['svg', 'name']) allowed.add(key)
        const findSvg = (nodes: HtmlNode[]): HtmlElement | undefined => {
          for (const child of nodes)
            if (child.kind === 'element') {
              if (child.tag === 'svg') return child
              const found = findSvg(child.children)
              if (found) return found
            }
          return undefined
        }
        if (typeof fields.svg === 'string') {
          const fragment = parseHtml(fields.svg)
          if (!fragment.ok) flag('saved-icon-parser-refused')
          else {
            const oldSvg = findSvg(node.children)
            const classes = (oldSvg ? (attribute(oldSvg, 'class') ?? '') : '')
              .split(/\s+/)
              .filter(name => /^(w|h|text|size)-/.test(name))
            node.children = fragment.nodes
            const newSvg = findSvg(node.children)
            if (newSvg && classes.length)
              set(
                newSvg,
                'class',
                [...new Set([...(attribute(newSvg, 'class') ?? '').split(/\s+/).filter(Boolean), ...classes])].join(
                  ' ',
                ),
              )
          }
        }
        if (typeof fields.name === 'string') set(node, 'data-icon-name', fields.name)
      } else flag('unsupported-saved-field-type')
      if (Object.keys(fields).some(key => !allowed.has(key)) || Object.keys(value).some(key => !allowed.has(key)))
        flag('unknown-saved-field')
      if (fullyApplied) appliedFields += 1
    } catch {
      flag('saved-style-parser-refused')
    }
  }
  return { html: serializeLegacy(parsed.nodes), issues: [...issues].sort(), appliedFields }
}
