import { it, expect } from 'vitest'
import { resolvedCollection } from './structured.ts'
import {
  storyWorldValues,
  renderStoryWorld,
  storyWidgetQuery,
  storyWidgetHref,
  storyCardLabels,
} from './story-world.ts'
import map from './story-world-map.json' with { type: 'json' }
const id = '00000000-0000-4000-8000-000000000001',
  catalog = {
    mainLabel: 'Programs',
    secondaryLabel: 'Areas',
    mainTags: [{ id: 'food', label: 'Food' }],
    secondaryTags: [
      { id: 'east', label: 'Eastern area', areas: ['asia'] },
      { id: 'south', label: 'Southern area', areas: ['africa'] },
      { id: 'empty', label: 'No stories', areas: ['europe'] },
    ],
  },
  entries = [
    { id, stableKey: 'one', schemaVersionId: id, values: { title: 'One', regions: 'east,south' } },
    {
      id: '00000000-0000-4000-8000-000000000002',
      stableKey: 'two',
      schemaVersionId: id,
      values: { title: 'Two', region: 'south' },
    },
  ],
  list = {
    kind: 'collection',
    collectionId: id,
    readerKey: 'stories',
    publishedSchemaVersionId: id,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [
      {
        id,
        revision: '1',
        fields: [
          { key: 'title', label: 'Title', type: 'text', required: true },
          { key: 'regions', label: 'Areas', type: 'text', required: false },
          { key: 'region', label: 'Area', type: 'text', required: false },
        ],
      },
    ],
    entries,
    storyCatalog: catalog,
  }
const shown = (model: ReturnType<typeof storyWorldValues>) => (model.values.stories as { entries: unknown[] }).entries
it('keeps the approved six-area geometry, source declaration and regional coordinates', () => {
  expect(map.source).toBe('Natural Earth 1:110m (public domain)')
  expect([map.width, map.height]).toEqual([1000, 435])
  expect(map.areas).toHaveLength(6)
  for (const area of map.areas) {
    expect(area.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/)
    expect(area.x).toBeGreaterThan(0)
    expect(area.x).toBeLessThan(map.width)
  }
})
it('counts by saved region rather than country, keeps empty land grey and supports multiregion and legacy entries', () => {
  const model = storyWorldValues({ stories: list }, 0, { path: '/map' })
  expect(model.map).toContain('Eastern area: 1 story')
  expect(model.map).toContain('Southern area: 2 stories')
  expect(model.map).not.toContain('No stories: 0 stories')
  expect(model.map).toContain('cms-story-map-land')
  expect(model.values.region_links).toContain('aria-disabled="true">No stories (0)')
  expect(model.active).toBe('')
  expect(shown(model)).toHaveLength(0)
})
it('uses the configured start or this widget query, applies its card limit, and preserves the source envelope', () => {
  const before = structuredClone(list),
    first = storyWorldValues({ stories: list, start_region: 'east' }, 1),
    next = storyWorldValues({ stories: list, start_region: 'east', per_region: '1' }, 1, {
      path: '/map',
      query: { story1_region: 'south', story0_region: 'east' },
    })
  expect(first.active).toBe('east')
  expect(first.values.region_heading).toBe('Our Stories from Eastern area')
  expect(shown(next)).toHaveLength(1)
  expect(next.values.region_links).toContain('story0_region=east')
  expect(next.values.region_links).toContain('story1_region=south')
  expect(list).toEqual(before)
  expect(storyWorldValues({ stories: list, start_region: 'empty' }, 1).active).toBe('')
})
it('keeps widget query state separate and private-preview parameters intact, with only root-relative paths', () => {
  expect(
    storyWidgetQuery(
      new URLSearchParams('story0_region=east&story1_region=south&source=https://other.test&story0_bad=x'),
    ),
  ).toEqual({ story0_region: 'east', story1_region: 'south' })
  expect(
    storyWidgetHref(
      1,
      { path: '/preview/version', fixedQuery: { visit: '1', lists: 'draft' }, query: { story0_region: 'east' } },
      { region: 'south' },
    ),
  ).toBe('/preview/version?visit=1&lists=draft&story0_region=east&story1_region=south#s1')
  expect(storyWidgetHref(0, { path: '//other.test' }, { region: 'east' })).toBe('/?story0_region=east#s0')
})
it('shows public empty copy or an editorial setup action without exposing source settings', () => {
  const publicState = storyWorldValues({}, 0),
    editorial = storyWorldValues({}, 0, { editing: true })
  expect(publicState.values.hint).toBe('Stories will appear here soon.')
  expect(editorial.values.hint).toContain('Site admin')
  expect(publicState.map).not.toContain('data-cms-story-region=')
})
it('inserts only generated map/navigation text, removes an unselected result container, and escapes site labels', () => {
  const html =
      '<section class="core-story-world"><div class="core-world-map"></div><nav class="core-world-regions"></nav><p class="core-world-hint"></p><div class="core-world-results"><h3 class="core-world-region-heading"></h3><b>Project sector</b><b>Region</b></div></section>',
    none = renderStoryWorld(html, 0, storyWorldValues({ stories: list }, 0)),
    chosen = renderStoryWorld(html, 0, storyWorldValues({ stories: list, start_region: 'south' }, 0))
  expect(none).toContain('data-cms-stories-widget="0"')
  expect(none).toContain('<svg')
  expect(none).not.toContain('core-world-results')
  expect(chosen).toContain('Our Stories from Southern area')
  expect(chosen).toContain('<b>Programs</b><b>Areas</b>')
  const hostile = storyWorldValues(
    {
      stories: {
        ...list,
        storyCatalog: { ...catalog, secondaryTags: [{ ...catalog.secondaryTags[0], label: '<script>bad</script>' }] },
      },
      start_region: 'east',
    },
    0,
  )
  expect(hostile.map).toContain('&lt;script&gt;')
  expect(hostile.map).not.toContain('<script>')
})
it('caps SAWSO sector maps at six after counting, including private preview paths, while generic sites keep their chosen limit', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
      id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      stableKey: 'item-' + i,
      schemaVersionId: id,
      values: { title: 'Item ' + i, regions: 'east' },
    })),
    values = {
      stories: { ...list, entries: many, storyCatalog: { ...catalog, sectorPageLimit: 6 } },
      start_region: 'east',
      per_region: '200',
    }
  const sector = storyWorldValues(values, 0, { path: '/preview/version', pagePath: '/ways-we-help/health' })
  expect(shown(sector)).toHaveLength(6)
  expect(sector.map).toContain('Eastern area: 10 stories')
  expect(sector.values.region_links).toContain('/preview/version?story0_region=east')
  expect(shown(storyWorldValues(values, 0, { path: '/newsroom' }))).toHaveLength(10)
  expect(
    shown(storyWorldValues({ ...values, stories: { ...list, entries: many } }, 0, { path: '/ways-we-help/health' })),
  ).toHaveLength(10)
})

it('counts and displays beyond200 through the full supported Story source, keeping ordinary envelopes bounded', () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({
      id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      stableKey: 'item-' + i,
      schemaVersionId: id,
      values: { title: 'Item ' + i, regions: 'east' },
    })),
    source = { ...list, entries: many },
    model = storyWorldValues({ stories: source, start_region: 'east', per_region: '200' }, 0, { path: '/map' })
  expect(model.map).toContain('Eastern area: 2000 stories')
  expect(shown(model)).toHaveLength(2000)
  expect((shown(model).at(-1) as (typeof many)[number]).stableKey).toBe('item-1999')
  const refused = storyWorldValues({ stories: { ...source, readerKey: 'resources' }, start_region: 'east' }, 0)
  expect(refused.catalog).toBeUndefined()
  expect(resolvedCollection({ ...source, readerKey: 'resources' })).toBeNull()
  expect(
    resolvedCollection({
      ...source,
      entries: [...many, { ...many[0]!, id: '00000000-0000-4000-8000-000000009999', stableKey: 'extra' }],
    }),
  ).toBeNull()
})

it('keeps dollar-sign sequences literal in site-owned Story tag headings', () => {
  for (const label of ['Tag $`', 'Tag $&', "Tag $'", 'Tag $$', 'Tag $1']) {
    expect(
      storyCardLabels('<aside><b>Project sector</b><b>Region</b></aside>', {
        mainLabel: label,
        secondaryLabel: label,
        mainTags: [],
        secondaryTags: [],
      }),
    ).toBe('<aside><b>' + label.replaceAll('&', '&amp;') + '</b><b>' + label.replaceAll('&', '&amp;') + '</b></aside>')
  }
})
