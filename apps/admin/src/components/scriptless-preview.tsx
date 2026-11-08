'use client'
import { useEffect, useState, type ComponentProps } from 'react'
import { SCRIPTLESS_PREVIEW_SANDBOX, scriptlessPreviewHtml } from '../lib/scriptless-preview.ts'

/** Authenticated images work; scripts, forms, popups and top navigation stay sandboxed. */
export function ScriptlessPreview({ srcDoc, ...props }: Omit<ComponentProps<'iframe'>, 'sandbox'>) {
  const [origin, setOrigin] = useState<string | null>(null)
  useEffect(() => setOrigin(window.location.origin), [])
  return (
    <iframe
      {...props}
      sandbox={SCRIPTLESS_PREVIEW_SANDBOX}
      srcDoc={srcDoc === undefined || origin === null ? undefined : scriptlessPreviewHtml(srcDoc, origin)}
    />
  )
}

/** Scroll a loaded scriptless page preview (same-origin srcDoc) so section
 * `index` starts at its top. Only the preview's own window moves; a dialog
 * containing it keeps its scroll position. */
export function revealPreviewSection(frame: HTMLIFrameElement, index: number | undefined): void {
  if (index === undefined) return
  const view = frame.contentWindow
  const section = frame.contentDocument?.getElementById(`s${index}`)
  if (view && section) view.scrollTo({ top: section.getBoundingClientRect().top + view.scrollY, behavior: 'instant' })
}
