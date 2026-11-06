import { attribute, parseHtml, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'

/** Read the source's explicit empty-list fallback without evaluating the V1
 * runtime. This is used only when its checked-in default is [] and the backup
 * contains no event collection. It never manufactures a speaker or schedule.
 * The receiving element ends as V1's script leaves it: the empty-state line,
 * the `is-empty` class its stylesheet lays out, the milestone arrows disabled
 * (V1 shows them faded), the agenda's day tabs hidden and its content a
 * status region. */
export function eventFallbacks(html: string, defaults: string, runtime: string): { html: string; issues: string[] } {
  const specifications = [
    { collection: 'speakers', id: 'speaker-grid', receiver: 'grid', disable: '', hide: '', role: '' },
    {
      collection: 'timeline',
      id: 'timeline-track',
      receiver: 'track',
      disable: 'data-timeline-step',
      hide: '',
      role: '',
    },
    {
      collection: 'agenda',
      id: 'agenda-content',
      receiver: 'content',
      disable: '',
      hide: 'agenda-tabs',
      role: 'status',
    },
  ]
  const replacements = new Map<string, { nodes: HtmlNode[]; role: string }>()
  const disabled = new Set<string>()
  const hidden = new Set<string>()
  for (const specification of specifications) {
    if (!new RegExp(`export\\s+const\\s+${specification.collection}\\s*=\\s*\\[\\s*\\]`).test(defaults)) continue
    const pattern = new RegExp(
      `\\b${specification.receiver}\\.innerHTML\\s*=\\s*'(<p class="event-empty-state"[^']*</p>)'`,
    )
    const match = pattern.exec(runtime)
    if (!match) continue
    const parsed = parseHtml(match[1]!)
    if (
      !parsed.ok ||
      parsed.nodes.length !== 1 ||
      parsed.nodes[0]?.kind !== 'element' ||
      parsed.nodes[0].tag !== 'p' ||
      parsed.nodes[0].children.some(child => child.kind !== 'text')
    )
      continue
    replacements.set(specification.id, { nodes: parsed.nodes, role: specification.role })
    if (specification.disable) disabled.add(specification.disable)
    if (specification.hide) hidden.add(specification.hide)
  }
  const main = /(<main\b[^>]*>)([\s\S]*?)(<\/main\s*>)/i.exec(html)
  const parsed = parseHtml(main ? main[2]! : html)
  if (!parsed.ok || !replacements.size) return { html, issues: [] }
  const applied: string[] = []
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const id = attribute(node, 'id')
      const replacement = id && replacements.get(id)
      if (replacement && !node.children.some(child => child.kind !== 'text' || child.text.trim())) {
        node.children = structuredClone(replacement.nodes)
        const classNames = (attribute(node, 'class') ?? '').split(/\s+/).filter(Boolean)
        node.attributes = node.attributes.filter(
          attr => attr.name !== 'class' && !(replacement.role && attr.name === 'role'),
        )
        node.attributes.push({
          name: 'class',
          value: [...classNames.filter(name => name !== 'is-empty'), 'is-empty'].join(' '),
        })
        if (replacement.role) node.attributes.push({ name: 'role', value: replacement.role })
        applied.push(id)
      }
      if (
        [...disabled].some(name => attribute(node, name) !== undefined) &&
        attribute(node, 'disabled') === undefined
      ) {
        node.attributes.push({ name: 'disabled', value: '' })
      }
      if ((attribute(node, 'class') ?? '').split(/\s+/).some(name => hidden.has(name))) {
        node.attributes = node.attributes.filter(attr => attr.name !== 'hidden')
        node.attributes.push({ name: 'hidden', value: '' })
      }
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  const rendered = serializeLegacy(parsed.nodes)
  return {
    html: main ? html.replace(main[0], `${main[1]}${rendered}${main[3]}`) : rendered,
    issues: applied.length
      ? ['native-empty-collection-fallback-preserved', 'fresh-event-collection-export-required']
      : [],
  }
}
