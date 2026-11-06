import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { decodeHTML, decodeHTMLAttribute } from 'entities'
import {
  HNI_TABLEAU_EMBEDS,
  STRUCTURED_SCHEMA_VERSION,
  isStructuredAttribute,
  isStructuredAttributeValue,
  isStructuredTag,
  type StructuredDocument,
  type StructuredNode,
  type StructuredFieldDef,
  type SlotDef,
} from '@cms/schema'
import { compileStructuredSection, renderStructuredBody, safeUrl, tableauEmbedUrl } from '@cms/renderer'
import { attribute, parseHtml, type HtmlNode } from './html.ts'
import { digest } from './backup.ts'
import { referenceCssClosure } from './reference-css-closure.ts'
import { staticCompatibility, type StaticCompatibility } from './static-compatibility.ts'
import { inferredFieldLabel } from './field-labels.ts'

export type ProviderReference = StaticCompatibility & {
  structuredDoc: StructuredDocument
  values: Record<string, unknown>
  slots: SlotDef[]
  providerViews: string[]
  styleStats: { inputRules: number; retainedRules: number; sourceBytes: number; retainedBytes: number }
}

/**
 * Rebuild only source sections containing the exact two approved HNI embeds.
 * Surrounding element hierarchy, classes, inline typography, prose and links
 * remain in one section at its original identity/position. This is deliberately
 * not an iframe importer: anything outside this closed source contract falls
 * back to the ordinary explicitly inert reference path.
 */
export function providerReference(input: {
  slug: string
  html: string
  css: string
  inheritedIssues?: string[]
}): ProviderReference | null {
  if (!/<iframe\b/i.test(input.html)) return null
  const parsed = parseHtml(input.html)
  if (!parsed.ok) return null
  const fields: StructuredFieldDef[] = []
  const values: Record<string, unknown> = {}
  const inlineRules: string[] = []
  const classNames = new Map<string, string>()
  const views: string[] = []
  const issues = new Set(input.inheritedIssues ?? [])
  let refused = false
  const field = (key: string, type: 'text' | 'link', label: string, value: unknown): string => {
    const name = `provider-${digest(key).slice(0, 24)}`
    fields.push({ name, type, label: label.slice(0, 200) })
    values[name] = value
    return name
  }
  const mappedClasses = (value: string): string[] =>
    value
      .split(/\s+/)
      .filter(Boolean)
      .map(token => {
        if (isStructuredAttributeValue('class', token)) return token
        const mapped = `provider-class-${digest(token).slice(0, 16)}`
        classNames.set(token, mapped)
        issues.add('provider-wrapper-class-names-normalized')
        return mapped
      })
  const plain = (nodes: HtmlNode[]): string =>
    nodes
      .map(node => (node.kind === 'text' ? decodeHTML(node.text) : node.tag === 'svg' ? '' : plain(node.children)))
      .join('')
  function walk(nodes: HtmlNode[], path: string, parentLabel = 'Chart context'): StructuredNode[] {
    return nodes.flatMap((node, index): StructuredNode[] => {
      const key = `${path}/${index}`
      if (node.kind === 'text')
        return node.text.trim() ? [{ type: 'text', field: field(key, 'text', parentLabel, decodeHTML(node.text)) }] : []
      const block = attribute(node, 'data-block-id')
      const label = block ? inferredFieldLabel(block) : parentLabel
      if (node.tag === 'iframe') {
        const source = decodeHTMLAttribute(attribute(node, 'src') ?? '')
        const match = Object.values(HNI_TABLEAU_EMBEDS).find(item => tableauEmbedUrl(item) === source)
        if (!match || node.attributes.some(attr => /^on/i.test(attr.name) || attr.name === 'srcdoc')) {
          refused = true
          return []
        }
        views.push(match.view)
        return [{ ...match, title: decodeHTMLAttribute(attribute(node, 'title') ?? match.title) }]
      }
      if (node.tag === 'button' && (attribute(node, 'class') ?? '').split(/\s+/).includes('viz-fullscreen-btn')) {
        issues.add('source-fullscreen-control-replaced-by-governed-control')
        return []
      }
      if (node.tag === 'svg' && attribute(node, 'aria-hidden') === 'true') {
        issues.add('decorative-svg-omitted-from-provider-wrapper')
        return []
      }
      if (node.attributes.some(attr => /^on/i.test(attr.name) || attr.name === 'srcdoc')) {
        refused = true
        return []
      }
      if (node.tag === 'a') {
        const url = decodeHTMLAttribute(attribute(node, 'href') ?? '')
        if (url !== '#' && safeUrl(url) === '#') {
          refused = true
          return []
        }
        const text = plain(node.children)
        const classes = mappedClasses(attribute(node, 'class') ?? '')
        if (node.children.some(child => child.kind === 'element'))
          issues.add('provider-context-link-decoration-normalized')
        return [
          {
            type: 'link',
            field: field(key, 'link', `${label} · link`, { url, label: text }),
            ...(classes.length ? { staticAttributes: { class: classes } } : {}),
          },
        ]
      }
      if (!isStructuredTag(node.tag)) {
        refused = true
        return []
      }
      const attrs: Record<string, string> = {}
      for (const attr of node.attributes) {
        const value = decodeHTMLAttribute(attr.value)
        if (attr.name === 'style') {
          const className = `provider-style-${digest(key).slice(0, 16)}`
          attrs.class = [attrs.class ?? '', className].filter(Boolean).join(' ')
          inlineRules.push(`.${className}{${value}}`)
          issues.add('provider-inline-style-preserved-as-scoped-class')
        } else if (attr.name === 'class') {
          attrs.class = [attrs.class ?? '', ...mappedClasses(value)].filter(Boolean).join(' ')
        } else if (isStructuredAttribute(attr.name) && isStructuredAttributeValue(attr.name, value)) {
          attrs[attr.name] = attr.name === 'class' ? [attrs.class ?? '', value].filter(Boolean).join(' ') : value
        } else if (!attr.name.startsWith('data-')) {
          issues.add(`provider-wrapper-attribute-omitted-${attr.name}`)
        }
      }
      return [
        {
          type: 'element',
          tag: node.tag,
          ...(Object.keys(attrs).length ? { attributes: attrs } : {}),
          children: walk(node.children, key, label),
        },
      ]
    })
  }
  const nodes: StructuredNode[] = [
    { type: 'element', tag: 'div', attributes: { class: 'v1-reference-root' }, children: walk(parsed.nodes, 'root') },
  ]
  if (refused || views.length === 0) return null
  const structuredDoc: StructuredDocument = { schemaVersion: STRUCTURED_SCHEMA_VERSION, fields, nodes }
  const def = {
    definition_kind: 'structured',
    structured_schema_version: STRUCTURED_SCHEMA_VERSION,
    structured_doc: structuredDoc,
  }
  const sourceHtml = renderStructuredBody(def, values, { providerEmbeds: false })
  if (sourceHtml === null) return null
  const stylesheet = postcss.parse(input.css)
  stylesheet.walkRules(rule => {
    rule.selector = selectorParser(selectors => {
      selectors.walkClasses(node => {
        const mapped = classNames.get(node.value)
        if (mapped) node.value = mapped
      })
    }).processSync(rule.selector)
  })
  const { css: sourceCss, ...styleStats } = referenceCssClosure(
    sourceHtml,
    `${stylesheet.toString()}\n${inlineRules.join('\n')}`,
  )
  const compiled = compileStructuredSection({ slug: input.slug, document: structuredDoc, sourceCss })
  if (compiled.blocking.length) return null
  issues.add('governed-tableau-embed-integrated')
  issues.add('provider-consent-panel-and-responsive-frame-layout-review')
  issues.add('page-visual-parity-not-verified')
  const compatibility = staticCompatibility({
    slug: input.slug,
    html: sourceHtml,
    css: sourceCss,
    inheritedIssues: [...issues],
  })
  return {
    ...compatibility,
    structuredDoc,
    values,
    slots: fields.map(item => ({ id: item.name, kind: item.type, label: item.label, constraints: {} })),
    providerViews: views,
    styleStats,
  }
}
