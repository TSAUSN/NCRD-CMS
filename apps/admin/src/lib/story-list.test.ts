import { describe, expect, it } from 'vitest'
import { sawsoStoriesSettings } from '@cms/seeds/sawso-story-tags'
import { filterStoryList, optimisticStoryList, storyListValues, type StoryListRow } from './story-list.ts'
const settings = sawsoStoriesSettings(),
  filters = { q: '', status: 'all' as const, main: '', secondary: '' }
const make = (
  id: string,
  values: Record<string, unknown>,
  published: Record<string, unknown> | null = values,
): StoryListRow => ({
  id,
  stableKey: id,
  values: { published_date: new Date().toISOString().slice(0, 10), ...values },
  published: published ? { published_date: new Date().toISOString().slice(0, 10), ...published } : null,
  changed: false,
  hasText: true,
  photoPreview: null,
})
const rows = [
  make('first', {
    title: 'School in Nepal',
    summary: 'Children learn together',
    tags: 'education,health',
    region: 'asia',
    regions: 'asia,africa',
    reviewed: false,
  }),
  make('second', {
    title: 'Health update',
    summary: 'Medical care',
    tags: 'health',
    region: 'africa',
    reviewed: true,
    hidden: true,
  }),
  make('third', { title: 'Removed story', summary: 'Still retained', tags: '', region: '', feed_removed: true }),
  make(
    'fourth',
    { title: 'Untagged draft', summary: 'A new story', tags: 'unknown', region: '', reviewed: false },
    null,
  ),
]
describe('Stories list data and filters', () => {
  it('sends no full body or source-image URL in a row summary', () => {
    expect(
      storyListValues({
        title: 'Story',
        body: 'Private full article',
        image_url: 'https://source.test/private-photo.jpg',
        tags: 'health',
      }),
    ).toEqual({ title: 'Story', tags: 'health' })
  })
  it('searches title/description and combines status and both tag filters', () => {
    expect(
      filterStoryList(rows, { ...filters, q: 'LEARN', main: 'education', secondary: 'africa' }, settings).map(
        r => r.id,
      ),
    ).toEqual(['first'])
    expect(filterStoryList(rows, { ...filters, status: 'review' }, settings).map(r => r.id)).toEqual([
      'first',
      'fourth',
    ])
    expect(filterStoryList(rows, { ...filters, status: 'untagged' }, settings).map(r => r.id)).toEqual(['fourth'])
    expect(filterStoryList(rows, { ...filters, status: 'hidden' }, settings).map(r => r.id)).toEqual(['second'])
    expect(filterStoryList(rows, { ...filters, status: 'removed' }, settings).map(r => r.id)).toEqual(['third'])
    expect(filterStoryList(rows, { ...filters, status: 'live' }, settings).map(r => r.id)).toEqual(['first'])
    expect(filterStoryList(rows, { ...filters, main: '__none' }, settings).map(r => r.id)).toEqual(['third', 'fourth'])
  })
  it('replays queued intentions in order, marks tag edits reviewed and preserves canonical data', () => {
    const optimistic = optimisticStoryList(
      rows,
      [
        { entryId: 'first', patch: { action: 'tag', group: 'main', id: 'health', selected: false } },
        { entryId: 'first', patch: { action: 'tag', group: 'secondary', id: 'europe', selected: true } },
        { entryId: 'first', patch: { action: 'reviewed', value: false } },
      ],
      settings,
    )
    expect(optimistic[0]!.values).toMatchObject({
      title: 'School in Nepal',
      tags: 'education',
      regions: 'asia,africa,europe',
      reviewed: false,
    })
    expect(rows[0]!.values.tags).toBe('education,health')
    expect(optimistic[1]).toBe(rows[1])
  })
})
