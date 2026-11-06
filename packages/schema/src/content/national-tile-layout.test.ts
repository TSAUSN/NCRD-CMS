import { expect, it } from 'vitest'
import { nationalTileLayout, preserveNationalTileLayout } from './national-tile-layout.ts'
const values = (count: number) => ({ cards: { items: Array.from({ length: count }, (_, i) => 'i' + (i + 1)) } })
it.each([3, 4, 5])(
  'keeps the existing %i-card presentation when adding, and restores the original state on cancellation',
  count => {
    const before = values(count),
      added = preserveNationalTileLayout('core-feature-tiles', before, values(count + 1))
    expect(nationalTileLayout(added)).toBe(nationalTileLayout(before))
    const cancelled = preserveNationalTileLayout('core-feature-tiles', added, { ...added, ...values(count) })
    expect(cancelled).toEqual(before)
  },
)
it('preserves the chosen layout through further additions, removal and saved reloads', () => {
  const added = preserveNationalTileLayout('core-feature-tiles', values(5), values(6))
  const reloaded = JSON.parse(JSON.stringify(added))
  const more = preserveNationalTileLayout('core-feature-tiles', reloaded, { ...reloaded, ...values(7) })
  const removed = preserveNationalTileLayout('core-feature-tiles', more, { ...more, ...values(4) })
  expect(nationalTileLayout(removed)).toBe('five')
})
it('does not change another section or a same-length content edit', () => {
  const after = values(6)
  expect(preserveNationalTileLayout('core-image-cards', values(5), after)).toBe(after)
  expect(preserveNationalTileLayout('core-feature-tiles', after, after)).toBe(after)
})
