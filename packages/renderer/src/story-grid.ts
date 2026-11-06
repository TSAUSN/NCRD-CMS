import { parseHtml, decodeSourceText, type HtmlElement, type HtmlNode } from './source-html.ts'
/** Approved tool's full-row preference; a lone card keeps half the row. */
export function storyGridColumns(count: number): 2 | 3 | 4 {
  if (count <= 2) return 2
  if (count === 3) return 3
  if (count % 4 === 0) return 4
  if (count % 3 === 0) return 3
  return count % 4 === 2 ? 4 : 3
}
/** Tag labels belong to actual values; an untagged card must not imply a missing value. */
function omitEmptyStoryTags(html: string): string {
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return html
  const cuts: { start: number; end: number }[] = []
  const hasClass = (node: HtmlElement, name: string) =>
    node.attributes.some(a => a.name === 'class' && a.value.split(/\s+/).includes(name))
  const words = (nodes: HtmlNode[]): string =>
    nodes.map(node => (node.kind === 'text' ? decodeSourceText(node.text) : words(node.children))).join('')
  function walk(nodes: HtmlNode[], card = false) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const owned = card || hasClass(node, 'core-story-card')
        if (owned && hasClass(node, 'core-story-tags')) {
          const children = node.children.filter((n): n is HtmlElement => n.kind === 'element')
          for (let i = 0; i < children.length - 1; i++) {
            const label = children[i]!,
              value = children[i + 1]!
            if (
              label.tag === 'b' &&
              label.source &&
              value.source &&
              (hasClass(value, 'core-story-sectors') || hasClass(value, 'core-story-region-pill')) &&
              !words(value.children).trim()
            )
              cuts.push({ start: label.source.start, end: value.source.end })
          }
        } else walk(node.children, owned)
      }
  }
  walk(parsed.nodes)
  for (const cut of cuts.sort((a, b) => b.start - a.start)) html = html.slice(0, cut.start) + html.slice(cut.end)
  return html
}
/** Only called for definition-owned Story sections, after filtering and paging. */
export function renderStoryGrid(html: string): string {
  html = omitEmptyStoryTags(html)
  const parsed = parseHtml(html, { locations: true })
  if (!parsed.ok) return html
  const grids: HtmlElement[] = []
  const hasClass = (node: HtmlElement, name: string) =>
    node.attributes.some(a => a.name === 'class' && a.value.split(/\s+/).includes(name))
  function walk(nodes: HtmlNode[]) {
    for (const node of nodes)
      if (node.kind === 'element') {
        if (hasClass(node, 'core-story-grid')) grids.push(node)
        walk(node.children)
      }
  }
  walk(parsed.nodes)
  for (const grid of grids.reverse()) {
    if (!grid.source || grid.attributes.some(a => a.name === 'data-cms-story-grid')) continue
    const count = grid.children.filter(node => node.kind === 'element' && hasClass(node, 'core-story-card')).length,
      at = grid.source.start + 1 + grid.tag.length
    html = html.slice(0, at) + ` data-cms-story-grid="${storyGridColumns(count)}"` + html.slice(at)
  }
  return html
}
const grid =
  '#cms-main .cms-section:is(.cms-section--core-stories,.cms-section--core-newsroom,.cms-section--core-story-world,.cms-section--core-story-split) .core-story-grid[data-cms-story-grid]'
export const STORY_GRID_CSS = `
${grid}{--story-grid-gap:20px;display:flex;flex-wrap:wrap;justify-content:center;align-items:stretch;gap:24px var(--story-grid-gap)}
${grid}:not(:has(>.core-story-card)){display:none}
${grid}>.core-story-card:nth-child(n){display:flex;flex-direction:column;flex:0 0 calc((100% - var(--story-grid-gap))/2);max-width:calc((100% - var(--story-grid-gap))/2);min-width:0}
${grid}[data-cms-story-grid="3"]>.core-story-card:nth-child(n){flex-basis:calc((100% - 2*var(--story-grid-gap))/3);max-width:calc((100% - 2*var(--story-grid-gap))/3)}
${grid}[data-cms-story-grid="4"]>.core-story-card:nth-child(n){flex-basis:calc((100% - 3*var(--story-grid-gap))/4);max-width:calc((100% - 3*var(--story-grid-gap))/4)}
@media(min-width:992px) and (max-width:1199px){${grid}[data-cms-story-grid="4"]>.core-story-card:nth-child(n){flex-basis:calc((100% - 2*var(--story-grid-gap))/3);max-width:calc((100% - 2*var(--story-grid-gap))/3)}}
@media(min-width:768px) and (max-width:991px){${grid}[data-cms-story-grid]>.core-story-card:nth-child(n){flex-basis:calc((100% - var(--story-grid-gap))/2);max-width:calc((100% - var(--story-grid-gap))/2)}}
@media(max-width:767px){${grid}[data-cms-story-grid]>.core-story-card:nth-child(n){flex-basis:100%;max-width:100%}}
`
