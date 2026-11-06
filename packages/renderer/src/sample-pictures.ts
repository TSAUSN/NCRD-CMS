import { parseHtml, type HtmlNode } from './source-html.ts'
/** Reviewed Echelon compositions omit generic illustrations; generic library News cards retain their explicit sample placeholder. */
export function withoutSamplePictures(html: string): string {
  const parsed = parseHtml(html, { locations: true }),
    cuts: { start: number; end: number }[] = []
  if (!parsed.ok)
    return html.replace(/<img\b[^>]*>/gi, tag => {
      const match = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag),
        source = match?.[1] ?? match?.[2] ?? match?.[3]
      if (!source) return tag
      try {
        const path = decodeURIComponent(new URL(source, 'https://local.invalid/').pathname)
        return /^\/cms-samples(?:\/|$)/i.test(path) ? '' : tag
      } catch {
        return tag
      }
    })
  function walk(nodes: HtmlNode[], allowPlaceholder = false, omitEmpty = false) {
    for (const node of nodes)
      if (node.kind === 'element') {
        const classes = node.attributes.find(a => a.name === 'class')?.value.split(/\s+/) ?? [],
          genericCards = allowPlaceholder || classes.includes('cms-section--core-image-link-cards'),
          emptySection =
            omitEmpty ||
            classes.some(name =>
              [
                'cms-section--core-split-hero',
                'cms-section--core-text-image',
                'cms-section--core-image-link-cards',
                'cms-section--core-chapter-board',
                'cms-section--core-image-gallery',
              ].includes(name),
            )
        if (node.tag === 'img' && node.source) {
          const source = node.attributes.find(a => a.name === 'src')?.value ?? ''
          try {
            const path = decodeURIComponent(new URL(source, 'https://local.invalid/').pathname)
            if (
              (emptySection && (!source || source === '#')) ||
              (/^\/cms-samples(?:\/|$)/i.test(path) && !(genericCards && source.startsWith('/cms-samples/')))
            )
              cuts.push(node.source)
          } catch {}
        }
        walk(node.children, genericCards, emptySection)
      }
  }
  walk(parsed.nodes)
  for (const cut of cuts.sort((a, b) => b.start - a.start)) html = html.slice(0, cut.start) + html.slice(cut.end)
  return html
}
