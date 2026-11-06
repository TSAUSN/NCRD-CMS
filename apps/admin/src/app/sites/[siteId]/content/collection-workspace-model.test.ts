import { describe, expect, it } from 'vitest'
import {
  COLLECTION_PRESETS,
  canonicalJson,
  collectionDraftEqual,
  collectionPublicationChanges,
  entriesFromCsv,
  slugifyStableKey,
} from './collection-workspace-model.ts'
import { CollectionModel } from '@cms/schema'

describe('collection workspace model', () => {
  it('ships valid visual presets for every promised starter', () => {
    expect(Object.keys(COLLECTION_PRESETS)).toEqual([
      'speakers',
      'agenda',
      'timeline',
      'faq',
      'stories',
      'resources',
      'jobs',
    ])
    for (const preset of Object.values(COLLECTION_PRESETS))
      expect(CollectionModel.safeParse(preset.model).success).toBe(true)
  })

  it('compares nested drafts deeply without depending on object key order', () => {
    expect(
      collectionDraftEqual({ values: { b: 2, a: [1, { z: true }] } }, { values: { a: [1, { z: true }], b: 2 } }),
    ).toBe(true)
    expect(collectionDraftEqual({ values: { a: 1 } }, { values: { a: 2 } })).toBe(false)
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('makes safe unique stable keys for duplicate imported titles', () => {
    const used = new Set(['annual-report'])
    expect(slugifyStableKey('Annual Report', used)).toBe('annual-report-2')
    const imported = entriesFromCsv([{ title: 'Annual Report' }, { title: 'Annual Report' }], 'title', [
      { id: null, stableKey: 'annual-report', values: {} },
    ])
    expect(imported.map(entry => entry.stableKey)).toEqual(['annual-report-2', 'annual-report-3'])
  })
})

describe('publication change summary', () => {
  const model = COLLECTION_PRESETS.speakers.model
  const entry = {
    id: 'one',
    stableKey: 'jordan',
    schemaVersionId: 'schema',
    revision: 2,
    sortIndex: 0,
    publishedSortIndex: 0,
    archived: false,
    publishedArchived: false,
    values: { name: 'Jordan', role: 'Keynote speaker' },
    publishedValues: { name: 'Jordan', role: 'Organizer' },
  }
  it('names only the changed fields and omits unchanged records', () => {
    expect(collectionPublicationChanges([entry], model)).toEqual([
      { key: 'one', title: 'Jordan', changes: ['Role or title: Organizer → Keynote speaker'] },
    ])
    expect(collectionPublicationChanges([{ ...entry, values: entry.publishedValues }], model)).toEqual([])
  })
  it('distinguishes additions, removal, restoration and ordering', () => {
    expect(collectionPublicationChanges([{ ...entry, publishedValues: null }], model)[0]?.changes).toEqual([
      'Add to the live list',
    ])
    expect(collectionPublicationChanges([{ ...entry, archived: true }], model)[0]?.changes).toEqual([
      'Remove from the live list',
    ])
    expect(collectionPublicationChanges([{ ...entry, archived: true, publishedValues: null }], model)).toEqual([])
    expect(collectionPublicationChanges([{ ...entry, archived: true, publishedArchived: true }], model)).toEqual([])
    expect(
      collectionPublicationChanges(
        [{ ...entry, values: entry.publishedValues, publishedArchived: true, sortIndex: 1 }],
        model,
      )[0]?.changes,
    ).toEqual(['Restore to the live list', 'Move to position 2'])
  })
  it('summarizes rich content without displaying raw markup or object text', () => {
    const changed = {
      ...entry,
      values: { ...entry.values, bio: '<p>Updated</p>', photo: { src: '/image', alt: 'Jordan' } },
    }
    const summary = collectionPublicationChanges([changed], model)[0]!.changes
    expect(summary).toContain('Biography updated')
    expect(summary).toContain('Photo updated')
    expect(summary.join(' ')).not.toMatch(/<p>|object Object/)
  })
})
