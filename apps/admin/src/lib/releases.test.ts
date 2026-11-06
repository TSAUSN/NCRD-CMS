import { describe, expect, it } from 'vitest'
import { checkedReleaseSelection, type ReleaseItem } from './releases.ts'

const page: ReleaseItem = { key: 'page:p', type: 'page', id: 'p', label: 'Page', revision: '4', versionId: 'v' }
const schema: ReleaseItem = {
  key: 'collection_schema:c',
  type: 'collection_schema',
  id: 'c',
  label: 'Schema',
  revision: '2',
  versionId: 's',
  requiresAdmin: true,
}
const records: ReleaseItem = {
  key: 'collection_entries:c',
  type: 'collection_entries',
  id: 'c',
  label: 'Records',
  revision: '3',
  versionId: 's',
}
describe('release selection', () => {
  it('uses server-read labels and capabilities rather than client claims', () => {
    const selected = checkedReleaseSelection([schema], [{ ...schema, label: 'Forged', requiresAdmin: false }])
    expect(selected[0]).toEqual(schema)
  })
  it('refuses stale versions and duplicate selections', () => {
    expect(() => checkedReleaseSelection([page], [{ ...page, revision: '3' }])).toThrow(/changed/)
    expect(() => checkedReleaseSelection([page], [page, page])).toThrow(/distinct/)
  })
  it('keeps a closed story scope without accepting client labels or invalid IDs', () => {
    const id = '22222222-2222-4222-8222-222222222222',
      requested = { ...records, label: 'Forged', entryIds: [id] }
    const result = checkedReleaseSelection([records], [requested])
    expect(result).toEqual([{ ...records, entryIds: [id] }])
    requested.entryIds.push('33333333-3333-4333-8333-333333333333')
    expect(result[0]!.entryIds).toEqual([id])
    for (const entryIds of [[], [id, id], ['foreign'], ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'], [null]])
      expect(() => checkedReleaseSelection([records], [{ ...records, entryIds } as ReleaseItem])).toThrow(/stories/)
    expect(() => checkedReleaseSelection([page], [{ ...page, entryIds: [id] }])).toThrow(/stories/)
  })
  it('requires a selected schema dependency for changed records', () => {
    expect(() => checkedReleaseSelection([schema, records], [records])).toThrow(/schema/)
    expect(checkedReleaseSelection([schema, records], [records, schema])).toEqual([schema, records])
  })
})
