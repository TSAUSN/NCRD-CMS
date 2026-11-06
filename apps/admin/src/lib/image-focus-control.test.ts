import { expect, it } from 'vitest'
import { pointerImageFocus, keyboardImageFocus } from './image-focus-control.ts'
it('maps the actual displayed image, clamps a captured drag outside it and refuses missing geometry', () => {
  const box = { left: 100, top: 50, width: 400, height: 200 }
  expect(pointerImageFocus(400, 100, box)).toEqual({ x: 0.75, y: 0.25 })
  expect(pointerImageFocus(-10, 500, box)).toEqual({ x: 0, y: 1 })
  expect(pointerImageFocus(0, 0, { ...box, width: 0 })).toBeNull()
  expect(pointerImageFocus(NaN, 0, box)).toBeNull()
})
it('offers small and large keyboard moves, bounds and a centre reset without consuming unrelated keys', () => {
  expect(keyboardImageFocus('ArrowRight', { x: 0.5, y: 0.5 })).toEqual({ x: 0.51, y: 0.5 })
  expect(keyboardImageFocus('ArrowUp', { x: 0.5, y: 0.5 }, true)).toEqual({ x: 0.5, y: 0.4 })
  expect(keyboardImageFocus('ArrowLeft', { x: 0, y: 1 })).toEqual({ x: 0, y: 1 })
  expect(keyboardImageFocus('Home', { x: 0, y: 1 })).toEqual({ x: 0.5, y: 0.5 })
  expect(keyboardImageFocus('Tab', { x: 0, y: 1 })).toBeNull()
})
it('keeps fractional pointer coordinates on the same whole-percent steps as the displayed controls', () => {
  expect(pointerImageFocus(398.8, 99.2, { left: 100, top: 50, width: 400, height: 200 })).toEqual({ x: 0.75, y: 0.25 })
  expect(pointerImageFocus(299, 199, { left: 0, top: 0, width: 400, height: 400 })).toEqual({ x: 0.75, y: 0.5 })
})
