import { SiteFileProjection, siteFileAddress, nativeAliasPaths } from '@cms/schema'
import { safeUrl } from '@cms/renderer'

/** Only reviewed image addresses become authenticated admin URLs. Stored
 * values and public addresses stay unchanged. */
export function siteImagePreviews(projection: unknown): Record<string, string> {
  const parsed = SiteFileProjection.safeParse(projection)
  if (!parsed.success) return {}
  const { bundle, files } = parsed.data,
    byId = new Map(files.map(file => [file.id, file]))
  if (byId.size !== files.length || bundle.files.length !== files.length || bundle.files.some(id => !byId.has(id)))
    return {}
  const entries = (bundle.paths ?? []).flatMap(mount => {
    const file = byId.get(mount.fileId)
    return file?.kind === 'image' ? [[mount.path, siteFileAddress(file)]] : []
  })
  for (const alias of bundle.native ?? [])
    if (alias.kind === 'media')
      for (const path of nativeAliasPaths(alias))
        entries.push([path, path.replace('/media/' + alias.sourceId + '/', '/media/' + alias.mediaId + '/')])
  return Object.fromEntries(entries)
}

export function picturePreviewUrl(src: string, previews: Record<string, string>, original = false): string | null {
  if (Object.hasOwn(previews, src)) return previews[src]!
  if (original && src.startsWith('/') && !/^\/(?:media|assets|cms-samples)\//.test(src)) return null
  return safeUrl(src)
}
