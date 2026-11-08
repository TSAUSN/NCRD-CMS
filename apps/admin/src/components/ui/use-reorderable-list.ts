'use client'

import { useEffect, useRef, useState, type DragEvent } from 'react'

export type DropEdge = 'before' | 'after'
export type ReorderPoint = { from: string; over: string; edge: DropEdge; horizontalDistance: number }
export type ReorderMarker = { row: string; edge: DropEdge; indented?: boolean }
export type ReorderDecision<T> =
  | { status: 'blocked'; message: string }
  | { status: 'unchanged' }
  | { status: 'move'; marker: ReorderMarker; move: T }

const edgeMargin = 48
const rowSelector = '[data-reorder-row]'
const listSelector = '[data-reorder-list]'

function scrollNearEdge(row: HTMLElement, y: number) {
  for (let element = row.parentElement; element; element = element.parentElement) {
    if (element === document.body || element === document.documentElement) break
    if (element.scrollHeight <= element.clientHeight || !/^(auto|scroll)$/.test(getComputedStyle(element).overflowY))
      continue
    const box = element.getBoundingClientRect()
    const delta = edgeScroll(y, box.top, box.bottom)
    if (!delta) return false
    const previous = element.scrollTop
    element.scrollTop += delta
    if (element.scrollTop !== previous) return true
  }
  const previous = window.scrollY
  const delta = edgeScroll(y, 0, window.innerHeight)
  if (delta) window.scrollBy(0, delta)
  return window.scrollY !== previous
}

function edgeScroll(y: number, top: number, bottom: number) {
  const edge = Math.min(edgeMargin, (bottom - top) / 4)
  if (y < top || y > bottom) return 0
  if (y < top + edge) return -Math.ceil((top + edge - y) / 3)
  if (y > bottom - edge) return Math.ceil((y - bottom + edge) / 3)
  return 0
}

type ActiveDrag = { from: string; originX: number; x: number; y: number; row: HTMLElement; list: Element | null }
type BlockedDrop = { row: string; message: string }

/** Native drag events choose and commit the same explicit insertion gap. */
export function useReorderableList<T>({
  mimeType,
  decide,
  apply,
}: {
  mimeType: string
  decide: (point: ReorderPoint) => ReorderDecision<T>
  apply: (move: T) => string | undefined
}) {
  const drag = useRef<ActiveDrag | null>(null)
  const frame = useRef(0)
  const [source, setSource] = useState<string | null>(null)
  const [marker, setMarker] = useState<ReorderMarker | null>(null)
  const blockedTarget = useRef<BlockedDrop | null>(null)
  const [blocked, setBlocked] = useState<BlockedDrop | null>(null)
  const [rejection, setRejection] = useState<BlockedDrop | null>(null)
  const [announcement, setAnnouncement] = useState('')

  function announce(message: string) {
    setRejection(null)
    setAnnouncement(message)
  }

  function reject(target: BlockedDrop) {
    setRejection(target)
    setAnnouncement(target.message)
  }

  function clearMarker() {
    blockedTarget.current = null
    setMarker(null)
    setBlocked(null)
  }

  function end() {
    drag.current = null
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = 0
    setSource(null)
    clearMarker()
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    function cancel(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !drag.current) return
      end()
      announce('Move canceled.')
    }
    window.addEventListener('keydown', cancel, true)
    return () => {
      window.removeEventListener('keydown', cancel, true)
      cancelAnimationFrame(frame.current)
    }
  }, [])

  function cancel() {
    if (drag.current) end()
  }

  function decision(active: ActiveDrag) {
    const bounds = active.row.getBoundingClientRect()
    // The nested list is below its parent's controls, not part of the parent's drop zone.
    const children = active.row.querySelector(':scope > [data-reorder-child-list]')
    const bottom = children?.getBoundingClientRect().top ?? bounds.bottom
    return decide({
      from: active.from,
      over: active.row.dataset.reorderRow!,
      edge: active.y < (bounds.top + bottom) / 2 ? 'before' : 'after',
      horizontalDistance: active.x - active.originX,
    })
  }

  function show(active: ActiveDrag) {
    const result = decision(active)
    const next = result.status === 'move' ? result.marker : null
    setMarker(previous =>
      previous?.row === next?.row && previous?.edge === next?.edge && previous?.indented === next?.indented
        ? previous
        : next,
    )
    const row = active.row.dataset.reorderRow!
    const message = result.status === 'blocked' ? result.message : ''
    blockedTarget.current = message ? { row, message } : null
    setBlocked(previous =>
      !message ? null : previous?.row === row && previous.message === message ? previous : { row, message },
    )
    return result
  }

  function autoScroll() {
    frame.current = 0
    const active = drag.current
    if (!active || !scrollNearEdge(active.row, active.y)) return
    const under = document.elementFromPoint(active.x, active.y)?.closest<HTMLElement>(rowSelector)
    if (under && under.closest(listSelector) === active.list) {
      active.row = under
      show(active)
    } else clearMarker()
    frame.current = requestAnimationFrame(autoScroll)
  }

  function track(event: DragEvent<HTMLElement>) {
    const active = drag.current
    if (!active || !event.dataTransfer.types.includes(mimeType)) return null
    active.row = event.currentTarget
    active.x = event.clientX
    active.y = event.clientY
    return active
  }

  function begin(event: DragEvent<HTMLElement>, element: HTMLElement, id: string) {
    event.stopPropagation()
    drag.current = {
      from: id,
      originX: event.clientX,
      x: event.clientX,
      y: event.clientY,
      row: element,
      list: element.closest(listSelector),
    }
    event.dataTransfer.setData(mimeType, id)
    event.dataTransfer.effectAllowed = 'move'
    setSource(id)
    announce('')
  }

  function finish(event: DragEvent<HTMLElement>) {
    event.stopPropagation()
    const active = drag.current
    const rejected = blockedTarget.current
    if (active?.list && rejected) {
      // A refused drop has no drop event. WebKit can report a nonempty effect
      // on dragend, so confirm the pointer still ends over the refused row.
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(rowSelector)
      if (row?.dataset.reorderRow === rejected.row && row.closest(listSelector) === active.list) reject(rejected)
    }
    end()
  }

  function grip(id: string, disabled = false) {
    return {
      'data-reorder-grip': true,
      draggable: !disabled,
      onDragStart(event: DragEvent<HTMLElement>) {
        if (disabled) return
        const element = event.currentTarget.closest<HTMLElement>(rowSelector)
        if (element) begin(event, element, id)
      },
      onDragEnd: finish,
    }
  }

  function row(id: string, disabled = false, canDrag = !disabled) {
    function updateTarget(event: DragEvent<HTMLElement>) {
      const active = disabled ? null : track(event)
      if (!active) return
      event.stopPropagation()
      event.preventDefault()
      const result = show(active)
      event.dataTransfer.dropEffect = result.status === 'blocked' ? 'none' : 'move'
      if (!frame.current) frame.current = requestAnimationFrame(autoScroll)
    }
    return {
      'data-reorder-row': id,
      'data-reorder-source': source === id || undefined,
      'data-reorder-blocked': blocked?.row === id || undefined,
      draggable: !disabled && canDrag,
      onDragStart(event: DragEvent<HTMLElement>) {
        if (disabled || !canDrag) return
        begin(event, event.currentTarget, id)
      },
      // A fast movement can enter a row before the next dragover arrives.
      onDragEnter: updateTarget,
      onDragOver: updateTarget,
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!drag.current || event.currentTarget !== drag.current.row) return
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        // A native refused drop can emit dragleave before dragend. Keep the
        // reason until the next row takes over or the pointer leaves the list.
        setMarker(null)
        setBlocked(null)
        if (event.relatedTarget instanceof Node && !drag.current.list?.contains(event.relatedTarget))
          blockedTarget.current = null
        cancelAnimationFrame(frame.current)
        frame.current = 0
      },
      onDrop(event: DragEvent<HTMLElement>) {
        const active = disabled ? null : track(event)
        if (!active) return
        event.stopPropagation()
        event.preventDefault()
        const result = decision(active)
        end()
        if (result.status === 'blocked') reject({ row: id, message: result.message })
        if (result.status === 'move') announce(apply(result.move) ?? '')
      },
      onDragEnd: finish,
    }
  }
  return { row, grip, marker, blocked, rejection, announcement, announce, cancel }
}
