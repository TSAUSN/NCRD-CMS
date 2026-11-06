import { it, expect } from 'vitest'
import { storyFeedBinding, storyFeedChoice, storyFeedMaximum } from './story-feed-choice.ts'
import { readCollectionBinding, type StoryFeedTags } from './collection-binding.ts'
it('converts earlier sector/region choices to stable groups and preserves the excluded article', () => {
  const before = {
    readerKey: 'stories',
    selection: {
      mode: 'automatic',
      limit: 6,
      filter: { field: 'tags', value: 'health' },
      excludeStableKey: 'own-story',
    },
  }
  expect(storyFeedChoice(before).tags).toEqual({ main: ['health'], secondary: [] })
  const changed = storyFeedBinding(before, { main: ['health', 'education'], secondary: ['africa'] }, 4)
  expect(changed).toEqual({
    readerKey: 'stories',
    selection: {
      mode: 'automatic',
      order: 'newest',
      limit: 4,
      dateField: 'published_date',
      maxAgeMonths: 13,
      excludeStableKey: 'own-story',
      storyTags: { main: ['health', 'education'], secondary: ['africa'] },
    },
  })
  expect(readCollectionBinding(changed)).toEqual(changed)
  expect(
    storyFeedChoice({
      readerKey: 'stories',
      selection: { mode: 'automatic', limit: 6, filter: { field: 'region', value: 'asia' } },
    }).tags,
  ).toEqual({ main: [], secondary: ['asia'] })
  expect(before.selection.filter.value).toBe('health')
})
it('keeps intentional earlier intersections and unknown stable IDs until explicitly changed', () => {
  const before = {
    readerKey: 'stories',
    selection: {
      mode: 'automatic',
      limit: 6,
      filter: { field: 'tags', value: 'health' },
      storyTags: { main: ['removed-tag'], secondary: [] },
    },
  }
  expect(storyFeedBinding(before, storyFeedChoice(before).tags, 6).selection).toMatchObject({
    filter: { field: 'tags', value: 'health' },
    storyTags: { main: ['removed-tag'], secondary: [] },
  })
  expect(storyFeedChoice(null).tags).toEqual({ main: [], secondary: [] })
})
it('offers the six-story SAWSO sector maximum while other pages keep the bounded full choice', () => {
  const tags: StoryFeedTags = {
    mainLabel: 'Sectors',
    secondaryLabel: 'Regions',
    source: 'sawso',
    mainTags: [],
    secondaryTags: [],
  }
  expect(storyFeedMaximum(tags, '/ways-we-help/health')).toBe(6)
  expect(storyFeedMaximum(tags, '/newsroom')).toBe(200)
  expect(storyFeedMaximum({ ...tags, source: 'none' }, '/ways-we-help/health')).toBe(200)
})
