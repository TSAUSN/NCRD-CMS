import postcss from 'postcss'
import { SiteFileProjection, type SiteOriginalLayout } from '@cms/schema'
import { parseHtml, decodeSourceText } from './source-html.ts'
import { escapeAttribute } from './escape.ts'

/** The whole reviewed projection must be coherent before it changes framing. */
export function originalLayout(projection: unknown, pageId: string) {
  const parsed = SiteFileProjection.safeParse(projection)
  if (!parsed.success) return null
  const { bundle, files } = parsed.data
  const ids = new Set(files.map(file => file.id))
  if (ids.size !== files.length || ids.size !== bundle.files.length || bundle.files.some(id => !ids.has(id)))
    return null
  const layout = bundle.original
  const page =
    layout?.pages.find(page => page.pageId.toLowerCase() === pageId.toLowerCase()) ??
    (layout?.newPages ? { pageId, ...layout.newPages } : undefined)
  return page && layout ? { layout, page } : null
}
export function originalDefinition(layout: SiteOriginalLayout | undefined, id: string, version: number): boolean {
  return layout?.definitions.some(pin => pin.section_def_id === id && pin.section_def_version === version) ?? false
}
export function documentAttributes(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => ' ' + name + '="' + escapeAttribute(value) + '"')
    .join('')
}
/** Annotate the actual authored root. No additional layout element, id or class
 * in ordinary public output. Multiple-root fragments keep the normal wrapper. */
export function originalRoot(body: string, instrumentation: string, classes: readonly string[] = []): string | null {
  const parsed = parseHtml(body, { locations: true })
  if (!parsed.ok) return null
  const roots = parsed.nodes.filter(node => node.kind === 'element' || node.text.trim() !== '')
  if (roots.length !== 1 || roots[0]?.kind !== 'element' || !roots[0].source) return null
  const root = roots[0]
  const at = root.source!.start + 1 + root.tag.length
  let result = body
  if (classes.length) {
    const attribute = root.attributes.find(attribute => attribute.name === 'class')
    if (attribute?.valueRange) {
      const value = escapeAttribute([decodeSourceText(attribute.value), ...classes].join(' '))
      result = result.slice(0, attribute.valueRange.start) + value + result.slice(attribute.valueRange.end)
    } else instrumentation += ' class="' + escapeAttribute(classes.join(' ')) + '"'
  }
  return result.slice(0, at) + instrumentation + result.slice(at)
}

/** A new template has no source-authored offset for Bootstrap's fixed menu.
 * Sticky keeps this header visible while also reserving its real height, with
 * no JavaScript, guessed spacer or change to an explicitly imported page. */
export function originalTemplateHeader(body: string): { html: string; css: string } {
  const parsed = parseHtml(body)
  const root = parsed.ok ? parsed.nodes.find(node => node.kind === 'element') : null
  const classes =
    root?.kind === 'element'
      ? (root.attributes.find(attribute => attribute.name === 'class')?.value.split(/\s+/) ?? [])
      : []
  if (!classes.includes('navbar') || !classes.includes('fixed-top')) return { html: body, css: '' }
  const html = originalRoot(body, ' data-cms-template-header=""')
  return html
    ? { html, css: '[data-cms-template-header].navbar.fixed-top{position:sticky!important;top:0!important}' }
    : { html: body, css: '' }
}

/** Only code-owned theme CSS enters here. Original elements remain outside the
 * generated CMS wrapper scopes; owned font files remain available to new cards. */
export function themeCssWithinSections(css: string, indices: readonly number[]): string {
  if (!indices.length) return ''
  const scope = ':where(' + indices.map(index => '#s' + index).join(',') + ')'
  const root = postcss.parse(css)
  root.walkRules(rule => {
    if (rule.selector === ':root') {
      rule.remove()
      return
    }
    rule.selectors = rule.selectors.map(selector => (selector === 'body' ? scope : scope + ' ' + selector))
  })
  return root.toString()
}
