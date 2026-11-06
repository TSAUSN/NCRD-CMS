import { it, expect } from 'vitest'
import { emptyStoriesSettings } from '@cms/schema'
import { storiesOverview, storyFeedUse } from './stories-overview.ts'
import type { StoryListRow } from './story-list.ts'
const settings = {
  ...emptyStoriesSettings(),
  publishUnreviewed: false,
  mainTags: [
    { id: 'health', label: 'Health', keywords: [] },
    { id: 'education', label: 'Education', keywords: [] },
    { id: 'zero', label: 'No current stories', keywords: [] },
  ],
  secondaryTags: [{ id: 'africa', label: 'Africa', keywords: [], areas: [] }],
}
const make = (
  id: string,
  values: Record<string, unknown>,
  published: Record<string, unknown> | null = values,
): StoryListRow => ({ id, stableKey: id, values, published, changed: false, hasText: true, photoPreview: null })
const value = { title: '[Story]', published_date: '2026-10-01', tags: 'health', regions: 'africa', reviewed: true }
it('keeps catalog order/zeroes, separates draft and published tags, lists untagged stories and uses the 30-day clamped cutoff', () => {
  const a = make('a', value, { ...value, tags: 'education' }),
    b = make(
      'b',
      { ...value, tags: 'education', published_date: '2025-10-15', hidden: true },
      { ...value, published_date: '2025-10-15' },
    ),
    c = make('c', { ...value, feed_removed: true }),
    d = make('d', { ...value, published_date: '2025-09-01' }),
    e = make('e', { ...value, tags: '' }, null),
    f = make('f', { ...value, tags: 'unknown' }, null),
    g = make('g', { ...value, published_date: '2025-10-10' }, null),
    h = make('h', { ...value, published_date: '2026-11-10' }, null)
  const use = { id: 'page', title: '[Health page]', path: '/health', main: ['health'] },
    result = storiesOverview(
      [a, b, c, d, e, f, g, h],
      settings,
      settings,
      [use, use, { id: 'all', title: '[All stories]', path: '/news', main: null }],
      new Date('2026-10-31T12:00:00Z'),
    )
  expect(result.groups.map(group => [group.id, group.rows.length, group.live])).toEqual([
    ['health', 2, 1],
    ['education', 1, 1],
    ['zero', 0, 0],
  ])
  expect(result.groups[0]!.uses).toHaveLength(2)
  expect(result.groups[1]!.uses).toHaveLength(1)
  expect(result.noMainUses.map(use => use.id)).toEqual(['all'])
  expect(result.noMain.map(row => row.id)).toEqual(['e', 'f'])
  expect(result.missing.map(row => row.id)).toEqual(['e', 'f'])
  expect(result.leaving.map(item => item.row.id)).toEqual(['g'])
  expect(result.leaving[0]!.days).toBeLessThanOrEqual(30)
  expect(result.currentCount).toBe(5)
  expect(result.liveCount).toBe(2)
  const excluded = storiesOverview(
    [make('unreviewed', { ...value, published_date: '2025-10-10', reviewed: false })],
    settings,
    settings,
    [],
    new Date('2026-10-31'),
  )
  expect(excluded.groups[0]!.rows).toHaveLength(1)
  expect(excluded.liveCount).toBe(0)
  expect(excluded.leaving).toHaveLength(0)
})
it('maps only automatic story bindings to pages; manual article links and unrelated lists are excluded', () => {
  const base = { id: 'page', title: '[Page]', slug: 'health' },
    binding = { readerKey: 'stories', selection: { mode: 'automatic', filter: { field: 'tags', value: 'health' } } }
  expect(storyFeedUse({ ...base, bindings: [binding] })).toEqual([
    { id: 'page', title: '[Page]', path: '/health', main: ['health'] },
  ])
  expect(
    storyFeedUse({
      ...base,
      bindings: [
        { ...binding, selection: { mode: 'automatic' } },
        { ...binding, selection: { mode: 'automatic', filter: { field: 'region', value: 'africa' } } },
      ],
    }).map(use => use.main),
  ).toEqual([null, null])
  expect(
    storyFeedUse({
      ...base,
      bindings: [
        { ...binding, readerKey: 'events' },
        { ...binding, selection: { mode: 'manual', stableKeys: ['story'] } },
        { ...binding, selection: { mode: 'automatic', filter: { field: 'unrecognized', value: 'x' } } },
        null,
      ],
    }),
  ).toEqual([])
})

it('keeps Overview page usage accurate for multiple main tags and combined older bindings', () => {
  const page = { id: 'feed', title: '[Feed]', slug: 'updates' },
    binding = {
      readerKey: 'stories',
      selection: { mode: 'automatic', storyTags: { main: ['health', 'education'], secondary: ['africa'] } },
    }
  expect(storyFeedUse({ ...page, bindings: [binding] })[0]!.main).toEqual(['health', 'education'])
  expect(
    storyFeedUse({
      ...page,
      bindings: [{ ...binding, selection: { ...binding.selection, filter: { field: 'tags', value: 'health' } } }],
    })[0]!.main,
  ).toEqual(['health'])
  expect(
    storyFeedUse({
      ...page,
      bindings: [{ ...binding, selection: { ...binding.selection, storyTags: { main: [], secondary: [] } } }],
    })[0]!.main,
  ).toBeNull()
  expect(
    storyFeedUse({
      ...page,
      bindings: [{ ...binding, selection: { ...binding.selection, storyTags: { main: ['Health'], secondary: [] } } }],
    }),
  ).toEqual([])
})
