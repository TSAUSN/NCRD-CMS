import { it, expect } from 'vitest'
import { storySplitValues, renderStorySplit } from './story-split.ts'
const id = '00000000-0000-4000-8000-000000000001',
  catalog = {
    mainLabel: 'Project Sectors',
    secondaryLabel: 'Regions',
    mainTags: [
      { id: 'health', label: 'Health' },
      { id: 'food', label: 'Food' },
      { id: 'empty', label: 'Empty' },
    ],
    secondaryTags: [
      { id: 'east', label: 'Eastern area', areas: ['asia'] },
      { id: 'south', label: 'Southern area', areas: ['africa'] },
    ],
  },
  entries = Array.from({ length: 18 }, (_, i) => ({
    id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
    stableKey: 'story-' + i,
    schemaVersionId: id,
    values: {
      title: 'Story ' + i,
      published_date: '2026-10-' + String(i + 1).padStart(2, '0'),
      tags: i % 2 ? 'health,food' : 'health',
      regions: i % 3 ? 'south' : 'east,south',
    },
  })),
  list = {
    kind: 'collection',
    collectionId: id,
    readerKey: 'stories',
    publishedSchemaVersionId: id,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [{ id, revision: '1', fields: [{ key: 'title', label: 'Title', type: 'text', required: true }] }],
    entries,
    storyCatalog: catalog,
  }
const shown = (m: ReturnType<typeof storySplitValues>) => (m.values.stories as typeof list).entries
it('uses configured and direct views while keeping other widgets and private preview parameters separate', () => {
  const configured = storySplitValues({ stories: list, start_view: 'sectors' }, 1, {
      path: '/preview/version',
      fixedQuery: { visit: '1' },
      query: { story0_region: 'east' },
    }),
    direct = storySplitValues({ stories: list, start_view: 'recent' }, 1, {
      path: '/news',
      query: { story1_view: 'map', story1_region: 'east' },
    })
  expect(configured.view).toBe('sectors')
  expect(configured.tabs).toContain('visit=1&amp;story0_region=east&amp;story1_view=map')
  expect(direct.view).toBe('map')
  expect(direct.active).toBe('east')
  expect(storySplitValues({ stories: list, start_view: 'map' }, 1, { query: { story1_view: 'invalid' } }).view).toBe(
    'map',
  )
})
it('sorts newest first and Show more grows by the chosen size without exceeding the source or trusting an unbounded page', () => {
  const first = storySplitValues({ stories: list, page_size: '6' }, 0),
    next = storySplitValues({ stories: list, page_size: '6' }, 0, { path: '/news', query: { story0_page: '2' } }),
    last = storySplitValues({ stories: list, page_size: '6' }, 0, { query: { story0_page: '999' } })
  expect(shown(first)).toHaveLength(6)
  expect(shown(first)[0]!.stableKey).toBe('story-17')
  expect(first.more).toContain('Showing 6 of 18')
  expect(first.more).toContain('story0_page=2')
  expect(shown(next)).toHaveLength(12)
  expect(shown(last)).toHaveLength(18)
  expect(last.more).not.toContain('Show more stories')
  expect(
    shown(storySplitValues({ stories: list, page_size: '6' }, 0, { query: { story0_page: '999999999999' } })),
  ).toHaveLength(6)
})
it('counts multi-tag stories for each main tag, omits empty tiles and shows only the selected sector', () => {
  const none = storySplitValues({ stories: list, start_view: 'sectors' }, 0),
    food = storySplitValues({ stories: list }, 0, { query: { story0_view: 'sectors', story0_sector: 'food' } })
  expect(none.sectors).toContain('18 stories')
  expect(none.sectors).toContain('9 stories')
  expect(none.sectors).not.toContain('Empty')
  expect(none.values.hint).toBe('Choose a project sector to see its stories.')
  expect(none.active).toBe('')
  expect(shown(food)).toHaveLength(9)
  expect(food.values.region_heading).toBe('Our Stories in Food')
  expect(food.sectors).toContain('aria-current="true"')
})
it('reuses region geometry and multi-region counts in Map with a normal region URL', () => {
  const map = storySplitValues({ stories: list, start_view: 'map' }, 0, {
    path: '/news',
    query: { story0_region: 'east' },
  })
  expect(map.map).toContain('Eastern area: 6 stories')
  expect(map.map).toContain('Southern area: 18 stories')
  expect(shown(map)).toHaveLength(6)
  expect(map.values.region_heading).toBe('Our Stories from Eastern area')
  expect(map.map).toContain('story0_region=south')
  expect(map.more).toBe('')
})
it('enforces the pinned sector cap across all three views using the content page rather than private preview address', () => {
  const source = { ...list, storyCatalog: { ...catalog, sectorPageLimit: 6 } }
  for (const view of ['recent', 'sectors', 'map']) {
    const model = storySplitValues({ stories: source, start_view: view }, 0, {
      path: '/preview/version',
      pagePath: '/ways-we-help/health',
      query: { story0_sector: 'health', story0_region: 'south', story0_page: '999' },
    })
    expect(shown(model)).toHaveLength(6)
    expect(model.map).toContain('Southern area: 18 stories')
  }
})
it('inserts only escaped generated controls, keeps ordinary links without scripts and removes irrelevant map/empty result boxes', () => {
  const html =
      '<div class="core-story-split"><nav class="core-split-views"></nav><div class="core-split-stage"><div class="core-split-tools"></div><div class="core-split-sectors"></div><div class="core-split-map"><div class="core-world-map"></div><nav class="core-world-regions"></nav></div><p class="core-world-hint"></p><div class="core-world-results"><h3 class="core-world-region-heading"></h3><article>Card</article></div><div class="core-split-more"></div></div></div>',
    recent = renderStorySplit(html, 0, storySplitValues({ stories: list }, 0)),
    sector = renderStorySplit(html, 0, storySplitValues({ stories: list, start_view: 'sectors' }, 0)),
    hostile = renderStorySplit(
      html,
      0,
      storySplitValues(
        {
          stories: {
            ...list,
            storyCatalog: { ...catalog, mainTags: [{ id: 'health', label: '<script>bad</script>' }] },
          },
          start_view: 'sectors',
        },
        0,
      ),
    )
  expect(recent).toContain('data-cms-story-kind="split"')
  expect(recent).toContain('Show more stories')
  expect(recent).toContain('role="switch"')
  expect(recent).not.toContain('core-split-map')
  expect(recent).not.toContain('core-world-region-heading')
  expect(recent).not.toContain('<script')
  expect(sector).not.toContain('core-world-results')
  expect(sector.indexOf('core-split-prompt')).toBeLessThan(sector.indexOf('class="core-split-sector"'))
  expect(hostile).toContain('&lt;script&gt;')
  expect(hostile).not.toContain('<script>')
})
it('uses site-owned names and plain empty states without exposing private source configuration', () => {
  const renamed = storySplitValues(
      { stories: { ...list, storyCatalog: { ...catalog, mainLabel: 'Programs', secondaryLabel: 'Areas' } } },
      0,
    ),
    empty = storySplitValues({ stories: { ...list, entries: [] } }, 0),
    missing = storySplitValues({}, 0, { editing: true })
  expect(renamed.tabs).toContain('By Programs')
  expect(renamed.tools).toContain('Areas')
  expect(empty.values.hint).toContain('No current stories')
  expect(empty.more).toBe('')
  expect(missing.values.hint).toContain('Site admin')
  expect(JSON.stringify(empty)).not.toContain('sourceConfiguration')
})

it('opens earlier sector, region and view links without changing other widgets, and keeps scoped links authoritative', () => {
  const sector = storySplitValues(
      { stories: list },
      2,
      { path: '/news', query: { story0_region: 'east' } },
      { sector: 'food' },
    ),
    region = storySplitValues({ stories: list }, 2, {}, { region: 'south' }),
    view = storySplitValues({ stories: list }, 2, {}, { view: 'regions' }),
    scoped = storySplitValues({ stories: list }, 2, { query: { story2_view: 'recent' } }, { sector: 'food' })
  expect(sector.view).toBe('sectors')
  expect(shown(sector)).toHaveLength(9)
  expect(sector.tabs).toContain('story0_region=east')
  expect(sector.tabs).toContain('story2_sector=food')
  expect(region.view).toBe('map')
  expect(region.active).toBe('south')
  expect(view.view).toBe('map')
  expect(scoped.view).toBe('recent')
  expect(shown(scoped)).toHaveLength(12)
})
it('keeps earlier combined tag and text links useful, escapes the search caption and offers an ordinary clear link', () => {
  const combined = storySplitValues({ stories: list }, 0, { path: '/news' }, { sector: 'food', region: 'east' }),
    search = storySplitValues({ stories: list }, 0, { path: '/news' }, { q: 'Story 17' }),
    escaped = storySplitValues({ stories: list }, 0, { path: '/news' }, { q: '<script>' })
  expect(shown(combined)).toHaveLength(3)
  expect(search.values.stories).toMatchObject({ entries: [{ stableKey: 'story-17' }] })
  expect(search.tabs).toContain('q=Story+17')
  expect(search.searchNotice).toContain('Show all stories')
  expect(search.searchNotice).not.toContain('q=')
  expect(escaped.searchNotice).toContain('&lt;script&gt;')
  expect(escaped.searchNotice).not.toContain('<script>')
})
it('treats an earlier page number as a bounded Show more step and ignores unknown earlier tags', () => {
  expect(shown(storySplitValues({ stories: list, page_size: '6' }, 0, {}, { page: '2' }))).toHaveLength(12)
  expect(shown(storySplitValues({ stories: list, page_size: '6' }, 0, {}, { page: '9999' }))).toHaveLength(6)
  expect(storySplitValues({ stories: list }, 0, {}, { sector: 'missing', region: 'missing' }).view).toBe('recent')
})

it('keeps counts and cumulative Show more complete beyond200', () => {
  const many = Array.from({ length: 201 }, (_, i) => ({
      id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      stableKey: 'many-' + i,
      schemaVersionId: id,
      values: { title: 'Many ' + i, published_date: '2026-10-31', tags: 'food', regions: 'east' },
    })),
    source = { ...list, entries: many },
    last = storySplitValues({ stories: source, page_size: '6' }, 0, {
      path: '/newsroom',
      query: { story0_page: '34' },
    }),
    sectors = storySplitValues({ stories: source }, 0, { query: { story0_view: 'sectors', story0_sector: 'food' } })
  expect(shown(last)).toHaveLength(201)
  expect(last.more).toContain('Showing 201 of 201 stories')
  expect(last.more).not.toContain('Show more stories')
  expect(sectors.sectors).toContain('201 stories')
  expect(shown(sectors)).toHaveLength(201)
})

it('pins featured stories only in recent news, preserving sector, map and six-story sector-page date order', () => {
  const source = {
    ...list,
    entries: entries.map((entry, index) =>
      index === 0 ? { ...entry, values: { ...entry.values, newsroom_rank: 1 } } : entry,
    ),
  }
  expect(shown(storySplitValues({ stories: source, page_size: '6' }, 0))[0]?.stableKey).toBe('story-0')
  expect(
    shown(
      storySplitValues(
        { stories: { ...source, storyCatalog: { ...catalog, newsroomOrder: false } }, page_size: '6' },
        0,
        { path: '/program-updates' },
      ),
    )[0]?.stableKey,
  ).toBe('story-17')
  expect(
    shown(storySplitValues({ stories: source }, 0, { query: { story0_view: 'sectors', story0_sector: 'health' } }))[0]
      ?.stableKey,
  ).toBe('story-17')
  expect(
    shown(storySplitValues({ stories: source }, 0, { query: { story0_view: 'map', story0_region: 'south' } }))[0]
      ?.stableKey,
  ).toBe('story-17')
  expect(
    shown(
      storySplitValues({ stories: { ...source, storyCatalog: { ...catalog, sectorPageLimit: 6 } } }, 0, {
        pagePath: '/ways-we-help/health',
      }),
    )[0]?.stableKey,
  ).toBe('story-17')
})
