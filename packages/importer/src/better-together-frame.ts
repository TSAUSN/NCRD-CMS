import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { NavTree, type SlotDef } from '@cms/schema'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
export type OriginalFrameTemplate = { sourceHtml: string; slots: SlotDef[]; values: Record<string, unknown> }
export type OriginalMarketingPage = { id: string; path: string }
const attribute = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value ?? ''
const hasClass = (node: Element, name: string) => attribute(node, 'class').split(/\s+/).includes(name)
function* elements(node: Node): Generator<Element> {
  if ('tagName' in node) yield node
  for (const child of 'childNodes' in node ? node.childNodes : []) yield* elements(child)
}
const text = (node: Node): string =>
  'value' in node ? node.value : 'childNodes' in node ? node.childNodes.map(text).join('') : ''
function words(node: Node, values: Record<string, unknown>): string {
  return text(node)
    .replace(/\{\{([a-z][a-z0-9_-]*)\}\}/g, (_, id: string) =>
      typeof values[id] === 'string' ? (values[id] as string) : '',
    )
    .trim()
}
function checkedHref(href: string, paths: Record<string, string>): string {
  const next = paths[href] ?? paths[href.replace(/^\//, '')] ?? href
  if (/[\u0000-\u0020\u007f]/.test(next)) throw new Error('Review the original link destination before converting it.')
  if (/^#[^\s\\<>]*$/.test(next) || /^\/(?!\/)[^\s\\<>]*$/.test(next) || /^(?:mailto|tel):[^\s\\<>]+$/i.test(next))
    return next
  try {
    const url = new URL(next)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !/[\s\\<>]/.test(next))
      return next
  } catch {}
  throw new Error('Review the original link destination before converting it.')
}
const token = (value: string) => /^\{\{([a-z][a-z0-9_-]*)\}\}$/.exec(value)?.[1]

/** Turns only existing href attributes into typed destinations. Every other
 * byte of the reviewed template stays in place; no URL is fetched. */
export function convertBetterTogetherLinks(
  input: OriginalFrameTemplate,
  paths: Record<string, string>,
  labels: Record<string, string> = {},
): OriginalFrameTemplate {
  const root = parseFragment(input.sourceHtml, { sourceCodeLocationInfo: true })
  const anchors = [...elements(root)].filter(
    node => node.tagName === 'a' && node.attrs.some(item => item.name === 'href'),
  )
  if (anchors.length > 20 || input.slots.some(slot => /^link-\d+$/.test(slot.id)))
    throw new Error('Review the original links rather than converting an existing conversion.')
  const values = structuredClone(input.values)
  const groups = new Map<string, SlotDef[]>()
  const changes: { start: number; end: number; value: string }[] = []
  const unplaced: SlotDef[] = []
  let previous: string | undefined
  anchors.forEach((anchor, index) => {
    const href = checkedHref(attribute(anchor, 'href'), paths)
    const id = 'link-' + index
    const location = anchor.sourceCodeLocation?.attrs?.href
    if (!location) throw new Error('The original link location is unavailable.')
    const textToken = token(text(anchor).trim())
    const image = [...elements(anchor)].find(node => node.tagName === 'img')
    const pictureToken = image ? token(attribute(image, 'src')) : undefined
    const icons = [...elements(anchor)]
    const social = icons.some(node => hasClass(node, 'fa-facebook-square') || hasClass(node, 'fa-facebook-f'))
      ? 'Facebook'
      : icons.some(node => hasClass(node, 'fa-linkedin') || hasClass(node, 'fa-linkedin-in'))
        ? 'LinkedIn'
        : icons.some(node => hasClass(node, 'fa-twitter'))
          ? 'Twitter'
          : null
    const name =
      social ??
      (hasClass(anchor, 'navbar-brand')
        ? 'Logo'
        : textToken
          ? (labels[textToken] ?? input.slots.find(slot => slot.id === textToken)?.label ?? 'Link').replace(
              / label$/,
              '',
            )
          : words(anchor, input.values))
    if (!name) throw new Error('Give the original icon link a name before converting it.')
    const slot: SlotDef = { id, kind: 'link', label: name + ' link', constraints: { destinationOnly: true } }
    values[id] = { url: href, label: words(anchor, input.values) || name }
    changes.push({ start: location.startOffset, end: location.endOffset, value: 'href="{{' + id + '}}"' })
    if (social && !attribute(anchor, 'aria-label')) {
      const at = anchor.sourceCodeLocation!.startOffset + 2 // after <a, without changing its existing attributes
      changes.push({ start: at, end: at, value: ' aria-label="' + social + '"' })
    }
    const group = textToken ?? pictureToken ?? previous
    if (group) {
      groups.set(group, [...(groups.get(group) ?? []), slot])
      previous = group
    } else unplaced.push(slot)
  })
  let sourceHtml = input.sourceHtml
  for (const change of changes.sort((a, b) => b.start - a.start))
    sourceHtml = sourceHtml.slice(0, change.start) + change.value + sourceHtml.slice(change.end)
  const slots = input.slots.flatMap(slot => [
    { ...slot, label: labels[slot.id] ?? slot.label },
    ...(groups.get(slot.id) ?? []),
  ])
  return { sourceHtml, slots: [...slots, ...unplaced], values }
}

/** Closed conversion of the reviewed five home anchors and More dropdown.
 * The existing NavTree owns labels/order/visibility after installation. */
export function convertBetterTogetherMenu(
  input: OriginalFrameTemplate,
  paths: Record<string, string>,
  pages: OriginalMarketingPage[],
): OriginalFrameTemplate & { menu: NavTree } {
  const root = parseFragment(input.sourceHtml, { sourceCodeLocationInfo: true })
  const menus = [...elements(root)].filter(node => node.tagName === 'ul' && hasClass(node, 'navbar-nav'))
  const menu = menus[0]
  const items = menu?.childNodes.filter((node): node is Element => 'tagName' in node && node.tagName === 'li') ?? []
  if (menus.length !== 1 || items.length !== 6 || !menu?.sourceCodeLocation)
    throw new Error('Review the changed original homepage menu before converting it.')
  const target = (anchor: Element): NavTree[number]['target'] => {
    const href = checkedHref(attribute(anchor, 'href'), paths)
    const page = pages.find(page => page.path === href)
    return page ? { type: 'page', page_id: page.id } : { type: 'url', url: href.startsWith('#') ? '/' + href : href }
  }
  const tree = items.map(item => {
    const anchor = item.childNodes.find((node): node is Element => 'tagName' in node && node.tagName === 'a')
    if (!anchor || !hasClass(anchor, 'nav-link')) throw new Error('Review the changed original menu item.')
    const dropdown = item.childNodes.find((node): node is Element => 'tagName' in node && node.tagName === 'ul')
    const children = dropdown
      ? [...elements(dropdown)]
          .filter(node => node.tagName === 'a')
          .map(child => {
            if (!hasClass(child, 'dropdown-item')) throw new Error('Review the changed original dropdown link.')
            return { label: words(child, input.values), visible: true, target: target(child) }
          })
      : undefined
    return {
      label: words(anchor, input.values),
      visible: true,
      target: children ? { type: 'url' as const, url: '/' } : target(anchor),
      ...(children ? { children } : {}),
    }
  })
  if (tree.filter(node => node.children).length !== 1 || tree.at(-1)?.children?.length !== 3)
    throw new Error('Review the changed original More menu.')
  const parsed = NavTree.parse(tree)
  const location = menu.sourceCodeLocation
  const sourceHtml =
    input.sourceHtml.slice(0, location.startOffset) + '{{menu}}' + input.sourceHtml.slice(location.endOffset)
  const used = new Set([...sourceHtml.matchAll(/\{\{([a-z][a-z0-9_-]*)\}\}/g)].map(match => match[1]!))
  const slots = input.slots.filter(slot => used.has(slot.id))
  const values = Object.fromEntries(Object.entries(input.values).filter(([id]) => used.has(id)))
  const converted = convertBetterTogetherLinks(
    {
      sourceHtml,
      slots: [
        ...slots,
        { id: 'menu', kind: 'navigation', label: 'Menu', constraints: { menuStyle: 'bt2027-bootstrap5' } },
      ],
      values,
    },
    paths,
  )
  return { ...converted, menu: parsed }
}

export const BETTER_TOGETHER_FOOTER_LABELS: Record<string, string> = {
  'text-0': 'Conference name',
  'text-1': 'Conference description',
  'text-2': 'Manifesto label',
  'text-3': 'Links heading',
  'text-4': 'National site label',
  'text-5': 'Central Territory label',
  'text-6': 'Eastern Territory label',
  'text-7': 'Southern Territory label',
  'text-8': 'Western Territory label',
  'text-9': 'Contact invitation',
  'text-10': 'Email button label',
  'text-11': 'Copyright label',
}
