import { describe, expect, it } from 'vitest'
import {
  applyStarterUpgrade,
  PROGRAM_COLLECTION_MODEL,
  RESOURCE_COLLECTION_MODEL,
  starterUpgrade,
} from './collection-starters.ts'
import { CollectionModel } from './collections.ts'

// COLL-05: a collection from an earlier, three-field starter.
const older = {
  fields: [
    { key: 'title', type: 'text' as const, label: 'Title', required: true },
    { key: 'category', type: 'text' as const, label: 'Topic', required: false },
    { key: 'resource_url', type: 'url' as const, label: 'Link', required: true },
  ],
  presentation: {
    schemaVersion: 1 as const,
    titleField: 'title',
    subtitleField: 'category',
    imageField: null,
    groupField: null,
  },
}

describe('upgrading a collection from an earlier starter', () => {
  it('names the current starter fields it lacks, as optional fields', () => {
    expect(starterUpgrade(older)).toEqual({
      starter: 'resource',
      name: 'Resource',
      missing: [
        { key: 'summary', type: 'richtext', label: 'Summary', required: false },
        { key: 'thumbnail', type: 'image', label: 'Thumbnail', required: false },
      ],
    })
    expect(starterUpgrade(RESOURCE_COLLECTION_MODEL)).toBeNull()
    expect(
      starterUpgrade({
        fields: [
          { key: 'title', type: 'text', label: 'Title', required: true },
          { key: 'date', type: 'date', label: 'Date', required: true },
        ],
      }),
    ).toMatchObject({
      starter: 'program',
      missing: PROGRAM_COLLECTION_MODEL.fields.slice(2).map(field => ({ key: field.key, required: false })),
    })
    // A collection that is not one of the starters is left alone.
    expect(starterUpgrade({ fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] })).toBeNull()
  })

  it('adds them after the collection’s own fields, keeping its keys, labels and requirements', () => {
    const upgraded = applyStarterUpgrade(older)
    expect(CollectionModel.safeParse(upgraded).success).toBe(true)
    expect(upgraded.fields.map(field => [field.key, field.label, field.required])).toEqual([
      ['title', 'Title', true],
      ['category', 'Topic', false],
      ['resource_url', 'Link', true],
      ['summary', 'Summary', false],
      ['thumbnail', 'Thumbnail', false],
    ])
    expect(upgraded.presentation).toEqual({ ...older.presentation, imageField: 'thumbnail' })
    expect(applyStarterUpgrade(upgraded)).toBe(upgraded)
  })
})
