import { it, expect, vi, afterEach } from 'vitest'
import { emptyStoriesSettings } from '@cms/schema'
import { sawsoStoryRows } from '@cms/seeds/sawso-stories'
import {
  initialSawsoSourceBaselines,
  mergeStorySource,
  parseSawsoStoriesFeed,
  StoryFeedFormatError,
  type SourceStory,
  type StorySourceBaseline,
  type SourceMergeEntry,
} from './story-source-feed.ts'
const settings = {
  ...emptyStoriesSettings(),
  source: 'sawso' as const,
  mainTags: [{ id: 'health', label: 'Health', keywords: ['water', 'hospital'] }],
  secondaryTags: [{ id: 'africa', label: 'Africa', keywords: ['Kenya'], areas: ['africa' as const] }],
}
const raw = (id = 1, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Water + health',
  description: 'Support in Kenya + care',
  urlAlias: 'water-story',
  published: true,
  hideInMenu: false,
  publishDate: '2026-10-31T08:00:00Z',
  headerImage: 'https://images.example.test/one+photo.jpg',
  customHeadContent: '{"idx":2}',
  ...extra,
})
const feed = (objects: unknown[]) => encodeURIComponent(JSON.stringify({ objects })).replace(/%20/g, '+')
const story = (id = '1', extra: Partial<SourceStory['fields']> = {}): SourceStory => ({
  sourceId: id,
  alias: 'water-story',
  fields: {
    title: 'Water + health',
    summary: 'Support in Kenya + care',
    published_date: '2026-10-31',
    old_address: 'https://sawso.org/sawso/story/water-story',
    image_url: 'https://images.example.test/one%20photo.jpg',
    ...extra,
  },
})
const baseline = (s = story(), stableKey = 'story-' + s.sourceId): StorySourceBaseline => ({
  sourceId: s.sourceId,
  stableKey,
  fields: { ...s.fields },
})
const entry = (s = story(), extra: Record<string, unknown> = {}): SourceMergeEntry => ({
  id: 'existing',
  stableKey: 'story-' + s.sourceId,
  values: {
    ...s.fields,
    tags: 'health',
    regions: 'africa',
    region: 'africa',
    reviewed: true,
    hidden: true,
    body: '<p>[CMS article text]</p>',
    photo: { src: '/media/owned/card', alt: '[Owned photo]', decorative: false },
    photo_note: '[Photo description]',
    story_url: '/stories/kept-address',
    ...extra,
  },
})
afterEach(() => vi.unstubAllGlobals())
it('decodes the form once, keeps literal plus signs in text and normalizes S3 key spaces', () => {
  const result = parseSawsoStoriesFeed(feed([raw()]))[0]!
  expect(result).toEqual(story())
  expect(result.fields.title).toContain('+')
  expect(result.fields.image_url).toContain('one%20photo.jpg')
})
it('uses published/menu gates and stable source idx order, including fallback synopsis and redirects', () => {
  const result = parseSawsoStoriesFeed(
    feed([
      raw(1, { customHeadContent: '{"idx":4}' }),
      raw(2, {
        customHeadContent: '{"idx":1}',
        description: '',
        synopsis: '[Fallback description]',
        redirectUrl: 'https://example.test/local-story',
      }),
      raw(3, { customHeadContent: '{"idx":1}' }),
      raw(4, { published: false }),
      raw(5, { hideInMenu: true }),
      raw(6, { title: '' }),
    ]),
  )
  expect(result.map(s => s.sourceId)).toEqual(['2', '3', '1'])
  expect(result[0]!.fields.summary).toBe('[Fallback description]')
  expect(result[0]!.fields.old_address).toBe('https://example.test/local-story')
})
it('refuses malformed, duplicate, ambiguous or unsafe source data before any merge can mark old records removed', () => {
  for (const value of [
    '%bad',
    '%7B',
    feed([raw(), raw()]),
    feed([raw(1, { published: 'ambiguous' })]),
    feed([raw(1, { publishDate: '2026-02-30' })]),
    feed([raw(1, { publishDate: '' })]),
    feed([raw(1, { description: '', synopsis: '' })]),
    feed([raw(1, { redirectUrl: 'javascript:alert(1)' })]),
    feed([raw(1, { headerImage: 'https://user:secret@example.test/p.jpg' })]),
    encodeURIComponent('{"different":[]}'),
  ])
    expect(() => parseSawsoStoriesFeed(value)).toThrow(StoryFeedFormatError)
  expect(parseSawsoStoriesFeed(feed([]))).toEqual([])
})
it('updates only fields still following their last source version, retaining CMS edits and body/photo/tag/review settings', () => {
  const previous = story(),
    current = entry(previous, {
      title: '[CMS title]',
      summary: '[CMS description]',
      published_date: '2026-10-30',
      old_address: 'https://example.test/edited',
      image_url: 'https://example.test/chosen-image.jpg',
    }),
    incoming = story('1', {
      title: '[New source title]',
      summary: '[New source description]',
      published_date: '2026-11-01',
      old_address: 'https://sawso.org/sawso/story/new-address',
      image_url: 'https://images.example.test/new.jpg',
    }),
    before = structuredClone(current),
    result = mergeStorySource([current], [baseline(previous)], [incoming], settings)
  expect(result.entries[0]).toEqual(before)
  expect(result.updated).toBe(0)
  expect(result.preserved.map(p => p.field)).toEqual(['title', 'summary', 'published_date', 'old_address', 'image_url'])
  expect(result.baselines[0]!.fields).toEqual(incoming.fields)
  expect(current).toEqual(before)
})
it('lets untouched source fields advance without changing a local article address, photo or manual tags', () => {
  const current = entry(),
    incoming = story('1', { title: '[Updated source title]', summary: '[Updated source description]' }),
    result = mergeStorySource([current], [baseline()], [incoming], settings)
  expect(result.updated).toBe(1)
  expect(result.entries[0]!.values).toEqual({
    ...current.values,
    title: incoming.fields.title,
    summary: incoming.fields.summary,
  })
  expect(result.entries[0]!.values.story_url).toBe('/stories/kept-address')
})
it('marks vanished imported records without deleting them or changing CMS-authored records and permits reappearance', () => {
  const imported = entry(),
    authored = { ...entry(story('cms')), stableKey: 'cms-written-story' },
    removed = mergeStorySource([imported, authored], [baseline()], [], settings)
  expect(removed.entries).toHaveLength(2)
  expect(removed.removed).toBe(1)
  expect(removed.entries[0]!.values.feed_removed).toBe(true)
  expect(removed.entries[1]).toEqual(authored)
  const back = mergeStorySource(removed.entries, removed.baselines, [story()], settings)
  expect(back.updated).toBe(1)
  expect(back.entries[0]!.values.feed_removed).toBe(false)
  expect(back.entries[0]!.values.hidden).toBe(true)
  expect(back.entries[0]!.values.reviewed).toBe(true)
})
it('suggests tags only for new records, supplies no sample content or borrowed photo, and plans a unique private article', () => {
  const fetch = vi.fn(() => {
    throw Error('No network in a merge')
  })
  vi.stubGlobal('fetch', fetch)
  const result = mergeStorySource([], [], [story()], settings, ['/stories/water-story', '/ways-we-help/health']),
    added = result.entries[0]!
  expect(result.added).toBe(1)
  expect(added.values).toMatchObject({
    tags: 'health',
    regions: 'africa',
    reviewed: false,
    hidden: false,
    feed_removed: false,
    body: '',
    body_is_sample: false,
    photo_is_sample: false,
    story_url: '/stories/water-story-2',
  })
  expect(added.values.photo).toBeUndefined()
  expect(added.values.sector_links).toBe('<a href="/ways-we-help/health">Health</a>')
  expect(result.newPages).toEqual([
    { stableKey: added.stableKey, path: '/stories/water-story-2', title: story().fields.title },
  ])
  expect(fetch).not.toHaveBeenCalled()
  const repeat = mergeStorySource(result.entries, result.baselines, [story()], settings)
  expect(repeat.added).toBe(0)
  expect(repeat.updated).toBe(0)
  expect(repeat.changed).toBe(false)
  expect(repeat.newPages).toEqual([])
})
it('never resuggests existing unreviewed tags and does not resurrect a human-archived imported story', () => {
  const current = entry(story(), { reviewed: false, tags: 'manual-campaign', regions: '', region: '' }),
    result = mergeStorySource([current], [baseline()], [story('1', { summary: 'Hospital support in Kenya' })], settings)
  expect(result.entries[0]!.values).toMatchObject({ tags: 'manual-campaign', regions: '', reviewed: false })
  const archived = mergeStorySource([], [baseline()], [story('1', { title: '[Changed while archived]' })], settings)
  expect(archived.added).toBe(0)
  expect(archived.entries).toEqual([])
  expect(archived.baselines).toEqual([baseline()])
})
it('does not churn absent optional empty fields and never changes the approved baseline input', () => {
  const old = story('1', { image_url: '' }),
    current = entry(old)
  delete current.values.image_url
  const before = structuredClone([current, baseline(old)]),
    result = mergeStorySource([current], [baseline(old)], [old], settings)
  expect(result.changed).toBe(false)
  expect(result.entries[0]).toEqual(current)
  expect([current, baseline(old)]).toEqual(before)
})
it('keeps distinct source identities and protects stable keys, existing page paths and collection bounds', () => {
  const first = story('A'),
    second = story('a'),
    result = mergeStorySource([], [], [first, second], settings)
  expect(result.entries.map(e => e.stableKey)).toEqual(['feed-a', 'feed-a-2'])
  expect(mergeStorySource([], [], [first], settings, [], ['feed-a']).entries[0]!.stableKey).toBe('feed-a-2')
  expect(new Set(result.newPages.map(p => p.path)).size).toBe(2)
  expect(() => mergeStorySource([], [], [first, first], settings)).toThrow(StoryFeedFormatError)
  expect(() => mergeStorySource([entry(), entry()], [baseline()], [story()], settings)).toThrow(StoryFeedFormatError)
  expect(() => mergeStorySource([], [baseline(), baseline()], [], settings)).toThrow(StoryFeedFormatError)
  const full = Array.from({ length: 2000 }, (_, i) => ({ ...entry(), stableKey: 'cms-' + i }))
  expect(() => mergeStorySource(full, [], [story()], settings)).toThrow(StoryFeedFormatError)
})

it('protects edits made before the first check by using the approved import snapshot rather than current drafts', () => {
  const known = initialSawsoSourceBaselines(sawsoStoryRows().map(row => row.stableKey))
  expect(initialSawsoSourceBaselines([])).toEqual([])
  expect(known).toHaveLength(34)
  const old = known[0]!,
    current = {
      id: 'imported',
      stableKey: old.stableKey,
      values: {
        ...old.fields,
        title: '[Edited before refresh existed]',
        body: '<p>[Retained article]</p>',
        tags: 'manual-campaign',
        reviewed: true,
      },
    },
    incoming: SourceStory = {
      sourceId: old.sourceId,
      alias: 'source',
      fields: { ...old.fields, title: '[New source title]' },
    }
  const result = mergeStorySource([current], known, [incoming], settings)
  expect(result.entries[0]!.values.title).toBe('[Edited before refresh existed]')
  expect(result.entries[0]!.values.body).toBe('<p>[Retained article]</p>')
  expect(result.preserved).toContainEqual({ sourceId: old.sourceId, field: 'title' })
  expect(Object.keys(old.fields).sort()).toEqual(
    ['title', 'summary', 'published_date', 'old_address', 'image_url'].sort(),
  )
})
