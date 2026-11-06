import { it, expect } from 'vitest'
import { newsroomValues } from './newsroom.ts'
const id = (n: number) => '00000000-0000-4000-a000-' + String(n).padStart(12, '0')
it('filters and pages immutable stories using plain links and safely bounded search', () => {
  const list = {
    kind: 'collection',
    collectionId: id(1),
    readerKey: 'stories',
    publishedSchemaVersionId: id(2),
    publishedSchemaRevision: '1',
    publishedEntryRevision: '1',
    schemas: [{ id: id(2), revision: '1', fields: [{ key: 'title', type: 'text', label: 'Title', required: true }] }],
    entries: Array.from({ length: 34 }, (_, i) => ({
      id: id(i + 10),
      stableKey: 'story-' + i,
      schemaVersionId: id(2),
      values: {
        title: 'Story ' + i,
        summary: 'Approved summary',
        tags: i % 2 ? 'health,education' : 'health',
        region: i % 3 ? 'africa' : 'asia',
      },
    })),
  }
  const original = structuredClone(list),
    options = {
      sectors: [
        { id: 'health', label: 'Health' },
        { id: 'education', label: 'Education' },
      ],
      regions: [
        { id: 'africa', label: 'Africa' },
        { id: 'asia', label: 'Asia' },
      ],
    }
  const second = newsroomValues({ stories: list }, { page: '2' }, options)
  expect((second.stories as typeof list).entries.map(e => e.values.title)).toEqual(
    Array.from({ length: 12 }, (_, i) => 'Story ' + (i + 12)),
  )
  expect(second.paging).toContain('Older stories')
  const filtered = newsroomValues({ stories: list }, { sector: 'education', region: 'asia' }, options)
  expect((filtered.stories as typeof list).entries).toHaveLength(6)
  expect(filtered.filters).toContain('sector=education&amp;region=africa')
  expect(filtered.filters).not.toContain('<script')
  expect((newsroomValues({ stories: list }, { q: 'Story 33' }, options).stories as typeof list).entries).toHaveLength(1)
  expect((newsroomValues({ stories: list }, { page: '9999' }, options).stories as typeof list).entries).toHaveLength(10)
  expect(list).toEqual(original)
})
