import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
/** Read-only check in the site's own capability preview, without editor chrome. */
export async function reportPreviewFonts() {
  const root = document.documentElement
  const parentOrigin = root.getAttribute('data-cms-parent-origin')
  const channel = root.getAttribute('data-cms-channel')
  if (!parentOrigin || !channel || window.parent === window) return
  let destination: URL
  try {
    destination = new URL(parentOrigin)
  } catch {
    return
  }
  if (
    !['http:', 'https:'].includes(destination.protocol) ||
    destination.origin !== parentOrigin ||
    !document.querySelector('link[data-cms-adobe-kit="euh2hvn"]')
  )
    return
  let loaded = false
  try {
    loaded = await Promise.race([
      document.fonts.ready
        .then(() =>
          Promise.all(
            ['trajan-pro-3', 'proxima-nova', 'proxima-nova-condensed', 'proxima-nova-extra-condensed'].map(name =>
              document.fonts.load('16px "' + name + '"'),
            ),
          ),
        )
        .then(groups => groups.every(faces => faces.length > 0 && faces.every(face => face.status === 'loaded'))),
      new Promise<boolean>(resolve => window.setTimeout(() => resolve(false), 12000)),
    ])
  } catch {
    /* Failed fonts keep their declared local stand-ins. */
  }
  window.parent.postMessage(
    { type: PREVIEW_MESSAGE.fontStatus, channel, loaded, hostname: location.hostname, families: loaded ? 4 : 0 },
    parentOrigin,
  )
}
