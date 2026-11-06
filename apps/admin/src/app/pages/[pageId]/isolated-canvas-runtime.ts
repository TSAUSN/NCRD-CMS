import { isCommandSearchKey } from '../../../lib/command-search-model.ts'
import { installCanvasRichText } from './isolated-canvas-rich-text.ts'
import { installCanvasControls } from './isolated-canvas-controls.tsx'
// The shared PREVIEW_RUNTIME is prepended by the build. Direct editing and
// bounded remote geometry/rich-text messages are added here, never in public output.
const parentOrigin = document.documentElement.getAttribute('data-cms-parent-origin')
const channel = document.documentElement.getAttribute('data-cms-channel')
const clock = (
  window as Window & {
    __cmsCanvasClock?: {
      finishSiteInitialization(): void
      pause(value: boolean): void
      timeout: typeof window.setTimeout
    }
  }
).__cmsCanvasClock
if (parentOrigin && channel && window.parent !== window) {
  const documentId = document.documentElement.getAttribute('data-cms-document')!
  const send = (type: string, detail: Record<string, unknown>) =>
    window.parent.postMessage({ type, ...detail, channel, documentId }, parentOrigin)
  const peer = {
    origin: parentOrigin,
    channel,
    documentId,
    post: send,
    timeout: clock?.timeout ?? window.setTimeout.bind(window),
  }
  installCanvasControls(peer)
  installCanvasRichText(peer)
  document.addEventListener(
    'keydown',
    event => {
      if (isCommandSearchKey(event)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        send('cms:command-search', {})
      } else if (event.key === 'Escape') send('cms:exit-focus', {})
    },
    true,
  )
  window.addEventListener('message', event => {
    if (event.origin !== parentOrigin || event.source !== window.parent || event.data?.channel !== channel) return
    if (event.data.type !== 'cms:request-isolated-ready' && event.data.documentId !== documentId) return
    if (event.data.type === 'cms:set-frame-editing') send('cms:frame-editing', { part: event.data.part })
    if (event.data.type === 'cms:set-selection' && event.data.section === null) clock?.pause(false)
    if (event.data.type === 'cms:request-isolated-ready')
      send('cms:isolated-ready', {
        token: document.documentElement.getAttribute('data-cms-ticket'),
        expiresAt: document.documentElement.getAttribute('data-cms-expires'),
      })
  })
  send('cms:isolated-ready', {
    token: document.documentElement.getAttribute('data-cms-ticket'),
    expiresAt: document.documentElement.getAttribute('data-cms-expires'),
  })
}
export {}
