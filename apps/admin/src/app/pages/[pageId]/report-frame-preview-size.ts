import { PREVIEW_MESSAGE } from '@cms/renderer/preview-messages'
/** Size only the owned frame preview; never send content or read the parent. */
export function reportFramePreviewSize(doc: Document, view: Window, part: 'header' | 'footer' = 'footer') {
  const parentOrigin = doc.documentElement.getAttribute('data-cms-parent-origin'),
    channel = doc.documentElement.getAttribute('data-cms-channel'),
    element = doc.querySelector<HTMLElement>(
      part === 'footer' ? 'footer,[data-cms-frame="footer"],.footer' : 'header,[data-cms-frame="header"]',
    )
  if (!parentOrigin || !channel || !element || view.parent === view) return
  try {
    const origin = new URL(parentOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== parentOrigin) return
  } catch {
    return
  }
  const rect = element.getBoundingClientRect(),
    height = Math.ceil(
      part === 'header'
        ? rect.bottom + Math.max(0, parseFloat(view.getComputedStyle(element).marginBottom) || 0)
        : Math.max(element.scrollHeight, rect.height),
    )
  if (height > 0 && height <= 4096)
    view.parent.postMessage({ type: PREVIEW_MESSAGE.frameSize, channel, part, height }, parentOrigin)
}
