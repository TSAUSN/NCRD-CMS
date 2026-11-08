import { mapCssResourceUrls, escapeAttribute } from '@cms/renderer'
import { parse, type DefaultTreeAdapterMap } from 'parse5'

export const CANVAS_TOKEN = /^[a-f0-9]{64}$/
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const RESOURCE = new RegExp(
  `^/(?:media/${UUID}/(?:original|thumbnail|card|wide)|assets/${UUID}|site-files/${UUID}/[a-f0-9]{64}/[^/?#]+)(?:[?#].*)?$`,
  'i',
)

/** A read-only ticket is scoped to known resource routes, never arbitrary URLs. */
export type CanvasResourceContext = { paths?: readonly string[]; basePath?: string }
export function canvasResourceUrl(url: string, token: string, context: CanvasResourceContext = {}): string {
  if (!CANVAS_TOKEN.test(token)) throw new Error('Invalid editing preview.')
  if (RESOURCE.test(url)) return `/__cms/read/${token}${url}`
  if (context.paths?.length) {
    try {
      const base = context.basePath?.startsWith('/') && !context.basePath.startsWith('//') ? context.basePath : '/'
      const parsed = new URL(url, new URL(base, 'https://canvas.invalid'))
      if (parsed.origin === 'https://canvas.invalid' && context.paths.includes(parsed.pathname))
        return `/__cms/read/${token}${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      /* Unknown source addresses remain unchanged and cannot be proxied. */
    }
  }
  return url
}
export function canvasStylesheet(css: string, token: string, context: CanvasResourceContext = {}): string {
  return mapCssResourceUrls(css, url => canvasResourceUrl(url, token, context))
}

/** Offset edits preserve original markup/classes/data attributes. Only private
 * resource addresses change; public HTML and reviewed JavaScript bytes do not.
 * A stylesheet gets private URL aliases after its original bytes are verified;
 * its original SRI applies to public delivery, not this derived preview sheet. */
export function canvasDocument(
  html: string,
  token: string,
  context: { parentOrigin: string; channel: string; expiresAt: string; paths?: string[]; path?: string },
  runtime: { head: string; body: string },
): string {
  const resources = { paths: context.paths, basePath: context.path ?? '/' }
  const tree = parse(html, { sourceCodeLocationInfo: true })
  const edits: { start: number; end: number; value: string }[] = []
  const change = (start: number, end: number, value: string) => edits.push({ start, end, value })
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node) {
      const attrs = node.attrs
      const location = node.sourceCodeLocation
      if (node.tagName === 'html' && location?.startTag)
        change(
          location.startTag.endOffset - 1,
          location.startTag.endOffset - 1,
          ` data-cms-parent-origin="${escapeAttribute(context.parentOrigin)}" data-cms-channel="${escapeAttribute(context.channel)}" data-cms-ticket="${token}" data-cms-expires="${escapeAttribute(context.expiresAt)}"${context.paths?.length ? ` data-cms-resource-paths="${escapeAttribute(JSON.stringify(context.paths))}" data-cms-page-path="${escapeAttribute(context.path ?? '/')}"` : ''}`,
        )
      if (node.tagName === 'head' && location?.startTag)
        change(location.startTag.endOffset, location.startTag.endOffset, runtime.head)
      if (node.tagName === 'body' && location?.endTag)
        change(location.endTag.startOffset, location.endTag.startOffset, runtime.body)
      for (const attr of attrs) {
        const range = location?.attrs?.[attr.name]
        if (!range) continue
        let value = attr.value
        if (['src', 'href', 'poster', 'data-src', 'data-url', 'data-background'].includes(attr.name))
          value = canvasResourceUrl(value, token, resources)
        if (attr.name === 'srcset')
          value = value.replace(
            /(^|,)(\s*)([^\s,]+)(?=\s|,|$)/g,
            (_all, comma, spaces, url) => comma + spaces + canvasResourceUrl(url, token, resources),
          )
        if (attr.name === 'style') value = canvasStylesheet(value, token, resources)
        const privateStyle =
          node.tagName === 'link' &&
          attrs.some(a => a.name === 'rel' && a.value === 'stylesheet') &&
          attrs.some(a => a.name === 'href' && canvasResourceUrl(a.value, token, resources) !== a.value)
        if (attr.name === 'integrity' && privateStyle) change(range.startOffset, range.endOffset, '')
        else if (value !== attr.value)
          change(range.startOffset, range.endOffset, `${attr.name}="${escapeAttribute(value)}"`)
      }
      if (node.tagName === 'style')
        for (const child of node.childNodes) {
          if (child.nodeName !== '#text' || !('value' in child) || !child.sourceCodeLocation) continue
          const value = canvasStylesheet(child.value, token, resources)
          if (value !== child.value)
            change(
              child.sourceCodeLocation.startOffset,
              child.sourceCodeLocation.endOffset,
              value.replaceAll('<', '\\3c '),
            )
        }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
  }
  walk(tree)
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.value + text.slice(edit.end), html)
}
