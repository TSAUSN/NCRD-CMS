import { type DefaultTreeAdapterMap, parseFragment } from 'parse5'

export type Node = DefaultTreeAdapterMap['node']
export type Element = DefaultTreeAdapterMap['element']
export type ParentNode = DefaultTreeAdapterMap['parentNode']

export const isElement = (node: Node): node is Element => 'tagName' in node
export const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value
export function setAttr(node: Element, name: string, value: string | null) {
  node.attrs = node.attrs.filter(a => a.name !== name)
  if (value !== null) node.attrs.push({ name, value })
}
export const children = (node: Node): Node[] => ('childNodes' in node ? (node as ParentNode).childNodes : []) as Node[]
export function* walk(node: Node): Generator<Element> {
  for (const child of children(node)) {
    if (!isElement(child)) continue
    yield child
    yield* walk(child)
  }
}
export const find = (node: Node, test: (el: Element) => boolean) => {
  for (const el of walk(node)) if (test(el)) return el
  return undefined
}
export const textOf = (node: Node): string =>
  'value' in node && (node as { nodeName: string }).nodeName === '#text'
    ? (node as { value: string }).value
    : children(node).map(textOf).join('')
/** The words a visitor sees: not the contents of styles, scripts or templates. */
export const visibleText = (node: Node): string =>
  'value' in node && (node as { nodeName: string }).nodeName === '#text'
    ? (node as { value: string }).value
    : isElement(node) && ['style', 'script', 'template', 'noscript'].includes(node.tagName)
      ? ''
      : children(node).map(visibleText).join('')
export function remove(node: Node) {
  const parent = (node as { parentNode?: ParentNode | null }).parentNode
  if (!parent) return
  parent.childNodes = parent.childNodes.filter(child => child !== node)
}
export function insideAny(node: Element, tags: string[]): boolean {
  let parent = node.parentNode as Element | null
  while (parent && isElement(parent as Node)) {
    if (tags.includes(parent.tagName)) return true
    parent = parent.parentNode as Element | null
  }
  return false
}
export const fragment = (html: string) => parseFragment(html)
export function replaceChildrenWithText(node: Element, text: string) {
  const replacement = fragment(text).childNodes as Node[]
  for (const child of replacement) (child as { parentNode: ParentNode }).parentNode = node as unknown as ParentNode
  node.childNodes = replacement as Element['childNodes']
}
