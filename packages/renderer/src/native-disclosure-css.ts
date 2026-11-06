import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

/** Preserve imported open-state styling after its button becomes native details.
 * Call only after the existing compiled-CSS policy succeeds. No stored version
 * or authored declaration changes; native disclosures also work without JS. */
export function nativeDisclosureCss(css: string): string {
  if (!css.includes('is-open')) return css
  const sheet = postcss.parse(css)
  let changed = false
  sheet.walkRules(rule => {
    const native: string[] = []
    selectorParser(root => {
      root.each(selector => {
        let converted = false
        selector.walkClasses(node => {
          if (node.value !== 'is-open') return
          let sibling = node.prev()
          while (sibling && sibling.type !== 'combinator') {
            if (sibling.type === 'class' && sibling.value === 'faq-item') {
              node.replaceWith(selectorParser.attribute({ attribute: 'open', value: undefined, raws: {} }))
              converted = true
              break
            }
            sibling = sibling.prev()
          }
        })
        if (converted) native.push(selector.toString())
      })
    }).processSync(rule.selector)
    if (native.length) {
      rule.cloneAfter({ selector: native.join(',') })
      changed = true
    }
  })
  return changed ? sheet.toString() : css
}
