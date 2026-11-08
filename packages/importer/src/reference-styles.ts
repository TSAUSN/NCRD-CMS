import postcss from 'postcss'

/** The native Echelon hero includes space for its fixed header inside its own
 * border box. V2's header occupies normal flow. Match only the reviewed source
 * layout, and subtract the same space from both padding and minimum height so
 * moving the header does not make the hero taller. Safe to apply to a selected
 * existing definition's source CSS without rebuilding or duplicating a page. */
export function echelonFlowHeaderStyles(css: string): { css: string; issues: string[]; changed: boolean } {
  const root = postcss.parse(css)
  const heroRules: postcss.Rule[] = []
  root.walkRules(rule => {
    if (rule.selector.trim() === '.hero') heroRules.push(rule)
  })
  const padding = (rule: postcss.Rule) =>
    rule.nodes.find((node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'padding-top')
  const desktop = heroRules.find(rule => rule.parent?.type === 'root' && padding(rule)?.value === '90px')
  const mobile = heroRules.find(
    rule =>
      rule.parent?.type === 'atrule' &&
      rule.parent.name === 'media' &&
      ['(max-width:900px)', '(width<=900px)'].includes(rule.parent.params.replace(/\s/g, '')) &&
      padding(rule)?.value === '78px',
  )
  if (!desktop && !mobile) return { css, issues: [], changed: false }
  const height = desktop?.nodes.find(
    (node): node is postcss.Declaration => node.type === 'decl' && node.prop === 'min-height',
  )
  if (
    !desktop ||
    !mobile ||
    !height ||
    !/^min\(\s*690px\s*,\s*92vh\s*\)$/.test(height.value) ||
    mobile.nodes.some(node => node.type === 'decl' && node.prop === 'min-height')
  ) {
    return { css, issues: ['echelon-hero-header-offset-review-required'], changed: false }
  }
  const sourceHeight = height.value
  padding(desktop)!.value = '0'
  padding(mobile)!.value = '0'
  height.value = `calc(${sourceHeight} - 90px)`
  mobile.append({ prop: 'min-height', value: `calc(${sourceHeight} - 78px)` })
  return { css: root.toString(), issues: ['echelon-fixed-header-space-removed-from-hero'], changed: true }
}

/** Top-level comma-separated layers of a background value. */
function backgroundLayers(value: string): string[] {
  const layers: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      layers.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  layers.push(value.slice(start).trim())
  return layers
}

/**
 * Page decoration painted once in V1 but repeated by every section here. V1's
 * `body` background and `body::before`/`::after` overlays belong to the whole
 * page: Echelon's three corner glows are placed at percentages of the
 * 4,400px-tall document, and its dot texture is one fixed layer. On the
 * per-section document wrapper the glows are re-placed in every section and
 * the fixed overlays stack, tinting sections V1 shows flat. The wrapper keeps
 * the page's base background colour (the last layer) and drops the page
 * images and fixed full-page overlays. Applies to already-stored definition
 * stylesheets as well.
 */
export function pageDecorationStyles(css: string): { css: string; changed: boolean } {
  const root = postcss.parse(css)
  let changed = false
  const ROOT = '.v1-reference-root'
  root.walkRules(rule => {
    const selectors = rule.selectors.map(selector => selector.trim())
    if (selectors.every(selector => selector === ROOT)) {
      rule.walkDecls(decl => {
        if (decl.prop === 'background-image') {
          decl.remove()
          changed = true
          return
        }
        if (decl.prop !== 'background') return
        const layers = backgroundLayers(decl.value)
        if (layers.length < 2) return
        decl.value = layers[layers.length - 1]!
        changed = true
      })
      return
    }
    const overlay = selectors.every(selector => /^\.v1-reference-root::?(?:before|after)$/.test(selector))
    if (
      overlay &&
      rule.nodes.some(node => node.type === 'decl' && node.prop === 'position' && node.value.trim() === 'fixed')
    ) {
      rule.remove()
      changed = true
    }
  })
  return { css: changed ? root.toString() : css, changed }
}

/** V1's page stylesheet owns document-root variables and compiled utility
 * classes. A section scope cannot reach html/:root, so preserve those rules on
 * an explicit local document wrapper. CSS layers are flattened only in this
 * reviewed reference representation; the untouched styles remain source data. */
export function referenceStyles(
  css: string,
  options: { wrapHeroSubtitle?: boolean; readableRegistrationStatus?: boolean; inFlowEchelonHeader?: boolean } = {},
): { css: string; issues: string[] } {
  // Flatten source layers before the narrow layout adapter examines top-level
  // native rules. All other source changes below retain their existing scope.
  const root = postcss.parse(css)
  const issues = new Set<string>()
  root.walkAtRules('theme', at => {
    const rule = postcss.rule({ selector: '.v1-reference-root' })
    for (const node of at.nodes ?? []) if (node.type === 'decl') rule.append(node.clone())
    at.replaceWith(rule)
    issues.add('theme-tokens-scoped-to-reference')
  })
  // Tailwind registers its --tw-* defaults with @property, which section CSS
  // refuses, and repeats them in an @supports fallback for browsers without
  // @property. With the registration gone that fallback is the only source of
  // the defaults (border style, transforms), so it applies unconditionally.
  root.walkAtRules('supports', at => {
    if (/-webkit-hyphens:\s*none/.test(at.params) && /margin-trim/.test(at.params)) {
      if (at.nodes) at.replaceWith(...at.nodes.map(node => node.clone()))
      issues.add('tailwind-property-defaults-unconditional')
    }
  })
  root.walkAtRules('layer', at => {
    if (at.nodes) at.replaceWith(...at.nodes.map(node => node.clone()))
    else at.remove()
    issues.add('cascade-layers-flattened-for-reference')
  })
  if (options.inFlowEchelonHeader) {
    const layout = echelonFlowHeaderStyles(root.toString())
    if (layout.changed) {
      root.removeAll()
      root.append(postcss.parse(layout.css).nodes)
    }
    for (const issue of layout.issues) issues.add(issue)
  }
  root.walkRules(rule => {
    // Only selector-token positions, not class fragments, quoted attribute
    // values, declarations, or source prose. A local wrapper represents both
    // document roots; collapse the resulting immediate duplicate ancestor.
    const selector = rule.selector
      .replace(/(^|[\s>+~,(])(?:html|body|:root|:host)(?=$|[\s>+~,.#:\[)])/g, '$1.v1-reference-root')
      .replace(/\.v1-reference-root\s+\.v1-reference-root/g, '.v1-reference-root')
    if (selector !== rule.selector) issues.add('document-root-styles-scoped-to-reference')
    rule.selector = selector
  })
  const decoration = pageDecorationStyles(root.toString())
  if (decoration.changed) {
    root.removeAll()
    root.append(postcss.parse(decoration.css).nodes)
    issues.add('page-decoration-not-repeated-per-section')
  }
  root.append(postcss.parse('.v1-reference-root .reveal{opacity:1;transform:none;visibility:visible}').nodes)
  // details/summary provide the source FAQ interaction without executable
  // markup. Its closed/open styles must follow the browser-owned open state.
  root.walkRules(rule => {
    if (rule.selector.includes('.faq-item.is-open'))
      rule.selector = rule.selector.replace(/\.faq-item\.is-open/g, '.faq-item[open]')
  })
  root.append(
    postcss.parse(
      '.v1-reference-root details.faq-item>summary{list-style:none;cursor:pointer}.v1-reference-root details.faq-item>summary::-webkit-details-marker{display:none}.v1-reference-root details.faq-item[open]>.faq-answer{display:block;max-height:none;opacity:1;visibility:visible}.v1-reference-root details.faq-item>summary:focus-visible{outline:2px solid currentColor;outline-offset:4px}',
    ).nodes,
  )
  issues.add('animation-static-state')
  if (options.wrapHeroSubtitle) {
    root.append(
      postcss.parse('@media(max-width:767px){.v1-reference-root .hero h1 span{max-width:100%;overflow-wrap:anywhere}}')
        .nodes,
    )
    issues.add('hero-subtitle-wrap-for-mobile')
  }
  if (options.readableRegistrationStatus) {
    root.append(
      postcss.parse('.v1-reference-root .register-section .registration-status{color:var(--btn-fill,var(--red-deep))}')
        .nodes,
    )
    issues.add('registration-status-contrast-preserved')
  }
  return { css: root.toString(), issues: [...issues].sort() }
}
