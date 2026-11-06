import { validSectionAnchor, sectionAnchorNames, type SectionInstance } from '@cms/schema'
import { parseHtml, decodeSourceText, type HtmlNode } from '@cms/renderer/source-html'
import { escapeAttribute } from '@cms/renderer/escape'
export type SectionLinkContext = {
  targetPaths: string[]
  pagePath: string
  hosts: string[]
  oldName: string
  newName: string
  urlKeys?: string[]
  fragmentOnly?: boolean
  oldNames?: string[]
}
export function renamedSectionUrl(value: string, context: SectionLinkContext): string {
  if (!value.includes('#') || (value.startsWith('#') && context.fragmentOnly === false)) return value
  let url: URL
  try {
    url = new URL(value, 'https://cms.invalid' + context.pagePath)
  } catch {
    return value
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.hostname !== 'cms.invalid' && !context.hosts.includes(url.hostname))
  )
    return value
  const path = url.pathname.replace(/(.)\/$/, '$1') || '/'
  let name: string
  try {
    name = decodeURIComponent(url.hash.slice(1))
  } catch {
    return value
  }
  if (!context.targetPaths.includes(path) || !(context.oldNames ?? [context.oldName]).includes(name)) return value
  return value.slice(0, value.indexOf('#') + 1) + context.newName
}
/** Only destinations and actual anchor attributes change; prose, markup and nonlink settings stay byte-identical. */
export function rewriteSectionLinks<T>(
  value: T,
  context: SectionLinkContext,
): { value: T; count: number; unsafe: boolean } {
  let count = 0,
    unsafe = false
  const ambiguous = (url: string) => {
    if (context.fragmentOnly !== false || !url.startsWith('#')) return false
    try {
      return (context.oldNames ?? [context.oldName]).includes(decodeURIComponent(url.slice(1)))
    } catch {
      return false
    }
  }
  const visit = (current: unknown, key = ''): unknown => {
    if (Array.isArray(current)) return current.map(item => visit(item, key))
    if (current && typeof current === 'object')
      return Object.fromEntries(Object.entries(current).map(([name, item]) => [name, visit(item, name)]))
    if (typeof current !== 'string') return current
    if (['url', 'href', ...(context.urlKeys ?? [])].some(name => key === name || key.endsWith('__' + name))) {
      if (ambiguous(current)) unsafe = true
      const next = renamedSectionUrl(current, context)
      if (next !== current) count++
      return next
    }
    if (!/\bhref\s*=/i.test(current) || !current.includes('#')) return current
    const parsed = parseHtml(current, { locations: true, styles: true })
    if (!parsed.ok) {
      if ((context.oldNames ?? [context.oldName]).some(name => current.includes(name))) unsafe = true
      return current
    }
    const edits: { start: number; end: number; value: string }[] = []
    const walk = (nodes: HtmlNode[]) => {
      for (const node of nodes)
        if (node.kind === 'element') {
          if (node.tag === 'a') {
            const href = node.attributes.find(attr => attr.name === 'href')
            if (href?.valueRange) {
              if (ambiguous(decodeSourceText(href.value))) unsafe = true
              const next = renamedSectionUrl(decodeSourceText(href.value), context)
              if (next !== decodeSourceText(href.value)) {
                count++
                edits.push({ ...href.valueRange, value: escapeAttribute(next) })
              }
            }
          }
          walk(node.children)
        }
    }
    walk(parsed.nodes)
    let next = current
    for (const edit of edits.sort((a, b) => b.start - a.start))
      next = next.slice(0, edit.start) + edit.value + next.slice(edit.end)
    return next
  }
  return { value: visit(value) as T, count, unsafe }
}
export function nextSectionAnchor(name: string, sections: readonly SectionInstance[]): string {
  const used = new Set(sections.flatMap(section => sectionAnchorNames(section.values))),
    base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60),
    first = validSectionAnchor(base) ? base : 'section-link'
  let candidate = first,
    n = 1
  while (used.has(candidate)) {
    n++
    const ending = '-' + n
    candidate = first.slice(0, 64 - ending.length) + ending
  }
  return candidate
}
export function changeSectionAnchor(section: SectionInstance, name: string): SectionInstance {
  if (!validSectionAnchor(name)) throw Error('Start with a letter and use lowercase letters, numbers and hyphens.')
  const aliases = sectionAnchorNames(section.values).filter(old => old !== name),
    values = { ...section.values, __cms_anchor: name }
  if (aliases.length) (values as Record<string, unknown>).__cms_anchor_aliases = aliases
  return { ...section, values }
}
