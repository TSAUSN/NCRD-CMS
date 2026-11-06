import { it, expect } from 'vitest'
import { heroPhotoContrast } from './hero-contrast.ts'
it('checks every approved shade against dark and light photo samples without claiming unshaded text always passes', () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  expect(heroPhotoContrast(pixels, 2, 'white')).toBeGreaterThan(4.5)
  expect(heroPhotoContrast(pixels, 2, 'black')).toBeLessThan(4.5)
  expect(heroPhotoContrast(pixels, 2, 'blue')).toBeLessThan(4.5)
  expect(heroPhotoContrast(pixels, 2, 'none')).toBe(1)
  expect(heroPhotoContrast([], 2, 'none')).toBeNull()
})
