import {
  type Element,
  type Node,
  children,
  type ParentNode,
  isElement,
  walk,
  remove,
  setAttr,
  attr,
  find,
  visibleText,
  replaceChildrenWithText,
  fragment,
} from './website-tree.ts'
import type { PageSource } from './website-page-source.ts'
import { SiteFiles, sha256, IMAGE_EXT } from './website-files.ts'
import { relative, extname } from 'node:path'
import { type NavTree } from '@cms/schema'

export const MENU_MARKER = 'cms-import-menu-slot'
export const REMOVE = new Set([
  'script',
  'noscript',
  'template',
  'link',
  'meta',
  'base',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'canvas',
  'form',
  'input',
  'select',
  'textarea',
  'dialog',
])
const KEEP_AS_TEXT = new Set(['button', 'label'])

/** Strip what published pages cannot carry and point local addresses at CMS copies. */
export function cleanTree(
  node: Element,
  page: PageSource,
  files: SiteFiles,
  routes: Map<string, string>,
  removed: Record<string, number>,
  inlineCss: string[],
  frame = false,
) {
  const count = (what: string) => {
    removed[what] = (removed[what] ?? 0) + 1
  }
  // Comments are invisible, and on real sites they often hold whole blocks of
  // retired markup, scripts included, that must not travel with the section.
  const uncomment = (parent: Node) => {
    const kids = children(parent)
    if (kids.some(kid => (kid as { nodeName: string }).nodeName === '#comment')) {
      ;(parent as ParentNode).childNodes = kids.filter(
        kid => (kid as { nodeName: string }).nodeName !== '#comment',
      ) as ParentNode['childNodes']
    }
    for (const kid of children(parent)) if (isElement(kid)) uncomment(kid)
  }
  uncomment(node)
  for (const el of [...walk({ childNodes: [node] } as unknown as Node)]) {
    if (REMOVE.has(el.tagName)) {
      count(el.tagName)
      remove(el)
      continue
    }
    // Style blocks are already part of the page's stylesheet (pageStylesheet).
    if (el.tagName === 'style') {
      remove(el)
      continue
    }
    if (KEEP_AS_TEXT.has(el.tagName)) {
      if (el.tagName === 'button') count('button (kept as text)')
      el.tagName = 'span'
      ;(el as { nodeName: string }).nodeName = 'span'
    }
    for (const a of [...el.attrs]) {
      if (/^on/i.test(a.name)) {
        count('event handler')
        setAttr(el, a.name, null)
      } else if (a.name === 'srcset' || a.name === 'sizes' || (a.name === 'loading' && el.tagName !== 'img'))
        setAttr(el, a.name, null)
      else if (a.name === 'style') {
        const className = `cms-s-${sha256(a.value).slice(0, 8)}`
        inlineCss.push(`.${className}{${a.value}}`)
        setAttr(el, 'style', null)
        setAttr(el, 'class', [attr(el, 'class'), className].filter(Boolean).join(' '))
      }
    }
    if (el.tagName === 'img') {
      const src = attr(el, 'src') ?? ''
      const path = files.resolve(src, page.file)
      if (path) setAttr(el, 'src', files.image(path, attr(el, 'alt') ?? '').url)
      else if (src) files.remote.add(src.slice(0, 160))
      if (attr(el, 'alt') === undefined) setAttr(el, 'alt', '')
    }
    if (el.tagName === 'a') {
      const href = attr(el, 'href') ?? ''
      const path = files.resolve(href, page.file)
      const hash = href.includes('#') ? href.slice(href.indexOf('#')) : ''
      if (frame && href.startsWith('#') && href.length > 1) setAttr(el, 'href', `/${page.path}${href}`)
      else if (path && routes.has(path)) setAttr(el, 'href', `/${routes.get(path)}${hash}`.replace(/^\/(#|$)/, '/$1'))
      else if (path && /\.(?:html?|php)$/i.test(path)) files.unimported.add(relative(files.root, path))
      else if (path && extname(path).toLowerCase() === '.pdf') setAttr(el, 'href', files.document(path).url)
      else if (path && IMAGE_EXT.has(extname(path).toLowerCase())) setAttr(el, 'href', files.image(path).url)
      setAttr(el, 'target', attr(el, 'target') === '_blank' ? '_blank' : null)
    }
  }
}

/** Bootstrap menus become a code-owned, scriptless disclosure and one governed
 * Navigation field. Preserve branding and desktop geometry, not inert toggles. */
export function adaptImportedMenu(
  node: Element,
  page: PageSource,
  files: SiteFiles,
  routes: Map<string, string>,
): { css: string; tree: NavTree } | null {
  const hasClass = (el: Element, name: string) => (attr(el, 'class') ?? '').split(/\s+/).includes(name)
  const toggle = find(node, el => el.tagName === 'button' && hasClass(el, 'navbar-toggler'))
  const panel = find(node, el => hasClass(el, 'navbar-collapse'))
  if (!toggle || !panel || !toggle.parentNode) return null
  const tree: NavTree = []
  for (const link of walk(panel)) {
    if (link.tagName !== 'a') continue
    const href = attr(link, 'href') ?? '',
      label = visibleText(link).trim().slice(0, 80)
    if (!label || !href || href === '#') continue
    const local = files.resolve(href, page.file)
    const hash = href.includes('#') ? href.slice(href.indexOf('#')) : ''
    const url = href.startsWith('#')
      ? `/${page.path}${href}`
      : local && routes.has(local)
        ? `/${routes.get(local)}${hash}`
        : href
    if (!url.startsWith('/') && !url.startsWith('https://')) continue
    tree.push({ label, target: { type: 'url', url }, visible: true })
  }
  if (!tree.length) return null
  replaceChildrenWithText(panel, `<span class="${MENU_MARKER}"></span>`)
  setAttr(panel, 'class', 'cms-import-desktop')
  setAttr(panel, 'id', null)
  const disclosure = fragment(
    `<details class="cms-import-menu"><summary aria-label="Menu">Menu</summary><nav aria-label="Mobile navigation"><span class="${MENU_MARKER}"></span></nav></details>`,
  ).childNodes[0]!
  const parent = toggle.parentNode
  parent.childNodes.splice(parent.childNodes.indexOf(toggle), 1, disclosure)
  ;(disclosure as { parentNode: ParentNode }).parentNode = parent
  return { css: importedMenuCss(), tree }
}

/** Shared by imports and versioned corrections to an earlier imported frame. */
export function importedMenuCss(): string {
  return [
    '.navbar{position:relative;top:auto;left:auto;right:auto}',
    '.navbar>.container{display:flex;align-items:center;justify-content:space-between}',
    '.cms-import-desktop{margin-left:auto}',
    '.cms-import-desktop .cms-nav-list{display:flex;align-items:center;gap:1.25rem;list-style:none;margin:0;padding:0}',
    '.cms-import-desktop .cms-nav-list a,.cms-import-menu a{font:inherit;color:inherit;text-decoration:none;font-weight:600}',
    '.cms-import-desktop .cms-nav-item{position:relative}',
    '.cms-import-desktop .cms-nav-submenu{display:none;position:absolute;top:100%;right:0;min-width:12rem;background:#fff;padding:1rem}',
    '.cms-import-desktop .cms-nav-item:hover>.cms-nav-submenu,.cms-import-desktop .cms-nav-item:focus-within>.cms-nav-submenu{display:block}',
    '.cms-import-menu{display:none;margin-left:auto}',
    '.cms-import-menu>summary{list-style:none;cursor:pointer;border:1px solid currentColor;border-radius:.5rem;padding:.5rem .75rem;font-weight:600}',
    '.cms-import-menu>summary::-webkit-details-marker{display:none}',
    '.cms-import-menu>nav{position:absolute;left:0;right:0;top:100%;background:#fff;color:#142238;padding:1rem;box-shadow:0 8px 16px #0002;z-index:10}',
    '.cms-import-menu .cms-nav-list{display:block;list-style:none;margin:0;padding:0}',
    '.cms-import-menu a{display:block;padding:.75rem .5rem}',
    '@media(max-width:991px){.cms-import-desktop{display:none}.cms-import-menu{display:block}}',
  ].join('\n')
}
