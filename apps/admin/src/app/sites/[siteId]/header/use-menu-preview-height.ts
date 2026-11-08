import { useEffect, useRef, useState, type PointerEvent } from 'react'

/** Keep menu rows still while a pointer is preparing or performing a drag. */
export function useMenuPreviewHeight() {
  const previewRef = useRef<HTMLDivElement>(null)
  const interaction = useRef<AbortController | null>(null)
  const [holdHeight, setHoldHeight] = useState<number>()
  useEffect(() => () => interaction.current?.abort(), [])

  function onMenuPointerDown(event: PointerEvent<HTMLUListElement>) {
    const preview = previewRef.current
    if (!preview || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return
    if (!event.target.closest('[data-reorder-row][draggable="true"]')) return

    interaction.current?.abort()
    const events = new AbortController()
    interaction.current = events
    setHoldHeight(preview.getBoundingClientRect().height)

    let dragging = false
    const options = { capture: true, signal: events.signal }
    const release = () => {
      events.abort()
      interaction.current = null
      setHoldHeight(undefined)
    }
    window.addEventListener(
      'dragstart',
      () => {
        dragging = true
      },
      options,
    )
    window.addEventListener(
      'pointercancel',
      () => {
        if (!dragging) release()
      },
      options,
    )
    window.addEventListener('pointerup', release, options)
    window.addEventListener('dragend', release, options)
    window.addEventListener('drop', release, options)
    window.addEventListener('blur', release, options)
  }

  return { previewRef, holdHeight, onMenuPointerDown }
}
