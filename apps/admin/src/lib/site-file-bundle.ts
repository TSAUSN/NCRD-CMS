import { SiteFileBundle, type SiteFileView } from '@cms/schema'
/** Replacement retains the reviewed position, order and chosen pages. */
export function addReviewedFile(bundle: SiteFileBundle, file: SiteFileView, previousId?: string): SiteFileBundle {
  if (previousId && !bundle.files.includes(previousId))
    throw new Error('The file selected for replacement is no longer in this list.')
  if (
    previousId &&
    ((bundle.scripts.some(item => item.fileId === previousId) && file.kind !== 'script') ||
      (bundle.styles.some(item => item.fileId === previousId) && file.kind !== 'stylesheet'))
  )
    throw new Error('Replace a script with a script, or a stylesheet with a stylesheet.')
  const next = structuredClone(bundle)
  next.files = [
    ...new Set(previousId ? next.files.map(id => (id === previousId ? file.id : id)) : [...next.files, file.id]),
  ]
  if (previousId && next.paths) {
    const immutable = next.paths.some(path => path.fileId === previousId && path.path.startsWith('/site-files/'))
    if (immutable && !next.files.includes(previousId)) next.files.push(previousId)
    next.paths = next.paths.map(path =>
      path.fileId === previousId && !path.path.startsWith('/site-files/') ? { ...path, fileId: file.id } : path,
    )
  }
  if (previousId) {
    next.scripts = next.scripts.map(item => ({ ...item, fileId: item.fileId === previousId ? file.id : item.fileId }))
    next.styles = next.styles.map(item => ({ ...item, fileId: item.fileId === previousId ? file.id : item.fileId }))
  }
  if (file.kind === 'script' && !next.scripts.some(item => item.fileId === file.id))
    next.scripts.push({ fileId: file.id, position: 'body-end', loading: 'normal', pages: [] })
  if (file.kind === 'stylesheet' && !next.styles.some(item => item.fileId === file.id))
    next.styles.push({ fileId: file.id, pages: [] })
  return SiteFileBundle.parse(next)
}
export function removeReviewedFile(bundle: SiteFileBundle, id: string): SiteFileBundle {
  return {
    ...bundle,
    files: bundle.files.filter(file => file !== id),
    scripts: bundle.scripts.filter(item => item.fileId !== id),
    styles: bundle.styles.filter(item => item.fileId !== id),
    ...(bundle.paths ? { paths: bundle.paths.filter(path => path.fileId !== id) } : {}),
  }
}

/** Removing original framing also removes its future-page opt-ins. Existing
 * explicit page bindings and immutable prior choices remain unchanged. */
export function removeOriginalLayouts(bundle: SiteFileBundle): SiteFileBundle {
  const next = structuredClone(bundle)
  delete next.original
  next.scripts = next.scripts.map(({ newPages, ...binding }) => binding)
  next.styles = next.styles.map(({ newPages, ...binding }) => binding)
  return SiteFileBundle.parse(next)
}

export function describeFileLoading(
  bundle: SiteFileBundle,
  fileId: string,
  pages: { id: string; title: string }[],
): string {
  const pageNames = (ids: string[]) =>
    ids.length ? ids.map(id => pages.find(page => page.id === id)?.title ?? 'Unavailable page').join(', ') : 'all pages'
  const positions = { head: 'In the page head', 'body-start': 'Before page content', 'body-end': 'After page content' }
  const loading = { normal: 'in order', defer: 'after the HTML is ready', async: 'as soon as downloaded' }
  const scripts = bundle.scripts
    .filter(item => item.fileId === fileId)
    .map(
      item =>
        `${positions[item.position]} · ${loading[item.loading]} · ${pageNames(item.pages)}${item.newPages ? ' · also new pages using the reviewed original layout' : ''}`,
    )
  const styles = bundle.styles
    .filter(item => item.fileId === fileId)
    .map(
      item =>
        `Stylesheet in page head · ${pageNames(item.pages)}${item.newPages ? ' · also new pages using the reviewed original layout' : ''}`,
    )
  return [...scripts, ...styles].join('; ') || 'Available site asset'
}
/** Only move among files sharing the actual execution position. Moving a head
 * script around a footer script would change the form without changing output. */
export function fileMoveTarget(
  bundle: SiteFileBundle,
  type: 'scripts' | 'styles',
  index: number,
  direction: -1 | 1,
): number {
  for (let at = index + direction; at >= 0 && at < bundle[type].length; at += direction)
    if (type === 'styles' || bundle.scripts[at]!.position === bundle.scripts[index]!.position) return at
  return -1
}
