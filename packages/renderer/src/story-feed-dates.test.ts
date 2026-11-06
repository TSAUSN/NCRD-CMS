import { it, expect, vi, afterEach } from 'vitest'
import { compileSection } from './compile.ts'
import { renderSection } from './render.ts'
import { withStoryFeedDates, withStoryVisibility } from './story-feed-dates.ts'
import type { SlotDef } from '@cms/schema'
const id = (n: number) => '00000000-0000-4000-a000-' + String(n).padStart(12, '0')
const fields = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'published_date', label: 'Date', type: 'date', required: true },
]
const slot: SlotDef = {
  id: 'stories',
  kind: 'repeat',
  label: 'Stories',
  constraints: {
    collection: true,
    storyFeed: true,
    item: { unit: 'Story', fields: [{ id: 'title', kind: 'text', label: 'Title' }] },
  },
}
const compiled = compileSection({
  sourceHtml: '<div>{{#stories}}<article><h2>{{title}}</h2></article>{{/stories}}</div>',
  slots: [slot],
})
const envelope = (dates: string[]) => ({
  kind: 'collection',
  collectionId: id(1),
  readerKey: 'stories',
  publishedSchemaVersionId: id(2),
  publishedSchemaRevision: '1',
  publishedEntryRevision: '1',
  schemas: [{ id: id(2), revision: '1', fields: fields.map(field => ({ ...field })) }],
  entries: dates.map((date, i) => ({
    id: id(i + 10),
    stableKey: 'story-' + i,
    schemaVersionId: id(2),
    values: { title: 'Story ' + i, published_date: date },
  })),
})
const section = (value: unknown, slug = 'core-stories') => ({
  def: { section_def_id: id(1), version: 1, slug, compiled_ast: compiled.ast, slots: [slot] },
  instance: { section_def_id: id(1), section_def_version: 1, values: { stories: value } },
})
afterEach(() => vi.useRealTimers())
it('re-evaluates the same immutable feed on each render, before empty handling, without changing the snapshot', () => {
  const raw = envelope(['2025-09-30']),
    s = section(raw),
    before = structuredClone(s)
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T23:59:59Z'))
  expect(renderSection(s, 0)).toContain('Story 0')
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
  expect(renderSection(s, 0)).not.toContain('Story 0')
  expect(s).toEqual(before)
  const hidden = { ...s, instance: { ...s.instance, values: { ...s.instance.values, empty_mode: 'hide' } } }
  expect(renderSection(hidden, 0)).toBe('')
})
it('filters the Newsroom before pagination and preserves individual articles, other readers and unmarked repeats', () => {
  const raw = envelope([...Array(13).fill('2026-10-01'), ...Array(3).fill('2025-01-01')]),
    values = { stories: raw }
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'))
  const newsSlot: SlotDef = { ...slot, constraints: { ...slot.constraints, storyFeed: false } },
    paging: SlotDef = { id: 'paging', kind: 'richtext', label: 'Pages', constraints: {} }
  const template = compileSection({
    sourceHtml: '<div>{{#stories}}<article><h2>{{title}}</h2></article>{{/stories}}{{paging}}</div>',
    slots: [newsSlot, paging],
  })
  const s = section(raw, 'core-newsroom')
  s.def.compiled_ast = template.ast
  s.def.slots = [newsSlot, paging]
  const html = renderSection(s, 0, { newsroom: { page: '2' } })
  expect(html).toContain('Story 12')
  expect(html).not.toContain('Story 13')
  expect(html).toContain('Showing 1 of 13 stories')
  expect(withStoryFeedDates(values, [newsSlot], 'core-story-detail')).toBe(values)
  expect(withStoryFeedDates({ stories: { ...raw, readerKey: 'workshops' } }, [slot]).stories).toMatchObject({
    entries: raw.entries,
  })
  const filtered = withStoryFeedDates(values, [slot])
  expect((filtered.stories as typeof raw).entries).toHaveLength(13)
  expect(raw.entries).toHaveLength(16)
})
it('refuses a malformed envelope and never changes its projection into a trusted repeat', () => {
  const raw = { ...envelope(['2026-10-01']), extra: true },
    values = { stories: raw }
  expect(withStoryFeedDates(values, [slot])).toBe(values)
  expect(renderSection(section(raw), 0)).not.toContain('Story 0')
})

it('does not replace an aged-out collection with definition sample stories', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
  const raw = envelope(['2025-09-30']),
    samples = envelope(['2026-10-01'])
  samples.entries[0]!.values.title = '[Unwanted sample]'
  const s = section(raw)
  s.instance.values = { ...s.instance.values, __cms_sample_fields: ['stories'] } as typeof s.instance.values
  s.def.slots = [
    { ...slot, constraints: { ...slot.constraints, coreLibrary: 'r8', coreList: 'stories', coreListSamples: samples } },
  ]
  const html = renderSection(s, 0)
  expect(html).not.toContain('Story 0')
  expect(html).not.toContain('[Unwanted sample]')
})

it('uses one optional archive link for desktop and phone while preserving an older field-only choice', () => {
  const slots: SlotDef[] = ['newsroom', 'more'].map(id => ({ id, kind: 'link', label: id, constraints: {} })),
    built = compileSection({
      sourceHtml: '<p class="core-story-desktop-link">{{newsroom}}</p><p class="core-story-more">{{more}}</p>',
      slots,
    })
  const s = {
    def: { section_def_id: id(1), version: 1, slug: 'core-stories', compiled_ast: built.ast, slots },
    instance: {
      section_def_id: id(1),
      section_def_version: 1,
      values: {
        newsroom: { url: '/archive', label: 'Our archive' },
        more: { url: '/old-link', label: 'Older duplicate' },
      },
    },
  }
  const html = renderSection(s, 0)
  expect(html.match(/href="\/archive"/g)).toHaveLength(2)
  expect(html).not.toContain('/old-link')
  const preview = renderSection(s, 0, { preview: true })
  expect(preview.match(/data-cms-slot="newsroom"/g)).toHaveLength(2)
  expect(preview).not.toContain('data-cms-slot="more"')
  expect(
    renderSection(
      { ...s, instance: { ...s.instance, values: { ...s.instance.values, newsroom: { url: '', label: '' } } } },
      0,
    ),
  ).not.toContain('href=')
  const legacy = { ...s, instance: { ...s.instance, values: { more: { url: '/older-archive', label: 'Archive' } } } }
  expect(renderSection(legacy, 0)).toContain('href="/older-archive"')
  expect(s.instance.values.more.url).toBe('/old-link')
})

it('removes explicitly hidden/source-removed stories in nested manual placements without ageing direct articles', () => {
  const raw = envelope(['1999-01-01', '2099-01-01', '2026-10-01', '2026-10-01', '2026-10-01'])
  raw.schemas[0]!.fields.push(
    ...['hidden', 'feed_removed', 'in_feed'].map(key => ({ key, label: key, type: 'boolean', required: false })),
  )
  Object.assign(raw.entries[2]!.values, { hidden: true })
  Object.assign(raw.entries[3]!.values, { feed_removed: true })
  Object.assign(raw.entries[4]!.values, { in_feed: false })
  const input = { card: { story: raw } },
    before = structuredClone(input),
    next = withStoryVisibility(input)
  expect(next.card.story.entries.map(row => row.stableKey)).toEqual(['story-0', 'story-1'])
  expect(input).toEqual(before)
  expect(withStoryVisibility(next)).toBe(next)
  expect(withStoryVisibility({ ...raw, readerKey: 'resources' })).toEqual({ ...raw, readerKey: 'resources' })
  const s = section(raw, 'core-story-detail')
  s.def.slots = [{ ...slot, constraints: { ...slot.constraints, storyFeed: false } }]
  const html = renderSection(s, 0)
  expect(html).toContain('Story 0')
  expect(html).toContain('Story 1')
  expect(html).not.toContain('Story 2')
})
it('never fills a deliberately emptied manual Story with definition sample content', () => {
  const raw = envelope(['2026-10-01'])
  raw.schemas[0]!.fields.push({ key: 'hidden', label: 'Hidden', type: 'boolean', required: false })
  Object.assign(raw.entries[0]!.values, { hidden: true })
  const samples = envelope(['2026-10-01'])
  samples.entries[0]!.values.title = '[Unwanted sample]'
  const s = section(raw, 'core-story-detail')
  s.instance.values = { ...s.instance.values, __cms_sample_fields: ['stories'] } as typeof s.instance.values
  s.def.slots = [
    {
      ...slot,
      constraints: {
        ...slot.constraints,
        storyFeed: false,
        coreLibrary: 'r8',
        coreList: 'stories',
        coreListSamples: samples,
      },
    },
  ]
  const html = renderSection(s, 0, { preview: true })
  expect(html).not.toContain('Story 0')
  expect(html).not.toContain('[Unwanted sample]')
})

it('removes the whole empty canonical Story section without an empty public container', () => {
  const raw = envelope(['2026-10-01'])
  raw.schemas[0]!.fields.push({ key: 'hidden', label: 'Hidden', type: 'boolean', required: false })
  Object.assign(raw.entries[0]!.values, { hidden: true })
  const storySlot = { ...slot, id: 'story', constraints: { ...slot.constraints, storyFeed: false } },
    compiled = compileSection({ sourceHtml: '<div>{{#story}}<h1>{{title}}</h1>{{/story}}</div>', slots: [storySlot] }),
    s = {
      def: {
        section_def_id: id(1),
        version: 1,
        slug: 'core-story-detail',
        compiled_ast: compiled.ast,
        slots: [storySlot],
      },
      instance: { section_def_id: id(1), section_def_version: 1, values: { story: raw } },
    }
  expect(renderSection(s, 0)).toBe('')
  expect(renderSection(s, 0, { preview: true })).not.toContain('Story 0')
})

it('bounds visibility traversal before the renderer validates untrusted nested values', () => {
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  expect(withStoryVisibility(cyclic)).toBe(cyclic)
})
