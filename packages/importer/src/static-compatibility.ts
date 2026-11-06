// A preservation path for legacy layouts the typed node vocabulary cannot say.
// It keeps authored markup verbatim, has no editable interpolation, and always
// requires trusted-code review. It is a source-reference draft, never a claim
// about the saved V1 page's overrides or working JavaScript interactions.
import { compileSection, safeUrl, scopeCss, sectionScopeSelector } from '@cms/renderer'
import { attribute, parseHtml, type HtmlNode } from './html.ts'

export type StaticCompatibility = {
  slug: string
  sourceHtml: string
  sourceCss: string
  compiled: ReturnType<typeof compileSection> | null
  status: 'compatible-reference' | 'review-reference' | 'refused'
  issues: string[]
}

const ACTIVE_ELEMENTS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'link',
  'meta',
  'base',
  'foreignobject',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
])

/** Refuse active markup rather than strip a visitor-facing feature silently. */
export function staticCompatibility(input: {
  slug: string
  html: string
  css: string
  inheritedIssues?: string[]
}): StaticCompatibility {
  const issues = new Set(input.inheritedIssues ?? [])
  const parsed = parseHtml(input.html)
  let refused = false
  if (!parsed.ok) {
    issues.add('static-html-parser-refused')
    refused = true
  }
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const inertControl =
        ['button', 'input', 'select', 'textarea'].includes(node.tag) && attribute(node, 'disabled') !== undefined
      if (ACTIVE_ELEMENTS.has(node.tag) && !inertControl) {
        issues.add(`active-element-${node.tag}`)
        refused = true
      }
      for (const attr of node.attributes) {
        if (/^on/i.test(attr.name) || attr.name === 'srcdoc') {
          issues.add('active-attribute')
          refused = true
        }
        if (['href', 'src', 'xlink:href', 'action', 'formaction', 'poster'].includes(attr.name)) {
          if (attr.value !== '#' && safeUrl(attr.value) === '#') {
            issues.add('unsafe-static-url')
            refused = true
          }
          if (/^(?:\/|https?:)/i.test(attr.value)) issues.add('asset-and-link-review')
        }
        if (attr.name === 'srcset') issues.add('responsive-image-transfer-review')
        if (attr.name === 'style') {
          const checked = scopeCss(`.source{${attr.value}}`, '.source-reference')
          if (checked.blocking.length || checked.violations.length) {
            issues.add('unsafe-inline-style')
            refused = true
          }
        }
      }
      const css = attribute(node, 'class') ?? ''
      if (/\b(reveal|tab|accordion|mobile-menu)\b/.test(css)) issues.add('javascript-interaction-review')
      walk(node.children)
    }
  }
  if (parsed.ok) walk(parsed.nodes)
  const scope = sectionScopeSelector(input.slug)
  if (!scope) {
    issues.add('invalid-reference-slug')
    refused = true
  }
  let compiled: StaticCompatibility['compiled'] = null
  if (!refused && scope) {
    compiled = compileSection({ sourceHtml: input.html, sourceCss: input.css, slots: [], scopeSelector: scope })
    if (
      compiled.blocking.length ||
      compiled.ast.nodes.some(node => node.kind === 'slot') ||
      compiled.ast.nodes.map(node => (node.kind === 'html' ? node.value : '')).join('') !== input.html
    ) {
      issues.add('static-compiler-refused')
      refused = true
      compiled = null
    } else if (compiled.problems.length) issues.add('stylesheet-policy-review')
  }
  return {
    slug: input.slug,
    sourceHtml: input.html,
    sourceCss: input.css,
    compiled,
    status: refused ? 'refused' : issues.size ? 'review-reference' : 'compatible-reference',
    issues: [...issues].sort(),
  }
}
