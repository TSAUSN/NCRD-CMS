'use client'
import { useEffect, useState } from 'react'
import { heroPhotoContrast } from '../../../lib/hero-contrast.ts'
import type { heroSlidePresentation } from '@cms/schema'
import shared from '../../../components/workspace.module.css'
export function HeroContrastCheck({
  photoUrl,
  shade,
  label = 'Text contrast',
}: {
  photoUrl: string | null
  shade: ReturnType<typeof heroSlidePresentation>['shade']
  label?: string
}) {
  const [ratio, setRatio] = useState<number | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    setRatio(undefined)
    if (!photoUrl) {
      setRatio(null)
      return
    }
    const image = new Image()
    try {
      const url = new URL(photoUrl, location.origin)
      if (url.origin !== location.origin) {
        setRatio(null)
        return
      }
      image.onload = () => {
        if (!active) return
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 32
          canvas.height = 18
          const context = canvas.getContext('2d')
          if (!context) {
            setRatio(null)
            return
          }
          context.drawImage(image, 0, 0, 32, 18)
          setRatio(heroPhotoContrast(context.getImageData(0, 0, 32, 18).data, 32, shade))
        } catch {
          setRatio(null)
        }
      }
      image.onerror = () => {
        if (active) setRatio(null)
      }
      image.src = url.href
    } catch {
      setRatio(null)
    }
    return () => {
      active = false
      image.onload = null
      image.onerror = null
    }
  }, [photoUrl, shade])
  return (
    <p className={shared.meta} role="status">
      {label}:{' '}
      {ratio === undefined
        ? 'Checking this photo…'
        : ratio === null
          ? 'Photo check unavailable. Check the text in Preview.'
          : ratio >= 4.5
            ? 'passes the sampled photo check (' + ratio.toFixed(1) + ':1).'
            : 'low on this photo (' + ratio.toFixed(1) + ':1). Try a different photo or shade.'}
    </p>
  )
}
