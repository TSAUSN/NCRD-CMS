import { expect, it } from 'vitest'
import {
  featureStoryRows,
  orderedNewsroomStories,
  storyFeatureRank,
  newsroomSelection,
  emptyStoriesSettings,
} from './stories.ts'
import { orderedStoryWidgetRows, selectedStoryWidgetRows } from './story-widget-selection.ts'
import { createStoriesModel } from './stories-model.ts'
const rows = () =>
  Array.from({ length: 7 }, (_, index) => ({
    id: String(index),
    values: {
      title: '[Story ' + index + ']',
      published_date: '2026-10-' + String(index + 1).padStart(2, '0'),
      tags: 'health',
      regions: 'africa',
    },
  }))
it('features at the end, compacts removal, refuses a sixth and leaves the input untouched', () => {
  const original = rows()
  let next = original
  for (const id of ['0', '1', '2', '3', '4']) next = featureStoryRows(next, id, true)
  expect(() => featureStoryRows(next, '5', true)).toThrow('up to 5')
  next = featureStoryRows(next, '1', false)
  next = featureStoryRows(next, '5', true)
  expect(
    orderedNewsroomStories(next)
      .slice(0, 5)
      .map(row => row.id),
  ).toEqual(['0', '2', '3', '4', '5'])
  expect(original.every(row => storyFeatureRank(row.values) === 0)).toBe(true)
  expect(featureStoryRows(next, '5', true)).toEqual(next)
})
it('keeps sector/map views by date and only prioritizes featured stories in unfiltered news', () => {
  const featured = featureStoryRows(rows(), '0', true),
    dated = orderedStoryWidgetRows(featured)
  expect(selectedStoryWidgetRows(dated, 'recent', '', 6)[0]?.id).toBe('0')
  expect(selectedStoryWidgetRows(dated, 'recent', '', 6, false)[0]?.id).toBe('6')
  expect(selectedStoryWidgetRows(dated, 'sectors', 'health', 6)[0]?.id).toBe('6')
  expect(newsroomSelection({ mode: 'automatic', storyTags: { main: [], secondary: [] } })).toBe(true)
  expect(newsroomSelection({ mode: 'automatic', storyTags: { main: ['health'], secondary: [] } })).toBe(false)
  expect(newsroomSelection({ mode: 'manual' })).toBe(false)
})
it('starts a new site with optional plain Author and numeric Newsroom order fields', () => {
  const model = createStoriesModel(emptyStoriesSettings())
  expect(model.fields).toContainEqual({ key: 'author', label: 'Author', type: 'text', required: false })
  expect(model.fields).toContainEqual({
    key: 'newsroom_rank',
    label: 'Newsroom order',
    type: 'number',
    required: false,
  })
})
