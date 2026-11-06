import type { StructuredDocument, StructuredNode } from '@cms/schema'
import { BUILDER_CSS } from './structured-builder.ts'

/** Fixed styles available to the visual controls. SQL verifies these same
 * closed additions, including their compiled output, before saving a version. */
export const VISUAL_BLOCK_STYLES = {
  'builder-text': '.builder-text{line-height:1.7}',
  'builder-image': '.builder-image{max-width:100%;height:auto}',
  'builder-link': '.builder-link{display:inline-block;margin:.75rem 0}',
  'builder-columns':
    '.builder-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.5rem}@media(max-width:767px){.builder-columns{grid-template-columns:1fr}}',
} as const

/** Carry an approved definition's styling unchanged. Newly added visual
 * blocks receive only the builder's fixed rules in a deterministic order. */
export function visualSourceCss(document: StructuredDocument, previousCss?: string): string {
  if (previousCss === undefined) return BUILDER_CSS
  const classes = new Set<string>()
  function walk(nodes: StructuredNode[]) {
    for (const node of nodes) {
      if (node.type === 'element') {
        for (const name of (node.attributes?.['class'] ?? '').split(/\s+/)) classes.add(name)
        walk(node.children ?? [])
      } else if (node.type === 'image' || node.type === 'link') {
        for (const name of node.staticAttributes?.class ?? []) classes.add(name)
      } else if (node.type === 'repeat') walk(node.item)
    }
  }
  walk(document.nodes)
  const additions = Object.entries(VISUAL_BLOCK_STYLES)
    .filter(([name]) => classes.has(name) && !previousCss.includes(`.${name}`))
    .map(([, css]) => css)
  return additions.length ? `${previousCss}\n${additions.join('')}` : previousCss
}
