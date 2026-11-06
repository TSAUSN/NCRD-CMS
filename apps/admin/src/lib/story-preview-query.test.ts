import { it, expect } from 'vitest'
import { storyListFilters, storyListQuery, storyPreviewHref, filterStoryList, type StoryListRow } from './story-list.ts'
import { emptyStoriesSettings } from '@cms/schema'
it('carries search, status and both groups to a private preview and back without interpreting authored text', () => {
  const filters = { q: 'Water & <photos>', status: 'review' as const, main: 'health', secondary: 'africa' },
    url = storyPreviewHref('site-id', filters),
    parsed = new URL(url, 'http://localhost')
  expect(parsed.pathname).toBe('/preview/stories/site-id')
  expect(storyListFilters(parsed.searchParams)).toEqual(filters)
  expect(storyListQuery(filters).toString()).toBe(parsed.search.slice(1))
  expect(
    storyListFilters(new URLSearchParams('status=unknown&q=' + encodeURIComponent('x'.repeat(500)))),
  ).toMatchObject({ q: 'x'.repeat(120), status: 'all' })
  expect(storyListFilters(new URLSearchParams('sector=education'))).toMatchObject({ main: 'education' })
})
it('keeps Live filtering on published policy when an unreviewed-story policy draft changes', () => {
  const settings = emptyStoriesSettings(),
    published = { ...settings, publishUnreviewed: true },
    draft = { ...settings, publishUnreviewed: false },
    values = { title: '[Story]', published_date: new Date().toISOString().slice(0, 10), reviewed: false },
    row: StoryListRow = {
      id: 'story',
      stableKey: 'story',
      values,
      published: values,
      changed: true,
      hasText: true,
      photoPreview: null,
    }
  expect(filterStoryList([row], { q: '', status: 'live', main: '', secondary: '' }, draft, published)).toHaveLength(1)
})
