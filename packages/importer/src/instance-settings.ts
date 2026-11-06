import postcss from 'postcss'
import { isObject } from './backup.ts'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'

/** The V1 public renderer's bounded freeform grid contract. Import only its
 * numeric grid positions and closed mobile-density choices; never CSS supplied
 * in a settings object. Other settings stay named review findings. */
export function applyInstanceSettings(
  html: string,
  settings: unknown,
): { html: string; css: string; issues: string[] } {
  if (!isObject(settings) || !Object.keys(settings).length) return { html, css: '', issues: [] }
  const parsed = parseHtml(html)
  if (!parsed.ok) return { html, css: '', issues: ['section-settings-parser-refused'] }
  const elements = (nodes: HtmlNode[]): HtmlElement[] =>
    nodes.flatMap(node => (node.kind === 'text' ? [] : [node, ...elements(node.children)]))
  const nodes = elements(parsed.nodes)
  const root = nodes[0]
  if (!root) return { html, css: '', issues: ['section-settings-empty-source'] }
  const issues = new Set<string>()
  const bounded = (value: unknown) => {
    const n = typeof value === 'number' || typeof value === 'string' ? Math.round(Number(value)) : NaN
    return Number.isFinite(n) && n >= 1 && n <= 500 ? n : 0
  }
  const style = (node: HtmlElement, values: Record<string, number>) => {
    const rule = postcss.parse(`.source{${attribute(node, 'style') ?? ''}}`).first!
    if (rule.type !== 'rule') throw new Error('source inline style could not be read')
    for (const [prop, value] of Object.entries(values)) {
      rule.walkDecls(prop, declaration => {
        declaration.remove()
      })
      rule.append({ prop, value: String(value) })
    }
    node.attributes = node.attributes.filter(attr => attr.name !== 'style')
    node.attributes.push({ name: 'style', value: rule.nodes.map(node => node.toString()).join(';') })
  }
  const freeform = settings.freeform
  if (isObject(freeform)) {
    // The grid is the element V1's freeform renderer draws on (`.fe-section`),
    // which an imported section may wrap; V1 finds it by its class, so does this.
    const grid = nodes.find(node => (attribute(node, 'class') ?? '').split(/\s+/).includes('fe-section'))
    if (!grid) issues.add('freeform-root-mapping-review')
    else {
      const sizes = isObject(freeform.grid) ? freeform.grid : {}
      for (const [viewport, prop] of [
        ['d', '--rows'],
        ['m', '--m-rows'],
      ] as const) {
        const value = sizes[viewport]
        const rows = isObject(value) ? bounded(value.rows) : 0
        if (rows) style(grid, { [prop]: rows })
      }
      for (const [id, layouts] of Object.entries(isObject(freeform.blocks) ? freeform.blocks : {})) {
        const node = nodes.find(node => attribute(node, 'data-fe-block') === id)
        if (!node || !isObject(layouts)) {
          issues.add('freeform-block-mapping-review')
          continue
        }
        for (const [viewport, prefix] of [
          ['d', '--'],
          ['m', '--m'],
        ] as const) {
          const rect = layouts[viewport]
          if (!isObject(rect)) continue
          const values = ['c0', 'c1', 'r0', 'r1'].map(key => bounded(rect[key]))
          if (values.some(value => !value) || values[0]! >= values[1]! || values[2]! >= values[3]!) {
            issues.add('freeform-invalid-rectangle-preserved-in-source')
            continue
          }
          style(
            node,
            Object.fromEntries(['c0', 'c1', 'r0', 'r1'].map((key, index) => [`${prefix}${key}`, values[index]!])),
          )
        }
      }
      issues.add('source-freeform-grid-preserved')
    }
  }
  let css = ''
  if (settings.mobileDensity === 'compact' || settings.mobileDensity === 'tight') {
    root.attributes = root.attributes.filter(attr => attr.name !== 'data-mobile-density')
    root.attributes.push({ name: 'data-mobile-density', value: settings.mobileDensity })
    css = `@media(max-width:640px){[data-mobile-density="${settings.mobileDensity}"]{zoom:${settings.mobileDensity === 'compact' ? '0.92' : '0.84'}}}`
    issues.add('source-mobile-density-preserved')
  } else if (settings.mobileDensity) issues.add('mobile-density-mapping-review')
  if (Object.keys(settings).some(key => !['freeform', 'mobileDensity'].includes(key)))
    issues.add('section-settings-review')
  return { html: serializeLegacy(parsed.nodes), css, issues: [...issues].sort() }
}
