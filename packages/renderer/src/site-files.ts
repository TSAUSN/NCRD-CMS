import { siteFileLoadingAddress, SiteFileProjection, type SiteFileView } from '@cms/schema'
import { escapeAttribute } from './escape.ts'

export { siteFileAddress } from '@cms/schema'
export function siteFileIntegrity(sha256: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid reviewed file hash.')
  return 'sha256-' + btoa(String.fromCharCode(...sha256.match(/../g)!.map(pair => Number.parseInt(pair, 16))))
}
/** The shell carries only reviewed metadata. Unknown shapes fail closed;
 * page filters and file types are rechecked at the rendering boundary. */
export function renderSiteFiles(projection: unknown, pageId: string, scriptsEnabled = true) {
  const parsed = SiteFileProjection.safeParse(projection)
  const empty = { head: '', bodyStart: '', bodyEnd: '', scriptHashes: [] as string[], hasStyles: false }
  if (!parsed.success) return empty
  const { bundle, files } = parsed.data,
    byId = new Map(files.map(file => [file.id, file]))
  if (
    bundle.files.some(id => !byId.has(id)) ||
    files.some(file => !bundle.files.includes(file.id)) ||
    byId.size !== files.length
  )
    return empty
  const newPage =
    Boolean(bundle.original?.newPages) &&
    !bundle.original?.pages.some(page => page.pageId.toLowerCase() === pageId.toLowerCase())
  const applies = (item: { pages: string[]; newPages?: boolean }) =>
    item.pages.length === 0 ||
    item.pages.some(id => id.toLowerCase() === pageId.toLowerCase()) ||
    (newPage && item.newPages === true)
  const attributes = (file: SiteFileView) =>
    `src="${escapeAttribute(siteFileLoadingAddress(bundle, file))}" integrity="${siteFileIntegrity(file.sha256)}"`
  const styles = bundle.styles.filter(applies).flatMap(item => {
    const file = byId.get(item.fileId)
    return file?.kind === 'stylesheet'
      ? [
          `<link rel="stylesheet" href="${escapeAttribute(siteFileLoadingAddress(bundle, file))}" integrity="${siteFileIntegrity(file.sha256)}">`,
        ]
      : []
  })
  const result = { ...empty, head: styles.join(''), hasStyles: styles.length > 0 }
  if (!scriptsEnabled) return result
  for (const item of bundle.scripts) {
    if (!applies(item)) continue
    const file = byId.get(item.fileId)
    if (file?.kind !== 'script') continue
    const tag = `<script ${attributes(file)}${item.loading === 'normal' ? '' : ` ${item.loading}`}></script>`
    result.scriptHashes.push(siteFileIntegrity(file.sha256))
    if (item.position === 'head') result.head += tag
    else if (item.position === 'body-start') result.bodyStart += tag
    else result.bodyEnd += tag
  }
  return result
}
