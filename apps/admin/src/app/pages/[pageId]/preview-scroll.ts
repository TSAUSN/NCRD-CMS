const previewHeaders = new WeakMap<Document, Map<HTMLElement, string>>()
/** Reveal only inside the isolated document. Element.scrollIntoView can also
 * scroll the containing CMS window, clipping its navigation and controls. */
export function revealPreviewArea(doc: Document, view: Window, area: 'header' | 'footer') {
  if (area === 'header') {
    for (const [header, position] of previewHeaders.get(doc) ?? []) header.style.position = position
    previewHeaders.delete(doc)
    view.scrollTo({ top: 0, behavior: 'instant' })
    doc.body.scrollTo({ top: 0, behavior: 'instant' })
    return
  }
  const footer = doc.querySelector('footer,[data-cms-frame="footer"],.footer')
  if (!footer) return
  const headers = previewHeaders.get(doc) ?? new Map<HTMLElement, string>()
  for (const header of doc.querySelectorAll<HTMLElement>('header,[data-cms-frame="header"]')) {
    if (!headers.has(header)) headers.set(header, header.style.position)
    header.style.position = 'static'
  }
  previewHeaders.set(doc, headers)
  for (let parent = footer.parentElement; parent; parent = parent.parentElement) {
    if (/^(auto|scroll)$/.test(view.getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
      parent.scrollTo({
        top:
          parent.scrollTop + footer.getBoundingClientRect().top - parent.getBoundingClientRect().top - parent.clientTop,
        behavior: 'instant',
      })
    }
  }
  view.scrollTo({ top: view.scrollY + footer.getBoundingClientRect().top, behavior: 'instant' })
}
