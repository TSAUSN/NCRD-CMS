import { useLayoutEffect, useRef, useState } from 'react'

type Layer<T> = { key: string; value: T }

/** Stage a replacement without unmounting the visible, already loaded frame. */
export function usePreviewLayers<T>(next: Layer<T> | null) {
  const latest = useRef(next)
  const [shown, setShown] = useState<Layer<T> | null>(null)
  useLayoutEffect(() => {
    latest.current = next
  }, [next])
  const staging = next !== null && next.key !== shown?.key
  const layers = [...(shown ? [shown] : []), ...(staging ? [next] : [])]
  function loaded(key: string) {
    if (!latest.current || latest.current.key !== key || shown?.key === key) return
    setShown(latest.current)
  }
  return { layers, shown, staging, loaded }
}
