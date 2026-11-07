// Root hydration snapshots the origin of the actual HTML document. Later
// RSC payloads can update its DOM marker, but cannot replace the browser's CSP.
let documentOrigin: string | null | undefined

export function captureCanvasDocumentOrigin() {
  if (documentOrigin === undefined) documentOrigin = document.documentElement.dataset.cmsCanvasOrigin || null
}

export function canvasDocumentOrigin() {
  // The root layout captures before page effects run. The direct read also
  // supports the document guard in isolation before the root has hydrated.
  return documentOrigin === undefined ? document.documentElement.dataset.cmsCanvasOrigin || null : documentOrigin
}
