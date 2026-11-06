import { expect, it } from 'vitest'
import { imageFocus, imageFocusPosition } from './image-focus.ts'
it('accepts normalized existing points and emits only bounded numeric positions', () => {
  expect(imageFocus({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 })
  expect(imageFocusPosition({ x: 0.33333333, y: 0.5 })).toBe('33.333% 50%')
  for (const value of [
    null,
    [],
    {},
    { x: 2, y: 0.5 },
    { x: -0.01, y: 0 },
    { x: NaN, y: 1 },
    { x: Infinity, y: 0 },
    { x: '0.5', y: 0.5 },
    { x: '0; background:url(https://evil.test)', y: 0 },
  ]) {
    expect(imageFocus(value)).toBeNull()
    expect(imageFocusPosition(value)).toBeNull()
  }
})
