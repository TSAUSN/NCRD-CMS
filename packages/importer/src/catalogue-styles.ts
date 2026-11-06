import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { referenceCssClosure } from './reference-css-closure.ts'

/** Carry the source-owned, scriptless preset sheet into a definition. V1 adds
 * it before template CSS, so the template keeps the final say in the cascade.
 * This is not an implementation of V1's JavaScript settings or interactions.
 * The ordinary section CSS compiler still governs every retained declaration. */
export function catalogueStyles(html: string, css: string, presetCss: string): string {
  const root = postcss.parse(presetCss)
  root.walkRules(rule => {
    const selectors = selectorParser().astSync(rule.selector)
    const documentRoots: selectorParser.Node[] = []
    selectors.walkPseudos(node => {
      if (node.value.toLowerCase() === ':root') documentRoots.push(node)
    })
    selectors.walkTags(node => {
      if (['html', 'body'].includes(node.value.toLowerCase())) documentRoots.push(node)
    })
    if (documentRoots.length === 0) return
    // Only a standalone :root custom-property declaration has an exact local
    // equivalent. Layout rules, root-dependent selectors and mixed selector
    // lists need a reviewed adaptation; scoping them as descendants silently
    // makes them inert. '&' is the compiler's explicit section-wrapper token.
    if (
      selectors.nodes.length !== 1 ||
      selectors.nodes[0]!.nodes.length !== 1 ||
      selectors.nodes[0]!.nodes[0]!.type !== 'pseudo' ||
      selectors.nodes[0]!.nodes[0]!.value !== ':root' ||
      rule.nodes.some(node => node.type !== 'comment' && (node.type !== 'decl' || !node.prop.startsWith('--')))
    ) {
      throw new Error('preset stylesheet requires document-root behavior')
    }
    rule.selector = '&'
  })
  return `${referenceCssClosure(html, root.toString()).css}\n${css}`
}
