import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonical, digest, readV1Backup } from './backup.ts'
import { checkOutput } from './migration-cli.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'v1-backup-test-'))
  roots.push(root)
  const manifest = {
    projectId: 'fixture',
    takenAt: '2026-07-30T17:16:03.968Z',
    totals: { collections: 2, documents: 1, placeholders: 1 },
    collections: [{ collection: 'sites', file: 'sites.json', documents: 1 }],
  }
  writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(
    path.join(root, 'sites.json'),
    JSON.stringify({
      'sites/a': null,
      'sites/a/pages/home': { title: 'Saved draft', date: { __type: 'timestamp', value: '2026-01-01T00:00:00Z' } },
    }),
  )
  return { root, manifest }
}
describe('native V1 backup reader', () => {
  it('preserves empty parents and encoded Firestore values with exact provenance and repeatable identity', () => {
    const { root } = fixture()
    const before = readFileSync(path.join(root, 'sites.json'))
    const first = readV1Backup(root)
    expect(first).toEqual(readV1Backup(root))
    expect(first.records).toHaveLength(2)
    expect(first.records[0]?.payload).toBeNull()
    expect(first.records[1]?.payload?.date).toEqual({ __type: 'timestamp', value: '2026-01-01T00:00:00Z' })
    expect(first.files.find(f => f.path === 'backup/sites.json')?.sha256).toBe(digest(before))
    expect(readFileSync(path.join(root, 'sites.json'))).toEqual(before)
    expect(canonical({ z: 1, a: { b: 2, a: 3 } })).toBe(canonical({ a: { a: 3, b: 2 }, z: 1 }))
  })
  it('refuses a manifest count mismatch instead of producing a partial migration', () => {
    const { root, manifest } = fixture()
    manifest.totals.documents = 2
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    expect(() => readV1Backup(root)).toThrow(/reconcile/)
  })
  it('refuses collection traversal and symlink escapes', () => {
    const { root, manifest } = fixture()
    manifest.collections[0]!.file = '../private.json'
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    expect(() => readV1Backup(root)).toThrow(/invalid/)
    manifest.collections[0]!.file = 'escape.json'
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    const other = fixture().root
    symlinkSync(path.join(other, 'sites.json'), path.join(root, 'escape.json'))
    expect(() => readV1Backup(root)).toThrow(/inside/)
  })
  it('refuses duplicate collections and invalid logical document paths', () => {
    const { root, manifest } = fixture()
    manifest.collections.push(manifest.collections[0]!)
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    expect(() => readV1Backup(root)).toThrow(/duplicate/)
    manifest.collections.pop()
    writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(path.join(root, 'sites.json'), JSON.stringify({ 'users/private': {}, 'sites/a': null }))
    expect(() => readV1Backup(root)).toThrow(/document path/)
  })
  it('protects V1 output paths including a symlinked parent', () => {
    const { root } = fixture()
    const destination = fixture().root
    symlinkSync(root, path.join(destination, 'alias'))
    expect(() => checkOutput(path.join(root, 'new', 'report.json'), [root])).toThrow(/outside/)
    expect(() => checkOutput(path.join(destination, 'alias', 'new.json'), [root])).toThrow(/outside/)
    mkdirSync(path.join(destination, 'safe'))
    expect(checkOutput(path.join(destination, 'safe', 'report.json'), [root])).toContain('/safe/report.json')
  })
})
