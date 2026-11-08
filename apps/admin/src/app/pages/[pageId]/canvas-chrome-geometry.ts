import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { parseRepeatItemSlotId, repeatItemKeys, repeatItemSpec, type FieldLike } from '@cms/schema/repeat-items'
import { installNativeFieldFeedback } from './canvas-field-feedback.ts'
import type { CanvasChromeProps, CanvasHover } from './canvas-chrome.tsx'

type Box = { top: number; bottom: number; left: number; width: number }

type CanvasGeometry = {
  boxes: Map<number, Box>
  height: number
  ghosts: { slot: FieldLike; host: Element; className: string }[]
  listGhosts: { reader: string; field: string; host: Element; className: string }[]
  toolbarTop: number
  toolbarInHeader: boolean
}

const emptyGeometry: CanvasGeometry = {
  boxes: new Map(),
  height: 0,
  ghosts: [],
  listGhosts: [],
  toolbarTop: 0,
  toolbarInHeader: false,
}

type GeometryProps = Pick<
  CanvasChromeProps,
  | 'frame'
  | 'viewport'
  | 'ready'
  | 'scale'
  | 'sections'
  | 'selected'
  | 'selectedSlot'
  | 'selectedItem'
  | 'mode'
  | 'surface'
  | 'onHover'
  | 'preserveLayout'
  | 'slotsFor'
> & { sectionTools: RefObject<HTMLDivElement | null> }

export function useCanvasChromeGeometry({
  frame,
  viewport,
  ready,
  scale,
  sections,
  selected,
  selectedSlot,
  selectedItem,
  mode,
  surface,
  onHover,
  preserveLayout = false,
  slotsFor,
  sectionTools,
}: GeometryProps) {
  const [hovered, setHovered] = useState<CanvasHover | null>(null)
  const lastHover = useRef('null')
  const [geometry, setGeometry] = useState(emptyGeometry)
  useLayoutEffect(() => {
    if (mode === 'toolbar-only') {
      setGeometry({ ...emptyGeometry, toolbarInHeader: true })
      return
    }
    const doc = surface?.document ?? frame.current?.contentDocument
    const container = viewport.current
    const iframe = surface?.element ?? frame.current
    if (!doc || !container || !iframe || !ready) return
    if (preserveLayout) installNativeFieldFeedback(doc)
    let queued = 0
    function measure() {
      doc!.documentElement.toggleAttribute('data-cms-site-controls', preserveLayout)
      queued = 0
      const base = container!.getBoundingClientRect()
      const offset = iframe!.getBoundingClientRect()
      const boxes = new Map<number, Box>()
      const box = (rect: { top: number; bottom: number; left: number; width: number }): Box => ({
        top: offset.top - base.top + rect.top * scale,
        bottom: offset.top - base.top + rect.bottom * scale,
        left: offset.left - base.left + rect.left * scale,
        width: rect.width * scale,
      })
      doc!.querySelectorAll<HTMLElement>('[data-cms-section]').forEach(node => {
        const index = Number(node.dataset.cmsSection)
        if (Number.isSafeInteger(index) && index >= 0 && index < sections.length)
          boxes.set(index, box(node.getBoundingClientRect()))
      })
      const ghosts: { slot: FieldLike; host: Element; className: string }[] = []
      const selectedRoot = selected === null ? null : doc!.querySelector('[data-cms-section="' + selected + '"]')
      if (!preserveLayout && selected !== null && sections[selected] && selectedRoot) {
        const sectionFields = Array.from(selectedRoot.querySelectorAll<HTMLElement>('[data-cms-slot]'))
        for (const slot of slotsFor(sections[selected]!)) {
          const spec = repeatItemSpec(slot)
          if (!spec) continue
          const keys = repeatItemKeys(sections[selected]!.values[slot.id])
          if (keys.length >= spec.max) continue
          const roots = keys.flatMap(key => {
            const node = sectionFields.find(node => node.dataset.cmsSlot?.startsWith(slot.id + '__' + key + '__'))
            return node ? [node.closest('article,li,figure') ?? node] : []
          })
          let host: Element | null = roots[0]?.parentElement ?? null
          while (host && !roots.every(root => host!.contains(root))) host = host.parentElement
          if (!host || !selectedRoot.contains(host) || host === selectedRoot) continue
          let layout = roots[0]!
          while (layout.parentElement && layout.parentElement !== host) layout = layout.parentElement
          ghosts.push({ slot, host, className: layout.className })
        }
      }
      const listGhosts =
        preserveLayout || selected === null
          ? []
          : [
              ...doc!.querySelectorAll<HTMLElement>(
                '[data-cms-section="' + selected + '"] [data-cms-kind="repeat"][data-cms-reader]',
              ),
            ].map(parent => {
              const table = parent.tagName === 'TBODY' ? parent.closest('table') : null
              return {
                reader: parent.dataset.cmsReader!,
                field: parent.dataset.cmsSlot!,
                host: table
                  ? (table.closest('.bootstrap-table')?.parentElement ?? table.parentElement ?? parent)
                  : parent,
                className: table ? '' : (parent.querySelector('[data-cms-entry]')?.className ?? ''),
              }
            })
      const active = selected === null ? null : boxes.get(selected)
      const toolbarTop = active ? Math.max(0, Math.min(Math.max(32, active.top + 32), container!.clientHeight - 96)) : 0
      const toolbarWidth = Math.min(sectionTools.current?.offsetWidth ?? 192, container!.clientWidth)
      const toolbarHeight = sectionTools.current?.offsetHeight ?? 48
      const toolbarLeft = container!.clientWidth - toolbarWidth - 8
      const text = [...(selectedRoot?.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,a,button,summary') ?? [])]
      const coversText = text.some(
        node =>
          node.textContent?.trim() &&
          [...node.getClientRects()].some(rect => {
            const bounds = box(rect)
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              bounds.left < toolbarLeft + toolbarWidth &&
              bounds.left + bounds.width > toolbarLeft &&
              bounds.top < toolbarTop + toolbarHeight &&
              bounds.bottom > toolbarTop
            )
          }),
      )
      setGeometry({
        boxes,
        height: container!.clientHeight,
        ghosts,
        listGhosts,
        toolbarTop,
        toolbarInHeader:
          iframe!.clientWidth <= 768 ||
          !active ||
          active.top < 0 ||
          active.top > container!.clientHeight - 128 ||
          coversText,
      })
    }
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(measure)
    }
    const hover = (event: PointerEvent) => {
      const target = event.target as Element
      const card = target.closest?.('article,li,figure,.core-card,.card')
      const field = target.closest?.('[data-cms-slot]') ?? card?.querySelector('[data-cms-slot]')
      const parsed = field ? parseRepeatItemSlotId(field.getAttribute('data-cms-slot') ?? '') : null
      const index = Number(field?.closest('[data-cms-section]')?.getAttribute('data-cms-section'))
      const next =
        parsed && Number.isSafeInteger(index) ? { section: index, repeatId: parsed.repeatId, key: parsed.key } : null
      const encoded = JSON.stringify(next)
      if (lastHover.current !== encoded) {
        lastHover.current = encoded
        setHovered(next)
        onHover?.(next)
      }
    }
    doc.addEventListener('pointermove', hover)
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(doc.documentElement)
    observer.observe(container)
    if (sectionTools.current) observer.observe(sectionTools.current)
    doc.addEventListener('scroll', schedule, true)
    container.addEventListener('scroll', schedule)
    const mutations = new MutationObserver(schedule)
    mutations.observe(doc.body, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(queued)
      observer.disconnect()
      mutations.disconnect()
      doc.removeEventListener('pointermove', hover)
      doc.removeEventListener('scroll', schedule, true)
      container.removeEventListener('scroll', schedule)
    }
  }, [
    frame,
    viewport,
    ready,
    scale,
    sections,
    selected,
    selectedSlot,
    selectedItem,
    hovered,
    mode,
    surface,
    onHover,
    preserveLayout,
  ])

  return { geometry, hovered }
}
