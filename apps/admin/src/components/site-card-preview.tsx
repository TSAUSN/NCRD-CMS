'use client'
import { useState, useEffect, useRef } from 'react'
/** Cards use a validated saved image instead of loading an entire page and its embeds. */
export function SiteCardPreview({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false)
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    // An SSR image can fail before React attaches onError during hydration.
    if (image.current?.complete && image.current.naturalWidth === 0) setFailed(true)
  }, [src])
  return failed ? (
    <span>Preview unavailable · Open site</span>
  ) : (
    <img
      ref={image}
      src={src}
      alt={name + ' saved home-page picture'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
