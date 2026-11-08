import { parseHtml, decodeSourceText, type HtmlNode, type HtmlElement } from './source-html.ts'
import { resolvedCollection } from './structured.ts'
import { escapeText, safeUrl } from './escape.ts'
/** Clear both archive placements instead of leaving empty links to #. */
export function renderStoryArchive(html: string, value: unknown): string {
  const url =
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && !Array.isArray(value)
        ? (value as { url?: unknown }).url
        : null
  if (typeof url === 'string' && url.trim() && (safeUrl(url) !== '#' || url.trim() === '#'))
    return html.replaceAll('data-cms-slot="more"', 'data-cms-slot="newsroom"')
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return html
  const edits: { start: number; end: number }[] = []
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const classes = node.attributes.find(a => a.name === 'class')?.value.split(/\s+/) ?? []
        if (node.source && classes.some(name => ['core-story-desktop-link', 'core-story-more'].includes(name)))
          edits.push(node.source)
        else walk(node.children)
      }
  }
  walk(parsed.nodes)
  for (const edit of edits.reverse()) html = html.slice(0, edit.start) + html.slice(edit.end)
  return html
}

/** The optional byline uses plain text and never changes an article without it. */
export function renderStoryAuthor(html: string, value: unknown): string {
  const values = resolvedCollection(value)?.entries[0]?.values
  const author = values && typeof values === 'object' ? (values as Record<string, unknown>).author : undefined
  if (typeof author !== 'string' || !author.trim() || author.length > 120) return html
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return html
  let end: number | undefined
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        if (node.tag === 'h1' && node.source && end === undefined) end = node.source.end
        else walk(node.children)
      }
  }
  walk(parsed.nodes)
  return end === undefined
    ? html
    : html.slice(0, end) + '<p class="core-story-author">By ' + escapeText(author.trim()) + '</p>' + html.slice(end)
}

/** Presentation-only cleanup: keep the approved article bytes and show repeated opening words once. */
export function renderStoryDetail(html: string): string {
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return html
  const hasClass = (node: HtmlElement, name: string) =>
    node.attributes.some(a => a.name === 'class' && a.value.split(/\s+/).includes(name))
  const words = (nodes: HtmlNode[]): string =>
    nodes.map(node => (node.kind === 'text' ? decodeSourceText(node.text) : words(node.children))).join('')
  const normalized = (nodes: HtmlNode[]) => words(nodes).replace(/\s+/g, ' ').trim()
  const cuts: { start: number; end: number }[] = []
  let opening: HtmlElement | undefined
  let article: HtmlElement | undefined
  function walk(nodes: HtmlNode[], inMeta = false) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const meta = inMeta || hasClass(node, 'core-story-meta')
        if (
          meta &&
          node.source &&
          (hasClass(node, 'core-story-region-pill') || hasClass(node, 'core-story-sectors')) &&
          !normalized(node.children)
        )
          cuts.push(node.source)
        if (hasClass(node, 'core-story-opening')) opening = node
        if (hasClass(node, 'core-story-text')) article = node
        walk(node.children, meta)
      }
  }
  walk(parsed.nodes)
  function firstParagraph(nodes: HtmlNode[]): HtmlElement | undefined {
    for (const node of nodes)
      if (node.kind === 'element') {
        if (node.tag === 'p' && normalized(node.children)) return node
        const child = firstParagraph(node.children)
        if (child) return child
      }
    return undefined
  }
  const first = article && firstParagraph(article.children)
  const intro = opening && normalized(opening.children)
  const firstWords = first && normalized(first.children)
  if (opening?.source && intro && firstWords && (firstWords === intro || firstWords.startsWith(intro + ' ')))
    cuts.push(opening.source)
  for (const cut of cuts.sort((a, b) => b.start - a.start)) html = html.slice(0, cut.start) + html.slice(cut.end)
  return html
}
