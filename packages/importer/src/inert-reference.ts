import { safeUrl } from '@cms/renderer'
import postcss from 'postcss'
import { attribute, parseHtml, type HtmlElement, type HtmlNode } from './html.ts'
import { serializeLegacy } from './legacy-values.ts'

const FAQ_FILTER_PARTS: [string, string][] = [
  ['faq-search', 'data-cms-faq-filter'],
  ['faq-no-results', 'data-cms-faq-empty'],
  ['faq-clear-filter', 'data-cms-faq-clear'],
]

/** Mark V1's FAQ search box, its “no questions match” line and its “clear the
 * filter” button for the renderer's code-owned filter (D3). The box stays
 * disabled in the markup: only the governed runtime enables it. */
function faqFilterMarker(node: HtmlElement): boolean {
  const id = attribute(node, 'id') ?? ''
  const part = FAQ_FILTER_PARTS.find(([name]) => id === name || id.endsWith(`--${name}`))
  if (!part || (part[0] === 'faq-search' && node.tag !== 'input')) return false
  if (attribute(node, part[1]) === undefined) node.attributes.push({ name: part[1], value: '' })
  return true
}

/** Mark an earlier import's FAQ search for the governed filter (D3). */
export function markFaqFilter(html: string): { html: string; marked: number } {
  const parsed = parseHtml(html)
  if (!parsed.ok) return { html, marked: 0 }
  let marked = 0
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      const before = node.attributes.length
      if (faqFilterMarker(node) && node.attributes.length > before) marked += 1
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return { html: marked ? serializeLegacy(parsed.nodes) : html, marked }
}

/** How a site's V1 script opened its FAQ on load. HNI's `openFirstFaqItem`
 * opens the first question; Echelon's accordion keeps every question closed. */
export type DisclosureOptions = { openFirst?: boolean }

/** Visible source content without running its native scripts. Every changed
 * interaction is recorded; untouched source bytes remain in the journal. */
export function inertReference(html: string, options: DisclosureOptions = {}): { html: string; issues: string[] } {
  const parsed = parseHtml(html)
  if (!parsed.ok) return { html, issues: ['inert-reference-parser-refused'] }
  const issues = new Set<string>()
  let firstDisclosure = options.openFirst === true
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') continue
      const classNames = (attribute(node, 'class') ?? '').split(/\s+/)
      if (classNames.includes('faq-item') && disclosure(node, firstDisclosure)) {
        firstDisclosure = false
        issues.add('native-disclosure-restored')
      }
      // Source scroll buttons have a complete, scriptless equivalent. Only
      // local fragment destinations are recognized; no click handler is run.
      if (node.tag === 'button' && /^#[a-zA-Z][\w:.-]*$/.test(attribute(node, 'data-scroll-target') ?? '')) {
        const destination = attribute(node, 'data-scroll-target')!
        node.tag = 'a'
        node.attributes = node.attributes.filter(
          attr => !['type', 'disabled', 'data-scroll-target'].includes(attr.name),
        )
        node.attributes.push({ name: 'href', value: destination }, { name: 'data-editable', value: 'link' })
        issues.add('native-scroll-link-restored')
      }
      for (const attr of node.attributes)
        if (attr.name === 'data-cms-section') {
          // V2 uses this exact name for numeric editor selection indices.
          // Preserve V1's marker under its own namespace instead of shadowing
          // the nearest V2 section wrapper and producing a NaN selection.
          attr.name = 'data-v1-cms-section'
          issues.add('editor-marker-namespaced')
        }
      // V1 uses HTML's empty alt as explicit decorative intent; V2's renderer
      // and readiness policy represent that same intent with presentation role.
      if (node.tag === 'img' && attribute(node, 'alt') === '' && attribute(node, 'role') === undefined) {
        node.attributes.push({ name: 'role', value: 'presentation' })
        issues.add('decorative-image-intent-preserved')
      }
      if (node.tag === 'iframe') {
        const title = attribute(node, 'title') ?? 'Embedded content'
        const url = safeUrl(attribute(node, 'src') ?? '')
        node.tag = 'div'
        node.attributes = [
          { name: 'class', value: 'v1-embedded-reference' },
          { name: 'role', value: 'note' },
        ]
        const text = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const label =
          url !== '#' && /^https:\/\//.test(url)
            ? `<a href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" rel="noopener noreferrer">${text}</a>`
            : `<p>${text}</p>`
        const replacement = parseHtml(`<p>Embedded view requires migration review.</p>${label}`)
        node.children = replacement.ok ? replacement.nodes : []
        issues.add('embedded-view-needs-integration')
      } else if (node.tag === 'form') {
        node.tag = 'div'
        node.attributes = node.attributes.filter(
          a => !['action', 'method', 'target', 'enctype', 'novalidate', 'role'].includes(a.name),
        )
        node.attributes.push({ name: 'role', value: 'group' })
        issues.add('form-submission-disabled-for-review')
      } else if (['button', 'input', 'select', 'textarea'].includes(node.tag)) {
        node.attributes = node.attributes.filter(
          a => !['form', 'formaction', 'formtarget', 'disabled'].includes(a.name),
        )
        node.attributes.push({ name: 'disabled', value: '' })
        issues.add('interactive-controls-disabled-for-review')
        if (node.tag === 'textarea') issues.add('textarea-default-retained-in-source')
      }
      if (faqFilterMarker(node)) issues.add('faq-search-governed-filter')
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return { html: serializeLegacy(parsed.nodes), issues: [...issues].sort() }
}

/**
 * A V1 FAQ item as a native disclosure: V1 toggled `.faq-answer[hidden]` from
 * its `.faq-btn` with a script and opened the first question on load. V2's
 * public pages run no source scripts, so the item becomes `<details>` with the
 * button as its `<summary>`, the answer no longer hidden (the disclosure shows
 * and hides it), and the first one open, as V1 showed it. Works on V1's own
 * markup and on an earlier import's disabled copy of it.
 */
function disclosure(node: HtmlElement, first: boolean): boolean {
  const answer = node.children.find(
    (child): child is HtmlElement =>
      child.kind === 'element' && (attribute(child, 'class') ?? '').split(/\s+/).includes('faq-answer'),
  )
  const button = node.children.find(
    (child): child is HtmlElement =>
      child.kind === 'element' &&
      child.tag === 'button' &&
      (attribute(child, 'class') ?? '').split(/\s+/).includes('faq-btn'),
  )
  if (!answer || !button) return false
  const classNames = (attribute(node, 'class') ?? '').split(/\s+/).filter(Boolean)
  node.tag = 'details'
  node.attributes = node.attributes.filter(attr => !['class', 'open'].includes(attr.name))
  node.attributes.push({ name: 'class', value: classNames.filter(name => name !== 'is-open').join(' ') })
  if (first) node.attributes.push({ name: 'open', value: '' })
  button.tag = 'summary'
  button.attributes = button.attributes.filter(
    attr => !['aria-expanded', 'type', 'disabled', 'aria-controls'].includes(attr.name),
  )
  answer.attributes = answer.attributes.filter(attr => !['aria-hidden', 'inert', 'hidden'].includes(attr.name))
  return true
}

/** Restore native FAQ disclosures in markup an earlier import left disabled
 * (FID-04) or opened throughout (FID-05). The open state follows the site's
 * V1 script, never the stored `aria-expanded`, which an earlier import set. */
export function restoreNativeDisclosures(
  html: string,
  options: DisclosureOptions = {},
): { html: string; restored: number } {
  const parsed = parseHtml(html)
  if (!parsed.ok) return { html, restored: 0 }
  let restored = 0
  const walk = (nodes: HtmlNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'element') continue
      if (
        (attribute(node, 'class') ?? '').split(/\s+/).includes('faq-item') &&
        disclosure(node, options.openFirst === true && restored === 0)
      )
        restored += 1
      walk(node.children)
    }
  }
  walk(parsed.nodes)
  return { html: restored ? serializeLegacy(parsed.nodes) : html, restored }
}

/**
 * V1's open-question styles for a native disclosure: each rule for
 * `.faq-btn[aria-expanded="true"]` also applies to the summary of an open
 * `<details>`, and the summary's own disclosure marker is hidden, as V1's
 * button had none.
 */
export function disclosureCss(css: string): string {
  let extra = ''
  try {
    postcss.parse(css).walkRules(rule => {
      if (!rule.selector.includes('.faq-btn[aria-expanded="true"]')) return
      const selector = rule.selectors
        .filter(part => part.includes('.faq-btn[aria-expanded="true"]'))
        .map(part => part.replaceAll('.faq-btn[aria-expanded="true"]', 'details[open] > .faq-btn'))
        .join(',')
      extra += `${selector}{${rule.nodes.map(node => node.toString()).join(';')}}`
    })
  } catch {
    return ''
  }
  return extra ? `summary.faq-btn{list-style:none}summary.faq-btn::-webkit-details-marker{display:none}${extra}` : ''
}
