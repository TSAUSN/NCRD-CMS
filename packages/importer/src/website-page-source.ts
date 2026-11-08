import {
  type Node,
  type Element,
  attr,
  visibleText,
  find,
  children,
  isElement,
  textOf,
  walk,
  insideAny,
} from './website-tree.ts'
import { relative, basename } from 'node:path'
import { defaultTreeAdapter, html, parse } from 'parse5'
import { readFileSync } from 'node:fs'
import { REMOVE } from './website-page-cleanup.ts'

export type PageSource = {
  file: string
  path: string
  title: string
  description: string
  document: Node
  header?: Element
  footer?: Element
  sections: Element[]
  skipped: Record<string, number>
}

function pagePath(file: string, root: string): string {
  const rel = relative(root, file)
    .replace(/\\/g, '/')
    .replace(/\.html?$/i, '')
  const parts = rel.split('/').filter(part => part && part !== 'index')
  return parts
    .map(
      part =>
        part
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'page',
    )
    .join('/')
}

const SKIP_TOP = new Set(['script', 'noscript', 'style', 'template', 'link', 'meta', 'base'])
const FOOTER_LIKE = /(^|[\s_-])(footer|copyright|site-footer|colophon)([\s_-]|$)/i
const classAndId = (el: Element) => `${attr(el, 'class') ?? ''} ${attr(el, 'id') ?? ''}`
const isFooterLike = (el: Element) =>
  el.tagName === 'footer' || FOOTER_LIKE.test(classAndId(el)) || attr(el, 'role') === 'contentinfo'
/** Nothing a visitor would see: no words and no pictures (a parser-repaired stray <p><strong>). */
const isEmptyBlock = (el: Element) =>
  !visibleText(el).trim() &&
  !find(el, inner => ['img', 'svg', 'picture', 'video', 'iframe', 'canvas'].includes(inner.tagName))
/** A pop-up (Bootstrap modal, dialog) is behaviour, not a section of the page. */
const isPopup = (el: Element) =>
  el.tagName === 'dialog' || attr(el, 'role') === 'dialog' || /(^|\s)modal(\s|$)/.test(attr(el, 'class') ?? '')
const significant = (node: Node): Element[] =>
  children(node).filter((child): child is Element => isElement(child) && !SKIP_TOP.has(child.tagName))

/**
 * The page's top-level blocks: the children of <main> when there is one,
 * otherwise of <body>, looking through wrapper elements that hold everything
 * (`<div id="page">`).
 */
function topLevel(body: Element): { container: Element; blocks: Element[] } {
  const main = find(body, el => el.tagName === 'main')
  if (main) return { container: main, blocks: significant(main) }
  let container = body
  for (let depth = 0; depth < 4; depth += 1) {
    const blocks = significant(container)
    if (blocks.length !== 1 || !['div', 'section', 'article'].includes(blocks[0]!.tagName) || isFooterLike(blocks[0]!))
      break
    container = blocks[0]!
  }
  return { container, blocks: significant(container) }
}

/** Several footer blocks in a row (footer, then a copyright strip) are one site footer. */
function wrapFooter(blocks: Element[]): Element {
  if (blocks.length === 1) return blocks[0]!
  const wrapper = defaultTreeAdapter.createElement('div', html.NS.HTML, [
    { name: 'class', value: 'cms-imported-footer' },
  ]) as Element
  for (const block of blocks) {
    defaultTreeAdapter.detachNode(block)
    defaultTreeAdapter.appendChild(wrapper, block)
  }
  return wrapper
}

export function readPage(file: string, root: string): PageSource {
  const document = parse(readFileSync(file, 'utf8'))
  const head = find(document, el => el.tagName === 'head')
  const body = (find(document, el => el.tagName === 'body') ?? document) as Element
  const title = textOf(find(head ?? document, el => el.tagName === 'title') ?? document)
    .trim()
    .slice(0, 200)
  const description =
    attr(
      find(head ?? document, el => el.tagName === 'meta' && attr(el, 'name') === 'description') ??
        ({ attrs: [] } as unknown as Element),
      'content',
    ) ?? ''
  const skipped: Record<string, number> = {}
  const { blocks } = topLevel(body)
  const taggedSections = [...walk(body)].filter(el => attr(el, 'data-cms-section') !== undefined)

  // The site header: a tagged one; else a <header> holding the menu; else a
  // menu bar placed straight in the page (Bootstrap's navbar), in which case a
  // <header> without a menu is the page's hero, an ordinary section; else the
  // first <header>.
  const header =
    find(body, el => attr(el, 'data-cms-frame') === 'header') ??
    blocks.find(
      el =>
        (el.tagName === 'header' || attr(el, 'role') === 'banner') &&
        find(el, inner => inner.tagName === 'nav') !== undefined,
    ) ??
    blocks.find(el => el.tagName === 'nav') ??
    find(body, el => el.tagName === 'nav' && !insideAny(el, ['main', 'article', 'section', 'footer'])) ??
    blocks.find(el => el.tagName === 'header') ??
    find(body, el => el.tagName === 'header' && !insideAny(el, ['main', 'article', 'section']))

  // The site footer: a tagged one; else the run of footer-like blocks the page ends with.
  let footer = find(body, el => attr(el, 'data-cms-frame') === 'footer')
  if (!footer) {
    const content = blocks.filter(el => !isPopup(el))
    let start = content.length
    while (start > 0 && (isFooterLike(content[start - 1]!) || isEmptyBlock(content[start - 1]!))) start -= 1
    const run = content.slice(start).filter(el => !isEmptyBlock(el))
    if (run.some(isFooterLike)) footer = wrapFooter(run)
    else footer = find(body, el => el.tagName === 'footer' && !insideAny(el, ['main', 'article', 'section']))
  }

  const sections = taggedSections.length
    ? taggedSections
    : blocks.filter(el => {
        if (
          el === header ||
          el === footer ||
          (footer && walkContains(footer, el)) ||
          (header && walkContains(el, header))
        )
          return false
        if (isPopup(el)) {
          skipped['pop-up dialog'] = (skipped['pop-up dialog'] ?? 0) + 1
          return false
        }
        if (REMOVE.has(el.tagName)) {
          skipped[el.tagName] = (skipped[el.tagName] ?? 0) + 1
          return false
        }
        // Stray empty elements (an unclosed <p><strong> repaired by the parser) are not sections.
        if (isEmptyBlock(el)) {
          skipped['empty element'] = (skipped['empty element'] ?? 0) + 1
          return false
        }
        return true
      })
  return {
    file,
    path: pagePath(file, root),
    title: title || basename(file),
    description: description.slice(0, 300),
    document,
    header,
    footer,
    sections,
    skipped,
  }
}
function walkContains(node: Element, target: Element): boolean {
  for (const el of walk(node)) if (el === target) return true
  return false
}
