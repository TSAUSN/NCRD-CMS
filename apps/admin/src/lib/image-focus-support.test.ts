import { expect, it } from 'vitest'
import { supportsImageFocus } from './image-focus-support.ts'
it('offers focus only where the current definition renderer owns the image element', () => {
  const image = { kind: 'slot', slotKind: 'image', context: 'element-text' }
  expect(supportsImageFocus('structured', null)).toBe(true)
  expect(supportsImageFocus('legacy', { nodes: [image] })).toBe(true)
  expect(
    supportsImageFocus('legacy', { nodes: [image, { ...image, context: 'quoted-attribute', attribute: 'src' }] }),
  ).toBe(false)
  expect(supportsImageFocus('legacy', { nodes: [{ ...image, context: undefined }] })).toBe(false)
  expect(supportsImageFocus('legacy', { nodes: [] })).toBe(false)
  expect(supportsImageFocus('legacy', null)).toBe(false)
})
