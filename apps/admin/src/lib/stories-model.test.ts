import { it, expect } from 'vitest'
import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
import { storiesSummary, storyFeedState } from './stories-model.ts'
it('reports the imported coverage, missing text and clamped calendar feed expiry', () => {
  const rows = sawsoStoryRows().map((row, index) => ({
      id: String(index),
      stableKey: row.stableKey,
      values: row.values,
    })),
    result = storiesSummary(rows, new Date('2026-10-30T12:00:00Z'))
  expect(result.rows).toHaveLength(34)
  expect(result.textNeeded).toBe(31)
  expect(result.sampleText).toBe(3)
  expect(result.sectors.map(s => [s.label, s.count])).toEqual([
    ['Disaster Relief & Recovery', 17],
    ['Health', 11],
    ['Education', 7],
    ['Business & Economic Development', 5],
    ['Anti-Human Trafficking', 3],
    ['Capacity Building', 1],
    ['Family Care', 0],
    ['Livelihoods', 0],
  ])
  const old = result.rows.find(row => String(row.values.title).startsWith('Fostering Hope:'))!
  expect(old.feed.active).toBe(false)
  const leap = { id: 'a', stableKey: 'a', values: { published_date: '2024-01-31' } }
  expect(storyFeedState(leap, new Date('2025-02-28T00:00:00Z'))).toMatchObject({
    active: true,
    leavesOn: '2025-02-28',
    soon: true,
  })
  expect(storyFeedState(leap, new Date('2025-03-01T00:00:00Z')).active).toBe(false)
})
