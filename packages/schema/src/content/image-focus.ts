export type ImageFocus = { x: number; y: number }
/** The existing stored image focus model. Unknown data never becomes CSS. */
export function imageFocus(value: unknown): ImageFocus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { x, y } = value as Record<string, unknown>
  return typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
    ? { x, y }
    : null
}
export function imageFocusPosition(value: unknown): string | null {
  const focus = imageFocus(value)
  return focus ? `${Number((focus.x * 100).toFixed(3))}% ${Number((focus.y * 100).toFixed(3))}%` : null
}
