import { emptyStoriesSettings } from '@cms/schema'
import { describe, expect, it } from 'vitest'
import type { StructuredRepeatFieldNode } from '@cms/schema'
import {
  selectListRows,
  collectionBindingProblem,
  moveCollectionEntry,
  readCollectionBinding,
  toggleCollectionEntry,
} from './collection-binding.ts'

const repeat: StructuredRepeatFieldNode = {
  type: 'repeat',
  field: 'resources',
  empty: { behavior: 'hide' },
  item: [
    {
      type: 'element',
      tag: 'article',
      children: [
        { type: 'text', field: 'title' },
        { type: 'link', field: 'resource_url' },
        { type: 'image', field: 'thumbnail' },
      ],
    },
  ],
}
describe('typed collection binding controls', () => {
  it('checks every repeated field, including URL-to-link compatibility', () => {
    const fields = [
      { key: 'title', type: 'text', label: 'Title', required: true },
      { key: 'resource_url', type: 'url', label: 'Open resource', required: true },
      { key: 'thumbnail', type: 'image', label: 'Image', required: false },
    ] as const
    expect(collectionBindingProblem(repeat, fields)).toBeNull()
    expect(collectionBindingProblem(repeat, fields.slice(0, 2))).toContain('thumbnail')
    expect(collectionBindingProblem(repeat, [{ ...fields[0], type: 'richtext' }, ...fields.slice(1)])).toContain(
      'title',
    )
  })
  it('reads valid stored bindings without treating a resolved preview or accidental text as authoring state', () => {
    const binding = { readerKey: 'resources', selection: { mode: 'manual', stableKeys: ['second', 'first'] } }
    expect(readCollectionBinding(binding)).toEqual(binding)
    for (const value of [
      '[object Object]',
      null,
      { kind: 'collection', readerKey: 'resources' },
      { readerKey: 'resources', selection: { mode: 'automatic', limit: 201 } },
      { readerKey: 'resources', selection: { mode: 'manual', stableKeys: ['first', 'first'] } },
    ])
      expect(readCollectionBinding(value)).toBeNull()
  })
  it('preserves manual order, prevents duplicates and caps selection at the actual renderer limit', () => {
    expect(toggleCollectionEntry(['b', 'a'], 'a', true)).toEqual(['b', 'a'])
    expect(toggleCollectionEntry(['b', 'a'], 'c', true)).toEqual(['b', 'a', 'c'])
    expect(toggleCollectionEntry(['b', 'a'], 'b', false)).toEqual(['a'])
    const full = Array.from({ length: 200 }, (_, index) => `item-${index}`)
    expect(toggleCollectionEntry(full, 'overflow', true)).toEqual(full)
    expect(moveCollectionEntry(['b', 'a'], 0, 1)).toEqual(['a', 'b'])
    expect(moveCollectionEntry(['b', 'a'], 0, -1)).toEqual(['b', 'a'])
  })
})

it('keeps newest and exact tag matching dynamic, stable and bounded without mutating list order', () => {
  const rows = [
    { id: 'a', stableKey: 'first', createdAt: '2026-01-01', values: { tags: 'Family, Community', track: 'Community' } },
    { id: 'b', stableKey: 'second', createdAt: '2026-02-01', values: { tags: 'community-based', track: 'Wellbeing' } },
    { id: 'c', stableKey: 'third', createdAt: '2026-03-01', values: { tags: 'community', track: 'Community' } },
  ]
  expect(selectListRows(rows, { mode: 'automatic', limit: 1, order: 'newest' }).map(row => row.stableKey)).toEqual([
    'third',
  ])
  expect(
    selectListRows(rows, { mode: 'automatic', limit: 100, filter: { field: 'tags', value: ' COMMUNITY ' } }).map(
      row => row.stableKey,
    ),
  ).toEqual(['first', 'third'])
  expect(
    selectListRows(rows, { mode: 'automatic', limit: 100, filter: { field: 'track', value: 'Community' } }).map(
      row => row.stableKey,
    ),
  ).toEqual(['first', 'third'])
  expect(selectListRows(rows, { mode: 'automatic', limit: 1, filter: { field: 'tags', value: 'missing' } })).toEqual([])
  expect(rows.map(row => row.stableKey)).toEqual(['first', 'second', 'third'])
})

it('selects dated stories by publication date with a clamped month cutoff and stable exclusions', () => {
  const rows = [
    { id: 'a', stableKey: 'old', createdAt: '2026-10-29', values: { published_date: '2025-06-17', tags: 'health' } },
    { id: 'b', stableKey: 'newest', createdAt: '2025-01-01', values: { published_date: '2026-10-07', tags: 'health' } },
    {
      id: 'c',
      stableKey: 'middle',
      createdAt: '2026-11-01',
      values: { published_date: '2026-06-02', tags: 'health,education' },
    },
  ]
  expect(
    selectListRows(
      rows,
      {
        mode: 'automatic',
        limit: 6,
        order: 'newest',
        dateField: 'published_date',
        maxAgeMonths: 13,
        filter: { field: 'tags', value: 'health' },
      },
      new Date('2026-10-29T12:00:00Z'),
    ).map(row => row.stableKey),
  ).toEqual(['newest', 'middle'])
  expect(
    selectListRows(
      rows,
      { mode: 'automatic', limit: 6, dateField: 'published_date', excludeStableKey: 'newest' },
      new Date('2026-10-29T12:00:00Z'),
    ).map(row => row.stableKey),
  ).toEqual(['middle', 'old'])
})

it('combines selected story tag groups consistently for private previews, with an empty group allowing any', () => {
  const rows = [
    { id: 'a', stableKey: 'both', createdAt: '2026-10-01', values: { tags: 'health,education', region: 'africa' } },
    {
      id: 'b',
      stableKey: 'multi',
      createdAt: '2026-10-01',
      values: { tags: 'health', region: 'europe', regions: 'asia, africa' },
    },
    { id: 'c', stableKey: 'empty', createdAt: '2026-10-01', values: { tags: '', region: '' } },
  ]
  const choose = (main: string[], secondary: string[]) =>
    selectListRows(rows, { mode: 'automatic', limit: 200, storyTags: { main, secondary } }).map(row => row.stableKey)
  expect(choose(['health', 'education'], ['asia'])).toEqual(['multi'])
  expect(choose(['education'], [])).toEqual(['both'])
  expect(choose([], ['africa'])).toEqual(['both', 'multi'])
  expect(choose([], [])).toEqual(['both', 'multi', 'empty'])
  expect(
    readCollectionBinding({
      readerKey: 'workshops',
      selection: { mode: 'automatic', limit: 6, storyTags: { main: [], secondary: [] } },
    }),
  ).toBeNull()
})

it('applies explicit Story hiding to manual choices without applying feed age or review rules there', () => {
  const rows = ['old', 'future', 'hidden', 'removed', 'missing'].map((key, i) => ({
      id: key,
      stableKey: key,
      createdAt: '2026-01-01',
      values: {
        published_date: i === 0 ? '1999-01-01' : '2099-01-01',
        reviewed: false,
        ...(key === 'hidden'
          ? { hidden: true }
          : key === 'removed'
            ? { feed_removed: true }
            : key === 'missing'
              ? { in_feed: false }
              : {}),
      },
    })),
    selection = { mode: 'manual' as const, stableKeys: rows.map(row => row.stableKey) }
  expect(
    selectListRows(rows, selection, new Date(), { ...emptyStoriesSettings(), publishUnreviewed: false }).map(
      row => row.stableKey,
    ),
  ).toEqual(['old', 'future'])
  expect(selectListRows(rows, selection)).toHaveLength(5)
})
