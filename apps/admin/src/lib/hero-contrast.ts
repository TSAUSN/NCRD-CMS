import { checkContrast } from '@cms/domain'
import type { heroSlidePresentation } from '@cms/schema'
type Shade = ReturnType<typeof heroSlidePresentation>['shade']
/** Conservative whole-photo sampling; this is feedback, not a pixel-perfect accessibility certification. */
export function heroPhotoContrast(pixels: ArrayLike<number>, width: number, shade: Shade): number | null {
  let lowest = Infinity
  for (let at = 0; at + 3 < pixels.length; at += 4) {
    const x = ((at / 4) % width) / Math.max(1, width - 1)
    const alpha = shade === 'black' ? 0.5 : shade === 'white' ? 0.88 : shade === 'blue' ? 0.75 - 0.4 * x : 0
    const tint = shade === 'white' ? [255, 255, 255] : shade === 'blue' ? [0, 32 * x, 86 * x] : [0, 0, 0]
    const background =
      '#' +
      [0, 1, 2]
        .map(index =>
          Math.round((pixels[at + index] ?? 0) * (1 - alpha) + (tint[index] ?? 0) * alpha)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    const verdict = checkContrast(shade === 'white' ? '#172033' : '#ffffff', background)
    if (verdict) lowest = Math.min(lowest, verdict.ratio)
  }
  return Number.isFinite(lowest) ? lowest : null
}
