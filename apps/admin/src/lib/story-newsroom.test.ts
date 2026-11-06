import { it, expect } from 'vitest'
import { emptyStoriesSettings } from '@cms/schema'
import { selectListRows } from './collection-binding.ts'
import { storyDetailValues } from './stories-edit.ts'
import { storyEntryPresentation } from './release-copy.ts'
it('selects an older feature before the news limit while keeping a tagged sector newest first', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({
      id: String(i),
      stableKey: 'story-' + i,
      createdAt: '2026-10-01',
      values: {
        published_date: '2026-10-' + String(i + 1).padStart(2, '0'),
        tags: 'health',
        newsroom_rank: i === 0 ? 1 : 0,
      },
    })),
    settings = emptyStoriesSettings(),
    selection = { mode: 'automatic' as const, limit: 6, dateField: 'published_date', maxAgeMonths: 13 }
  expect(selectListRows(rows, selection, new Date('2026-10-30'), settings)[0]?.id).toBe('0')
  expect(
    selectListRows(
      rows,
      { ...selection, storyTags: { main: ['health'], secondary: [] } },
      new Date('2026-10-30'),
      settings,
    )[0]?.id,
  ).toBe('6')
})
it('validates optional author text and describes saved feature changes without internal field names', () => {
  const input = {
    title: '[Title]',
    summary: '[Summary]',
    author: ' [Name] ',
    tags: [],
    regions: [],
    region: '',
    published_date: '',
    countries: '',
    body: '<p>[Words]</p>',
    body_is_sample: false,
  }
  expect(storyDetailValues(input, {}, emptyStoriesSettings()).author).toBe('[Name]')
  expect(() => storyDetailValues({ ...input, author: 'x'.repeat(121) }, {}, emptyStoriesSettings())).toThrow('120')
  const before = { title: '[Title]' },
    after = { ...before, newsroom_rank: 1 },
    fields = [{ key: 'newsroom_rank', label: 'Newsroom order', type: 'number' }]
  expect(storyEntryPresentation(before, after, fields, { main: {}, secondary: {} }).summary).toBe(
    '[Title]: featured in the Newsroom',
  )
})
