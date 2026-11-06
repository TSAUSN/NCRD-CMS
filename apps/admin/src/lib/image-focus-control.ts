import type { ImageFocus } from '@cms/schema'
const clamp = (value: number) => Math.max(0, Math.min(1, Math.round(value * 100) / 100))
export function pointerImageFocus(
  x: number,
  y: number,
  box: { left: number; top: number; width: number; height: number },
): ImageFocus | null {
  if (![x, y, box.left, box.top, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0)
    return null
  return { x: clamp((x - box.left) / box.width), y: clamp((y - box.top) / box.height) }
}
export function keyboardImageFocus(key: string, current: ImageFocus, shift = false): ImageFocus | null {
  const step = shift ? 0.1 : 0.01
  if (key === 'Home') return { x: 0.5, y: 0.5 }
  if (key === 'ArrowLeft' || key === 'ArrowRight')
    return { ...current, x: clamp(current.x + (key === 'ArrowLeft' ? -step : step)) }
  if (key === 'ArrowUp' || key === 'ArrowDown')
    return { ...current, y: clamp(current.y + (key === 'ArrowUp' ? -step : step)) }
  return null
}
