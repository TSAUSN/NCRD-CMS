import { it, expect } from 'vitest'
import { resolvedCollection } from './structured.ts'
const id = '00000000-0000-4000-8000-000000000001',
  catalog = {
    mainLabel: 'Programs',
    secondaryLabel: 'Areas',
    mainTags: [{ id: 'food', label: 'Food' }],
    secondaryTags: [{ id: 'east', label: 'East', areas: ['asia'] }],
  },
  binding = {
    kind: 'collection',
    collectionId: id,
    readerKey: 'stories',
    publishedSchemaVersionId: id,
    publishedSchemaRevision: '1',
    publishedEntryRevision: '0',
    schemas: [],
    entries: [],
  }
it('accepts an optional closed Story display catalog without changing old envelope handling', () => {
  expect(resolvedCollection(binding)).toEqual(binding)
  expect(resolvedCollection({ ...binding, storyCatalog: catalog })?.storyCatalog).toEqual(catalog)
})
it('fails closed on private/unknown catalog fields and catalogs attached to another reader', () => {
  for (const value of [
    { ...binding, storyCatalog: { ...catalog, source: 'sawso' } },
    { ...binding, storyCatalog: { ...catalog, mainTags: [{ id: 'food', label: 'Food', keywords: ['private'] }] } },
    { ...binding, readerKey: 'people', storyCatalog: catalog },
    { ...binding, unexpected: catalog },
  ])
    expect(resolvedCollection(value)).toBeNull()
})
