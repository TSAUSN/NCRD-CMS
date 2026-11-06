import { NavTree, NavUrl } from '@cms/schema'
import { escapeAttribute, escapeText, safeUrl } from './escape.ts'

/** BT2027's reviewed Bootstrap5 menu, using only the governed two-level tree.
 * No author-supplied markup, classes, events or script authority enter here. */
export function renderOriginalNavigation(
  tree: unknown,
  pathForPage: (id: string) => string | null,
  currentPath: string,
  instrument = false,
): string {
  const parsed = NavTree.safeParse(tree)
  if (!parsed.success) return ''
  const destination = (target: NavTree[number]['target']) => {
    const raw = target.type === 'url' ? target.url : pathForPage(target.page_id)
    if (!raw || !NavUrl.safeParse(raw).success) return null
    const href = safeUrl(raw)
    return currentPath === '/' && href.startsWith('/#') ? href.slice(1) : href
  }
  const annotation = (path: string) => (instrument ? ' data-cms-menu-path="' + escapeAttribute(path) + '"' : '')
  const items = parsed.data
    .flatMap((node, index) => {
      if (!node.visible) return []
      const path = String(index)
      if (node.children?.length) {
        const children = node.children
          .flatMap((child, at) => {
            const href = child.visible ? destination(child.target) : null
            return href
              ? [
                  '<li><a class="dropdown-item" href="' +
                    escapeAttribute(href) +
                    '"' +
                    annotation(path + '.' + at) +
                    '>' +
                    escapeText(child.label) +
                    '</a></li>',
                ]
              : []
          })
          .join('')
        // An empty group has no destination in this original design.
        return children
          ? [
              '<li class="nav-item dropdown"><a class="nav-link dropdown-toggle" href="#" data-bs-toggle="dropdown" aria-expanded="false"' +
                annotation(path) +
                '>' +
                escapeText(node.label) +
                '</a><ul class="dropdown-menu dropdown-menu-end">' +
                children +
                '</ul></li>',
            ]
          : []
      }
      const href = destination(node.target)
      return href
        ? [
            '<li class="nav-item"><a class="nav-link page-scroll" href="' +
              escapeAttribute(href) +
              '"' +
              annotation(path) +
              '>' +
              escapeText(node.label) +
              '</a></li>',
          ]
        : []
    })
    .join('')
  return '<ul class="navbar-nav ms-auto">' + items + '</ul>'
}
