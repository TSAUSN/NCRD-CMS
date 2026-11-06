import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { SiteFileProjection, siteFileAddress, nativeAliasPaths } from '@cms/schema'

/** Remove only unavailable pictures, preserving every other authored byte.
 * A reviewed original bundle is the inventory of local imported addresses.
 * Governed media/asset routes are resolved by the database before rendering.
 */
export function withoutUnavailablePictures(html: string, projection: unknown, path = '/'): string {
  const parsed = SiteFileProjection.safeParse(projection)
  const files = parsed.success ? parsed.data : null
  const original = files?.bundle.original
  const known = new Set(
    files
      ? [
          ...(files.bundle.paths ?? []).map(mount => mount.path),
          ...files.files.map(siteFileAddress),
          ...(files.bundle.native ?? []).flatMap(nativeAliasPaths),
        ]
      : [],
  )
  const unavailable = (src: string) => {
    if (!src.trim()) return true
    if (!original || /^(?:https?:|data:|\/\/)/i.test(src)) return false
    try {
      const url = new URL(src, new URL(path, 'https://picture.invalid'))
      return (
        url.origin === 'https://picture.invalid' &&
        !/^\/(?:media|assets|cms-samples|__cms)\//.test(url.pathname) &&
        !known.has(url.pathname)
      )
    } catch {
      return true
    }
  }
  const edits: { start: number; end: number }[] = []
  const walk = (node: DefaultTreeAdapterMap['node']) => {
    if ('tagName' in node) {
      const location = node.sourceCodeLocation
      const src = node.attrs.find(attr => attr.name === 'src')?.value ?? ''
      if (node.tagName === 'img' && unavailable(src) && location) {
        edits.push({ start: location.startOffset, end: location.endOffset })
        return
      }
      if (node.tagName === 'img' || node.tagName === 'source') {
        const set = node.attrs.find(attr => attr.name === 'srcset')
        if (
          set &&
          !set.value.startsWith('data:') &&
          set.value.split(',').some(part => unavailable(part.trim().split(/\s+/)[0] ?? ''))
        ) {
          const attr = location?.attrs?.srcset
          if (attr) edits.push({ start: attr.startOffset, end: attr.endOffset })
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child)
  }
  walk(parseFragment(html, { sourceCodeLocationInfo: true }))
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + text.slice(edit.end), html)
}
