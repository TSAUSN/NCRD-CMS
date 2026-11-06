import { it, expect, vi } from 'vitest'
import { revealPreviewArea } from './preview-scroll.ts'
it('scrolls an original body scroller without calling cross-frame scrollIntoView', () => {
  let top = 800
  const body = {
    parentElement: null,
    scrollHeight: 1200,
    clientHeight: 600,
    clientTop: 0,
    scrollTop: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    scrollTo: vi.fn(({ top: y }) => {
      top -= Math.min(y, 600)
    }),
  }
  const footer = {
      parentElement: body,
      getBoundingClientRect: () => ({ top }),
      scrollIntoView: vi.fn(() => {
        throw Error('Must not scroll the containing CMS')
      }),
    },
    doc = { body, querySelectorAll: () => [], querySelector: vi.fn(() => footer) },
    view = { scrollY: 0, scrollTo: vi.fn(), getComputedStyle: () => ({ overflowY: 'auto' }) }
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'footer')
  expect(body.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'instant' })
  expect(view.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'instant' })
  expect(footer.scrollIntoView).not.toHaveBeenCalled()
})
it('uses only the child window for a normal document and resets either scroll model for the header', () => {
  const body = { parentElement: null, scrollHeight: 1000, clientHeight: 1000, scrollTo: vi.fn() },
    footer = { parentElement: body, getBoundingClientRect: () => ({ top: 700 }) },
    doc = { body, querySelectorAll: () => [], querySelector: () => footer },
    view = { scrollY: 100, scrollTo: vi.fn(), getComputedStyle: () => ({ overflowY: 'visible' }) }
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'footer')
  expect(view.scrollTo).toHaveBeenCalledWith({ top: 800, behavior: 'instant' })
  expect(body.scrollTo).not.toHaveBeenCalled()
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'header')
  expect(view.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' })
  expect(body.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  view.scrollTo.mockClear()
  doc.querySelector = () => null as never
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'footer')
  expect(view.scrollTo).not.toHaveBeenCalled()
})

it('keeps a sticky header from covering the focused footer and restores it for header preview', () => {
  const header = { style: { position: 'sticky' } },
    body = { parentElement: null, scrollHeight: 1, clientHeight: 1, scrollTo: vi.fn() },
    footer = { parentElement: body, getBoundingClientRect: () => ({ top: 700 }) },
    doc = { body, querySelectorAll: () => [header], querySelector: () => footer },
    view = { scrollY: 0, scrollTo: vi.fn(), getComputedStyle: () => ({ overflowY: 'visible' }) }
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'footer')
  expect(header.style.position).toBe('static')
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'footer')
  revealPreviewArea(doc as unknown as Document, view as unknown as Window, 'header')
  expect(header.style.position).toBe('sticky')
})
