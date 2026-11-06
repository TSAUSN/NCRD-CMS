import { it, expect } from 'vitest'
import { emptyStoriesSettings, type StoriesSettings } from '@cms/schema'
import {
  storyPlacement,
  storyPlacementFeeds,
  storyPlacementFields,
  type StoryPlacementContext,
  type StoryPlacementPage,
  type StoryPlacementRow,
} from './story-placement.ts'
const settings: StoriesSettings = {
  ...emptyStoriesSettings(),
  mainLabel: 'Programs',
  secondaryLabel: 'Areas',
  mainTags: [
    { id: 'food', label: 'Food', keywords: [] },
    { id: 'homes', label: 'Homes', keywords: [] },
  ],
  secondaryTags: [
    { id: 'east', label: 'Eastern area', keywords: [], areas: ['asia'] },
    { id: 'south', label: 'Southern area', keywords: [], areas: ['africa'] },
  ],
}
const own = { id: 'candidate', stableKey: 'story-candidate', createdAt: '2026-10-01T00:00:00.000Z', sortIndex: 20 },
  values = { title: '[Story]', published_date: '2026-10-25', tags: 'food', regions: 'south', reviewed: true },
  slugs = new Map([
    ['feed', 'core-stories'],
    ['world', 'core-story-world'],
    ['split', 'core-story-split'],
  ])
const binding = (limit = 200, extra = {}) => ({
  readerKey: 'stories',
  selection: { mode: 'automatic', dateField: 'published_date', maxAgeMonths: 13, limit, ...extra },
})
const section = (kind: string, extra = {}) => ({
  section_def_id: kind,
  hidden: false,
  hidden_at: [],
  values: { heading: '[Saved heading]', stories: binding(), ...extra },
})
function page(id: string, kind = 'feed', extra = {}, path = '/' + id): StoryPlacementPage {
  return { id, title: '[' + id + ']', path, article: false, feeds: storyPlacementFeeds([section(kind, extra)], slugs) }
}
function context(pages: StoryPlacementPage[], rows: StoryPlacementRow[] = []): StoryPlacementContext {
  return {
    pages,
    rows,
    candidate: own,
    hasArticle: true,
    privateSite: false,
    readAt: '2026-10-31T12:00:00.000Z',
    fields: storyPlacementFields(pages),
  }
}
const row = (n: number, area = 'east', tag = 'food'): StoryPlacementRow => ({
  id: 'other-' + n,
  stableKey: 'story-' + n,
  createdAt: '2026-10-01T00:00:00.000Z',
  sortIndex: n,
  values: { published_date: '2026-10-30', tags: tag, regions: area, reviewed: true },
})
it('uses actual headings, tag groups, date ordering and page display limits instead of site-name guesses', () => {
  const pages = [
    page('small', 'feed', { stories: binding(1) }),
    page('matching', 'feed', { stories: binding(6, { storyTags: { main: ['food'], secondary: ['south'] } }) }),
    page('different', 'feed', { stories: binding(6, { storyTags: { main: ['food'], secondary: ['east'] } }) }),
  ]
  const projected = storyPlacement(context(pages, [row(1)]), values, settings)
  expect(projected.places.map(place => place.id)).toEqual(['matching'])
  expect(projected.places[0]!.views).toEqual(['[Saved heading]'])
  expect(JSON.stringify(projected)).not.toMatch(/SAWSO|Newsroom|Home ·/)
})
it('shares widget view selection, region limits, reachable Show more and the SAWSO sector cap after region filtering', () => {
  const pages = [
      page('world', 'world', { per_region: '6' }, '/ways-we-help/food'),
      page('one-region', 'world', { per_region: '1' }),
      page('news', 'split', { page_size: '3' }),
      page('sector', 'split', { page_size: '3' }, '/ways-we-help/food'),
    ],
    rows = [...Array.from({ length: 7 }, (_, i) => row(i, 'east', 'homes')), row(8, 'south')],
    sawso = { ...settings, source: 'sawso' as const }
  const projected = storyPlacement(context(pages, rows), values, sawso),
    byId = new Map(projected.places.map(place => [place.id, place.views]))
  expect(byId.get('world')).toContain('By Map · Southern area')
  expect(byId.has('one-region')).toBe(false)
  expect(byId.get('news')).toContain('Recently Published · after Show more stories')
  expect(byId.get('sector')).not.toContain('Recently Published · after Show more stories')
  expect(byId.get('sector')).toEqual(expect.arrayContaining(['By Programs · Food', 'By Map · Southern area']))
})
it('checks hidden, removed and review rules and describes future dates at their actual UTC day', () => {
  const ctx = context([page('feed')])
  for (const changed of [{ hidden: true }, { feed_removed: true }, { in_feed: false }])
    expect(storyPlacement(ctx, { ...values, ...changed }, settings).places).toEqual([])
  const reviewed = { ...settings, publishUnreviewed: false }
  expect(storyPlacement(ctx, { ...values, reviewed: false }, reviewed).reason).toMatch(/Reviewed in Stories/)
  expect(storyPlacement(ctx, { ...values, published_date: '' }, settings).reason).toMatch(/Choose a story date/)
  expect(storyPlacement(ctx, { ...values, published_date: '2026-02-31' }, settings).places).toEqual([])
  expect(storyPlacement(ctx, { ...values, published_date: '2025-01-01' }, settings).reason).toMatch(/13-month/)
  expect(storyPlacement(ctx, { ...values, published_date: '2026-11-04' }, settings)).toMatchObject({
    future: true,
    asOf: '2026-11-04',
    places: [{ id: 'feed' }],
  })
})
it('omits disabled sections, describes breakpoint restrictions and finds nested story bindings', () => {
  const hidden = section('feed')
  hidden.hidden = true
  const all = { ...section('feed'), hidden_at: ['sm', 'md', 'lg'] },
    some = { ...section('feed'), hidden_at: ['sm'] },
    nested = { ...section('feed'), values: { heading: '[Nested feed]', cards: [{ binding: binding(6) }] } }
  expect(storyPlacementFeeds([hidden, all], slugs)).toEqual([])
  const p = page('responsive')
  p.feeds = storyPlacementFeeds([some, nested], slugs)
  expect(storyPlacement(context([p]), values, settings).places[0]!.views).toEqual(
    expect.arrayContaining(['[Saved heading] (hidden on phones)', '[Nested feed]']),
  )
})
it('uses real creation order and includes custom filter fields in the editor refresh signature', () => {
  const p = page('custom', 'feed', {
      stories: binding(1, {
        dateField: undefined,
        maxAgeMonths: undefined,
        order: 'newest',
        filter: { field: 'countries', value: '[Country]' },
      }),
    }),
    other = { ...row(1), createdAt: '2026-10-29T00:00:00.000Z', values: { ...row(1).values, countries: '[Country]' } }
  expect(storyPlacementFields([p])).toContain('countries')
  expect(storyPlacement(context([p], [other]), { ...values, countries: '[Country]' }, settings).places).toEqual([])
  expect(
    storyPlacement(context([p]), { ...values, countries: '[Country]' }, settings).places.map(place => place.id),
  ).toEqual(['custom'])
})
it('keeps related-article feeds separate and explains incomplete map settings without claiming a pin', () => {
  const related = { ...page('related'), article: true },
    map = page('map', 'world'),
    catalog = { ...settings, secondaryTags: [{ ...settings.secondaryTags[1]!, areas: [] }] }
  const projected = storyPlacement(context([related, map]), values, catalog)
  expect(projected.places.map(place => place.id)).toEqual(['map', 'related'])
  expect(projected.places[0]!.views).toContain('Region list (map area not set) · Southern area')
})

it('uses the pinned definition date opt-in for manually selected cards without treating every manual story as a feed', () => {
  const manual = { readerKey: 'stories', selection: { mode: 'manual', stableKeys: [own.stableKey] } },
    sectionValue = { ...section('feed', { stories: manual }), section_def_version: 4 },
    declared = new Map([['feed:4', [{ id: 'stories', kind: 'repeat' as const, constraints: { storyFeed: true } }]]])
  const current = page('manual')
  current.feeds = storyPlacementFeeds([sectionValue], slugs, declared)
  expect(storyPlacement(context([current]), { ...values, published_date: '2025-01-01' }, settings).places).toEqual([])
  const ordinary = new Map([['feed:4', [{ id: 'stories', kind: 'repeat' as const, constraints: {} }]]])
  current.feeds = storyPlacementFeeds([sectionValue], slugs, ordinary)
  expect(
    storyPlacement(context([current]), { ...values, published_date: '2025-01-01' }, settings).places.map(
      place => place.id,
    ),
  ).toEqual(['manual'])
})

it('includes an older story beyond200 in complete widget pools without widening ordinary feed limits', () => {
  const pages = [
      page('world', 'world', { per_region: '200' }),
      page('news', 'split', { page_size: '6' }),
      page('ordinary'),
    ],
    ctx = context(
      pages,
      Array.from({ length: 200 }, (_, i) => row(i)),
    )
  ctx.candidate = { ...own, sortIndex: 201 }
  const projected = storyPlacement(ctx, values, settings),
    ids = projected.places.map(place => place.id)
  expect(ids).toContain('world')
  expect(ids).toContain('news')
  expect(ids).not.toContain('ordinary')
  expect(projected.places.find(place => place.id === 'news')!.views).toContain(
    'Recently Published · after Show more stories',
  )
})
