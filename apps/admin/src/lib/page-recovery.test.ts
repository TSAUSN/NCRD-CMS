import { describe, expect, it } from 'vitest'
import { createEditorState, isDirty, isSlotChanged, undo } from '@cms/domain'
import {
  createRecoveryJournal,
  readRecoveryRecord,
  RECOVERY_MAX_BYTES,
  RECOVERY_RETENTION_MS,
  recoverDocument,
  recoveryCandidates,
  recoveryDisposition,
  sameStoredDocument,
  type RecoveryRecord,
  type RecoveryStore,
} from './page-recovery.ts'

const scope = { userId: 'user-a', siteId: 'site-a', pageId: 'page-a' }
const doc = (body: string) => ({
  sections: [{ section_def_id: 'definition-a', section_def_version: 1, values: { body } }],
  meta: {},
})
const base = { versionId: 'version-a', revision: 2, document: doc('Saved') }
function memory() {
  const rows = new Map<string, RecoveryRecord>()
  const store: RecoveryStore = {
    list: async () => [...rows.values()],
    put: async record => {
      rows.set(record.key, record)
    },
    remove: async (key, expectedSequence) => {
      if (expectedSequence !== undefined && rows.get(key)?.sequence !== expectedSequence) return false
      rows.delete(key)
      return true
    },
  }
  return { rows, store }
}
describe('scoped page recovery', () => {
  it('keeps exact rich text and refuses another user, site, page, schema, expired or malformed record', async () => {
    const { store, rows } = memory()
    await createRecoveryJournal(scope, 'tab-a', store).write(
      doc('<p>Keep <strong>this</strong> &amp; <em>that</em>.</p>'),
      base,
      100,
    )
    const record = [...rows.values()][0]!
    expect(readRecoveryRecord(record, scope, 100)?.document).toEqual(record.document)
    for (const key of ['userId', 'siteId', 'pageId'] as const)
      expect(readRecoveryRecord(record, { ...scope, [key]: 'other' }, 100)).toBeNull()
    expect(readRecoveryRecord({ ...record, schemaVersion: 99 }, scope, 100)).toBeNull()
    expect(readRecoveryRecord(record, scope, RECOVERY_RETENTION_MS + 101)).toBeNull()
    expect(readRecoveryRecord({ ...record, document: { sections: 'broken', meta: {} } }, scope, 100)).toBeNull()
    expect(readRecoveryRecord({ ...record, scope: undefined }, scope, 100)).toBeNull()
  })
  it('retains newer typing after an earlier save acknowledgement and clears only its own exact acknowledgement', async () => {
    const { store, rows } = memory()
    let release!: () => void
    const delay = new Promise<void>(resolve => {
      release = resolve
    })
    const originalPut = store.put
    let first = true
    store.put = async record => {
      if (first) {
        first = false
        await delay
      }
      await originalPut(record)
    }
    const journal = createRecoveryJournal(scope, 'tab-a', store)
    const older = journal.write(doc('First edit'), base)
    const newer = journal.write(doc('Typed while saving'), {
      ...base,
      versionId: 'ack-a',
      revision: 3,
      document: doc('First edit'),
    })
    release()
    await Promise.all([older, newer])
    expect(rows.get(journal.key)?.document).toEqual(doc('Typed while saving'))
    expect(rows.get(journal.key)?.base.revision).toBe(3)
    await createRecoveryJournal(scope, 'tab-b', store).write(doc('Other tab'), base)
    await journal.write(doc('Typed while saving'), {
      ...base,
      versionId: 'ack-b',
      revision: 4,
      document: doc('Typed while saving'),
    })
    expect(rows.has(journal.key)).toBe(false)
    expect([...rows.values()].map(row => row.document)).toEqual([doc('Other tab')])
  })
  it('bounds UTF-8 bytes and orders valid candidates without exposing another account', async () => {
    const { store, rows } = memory()
    await createRecoveryJournal(scope, 'older', store).write(doc('Older'), base, 100)
    await createRecoveryJournal(scope, 'newer', store).write(doc('Newer'), base, 200)
    await createRecoveryJournal({ ...scope, userId: 'other' }, 'other', store).write(doc('Private'), base, 300)
    expect(recoveryCandidates([...rows.values()], scope, 300).map(record => record.document)).toEqual([
      doc('Newer'),
      doc('Older'),
    ])
    const record = [...rows.values()][0]!
    const oversized = { ...record, document: doc('€'.repeat(Math.ceil(RECOVERY_MAX_BYTES / 3))) }
    expect(JSON.stringify(oversized).length).toBeLessThan(RECOVERY_MAX_BYTES)
    expect(readRecoveryRecord(oversized, scope, 300)).toBeNull()
  })
  it('recovers after a failed storage write instead of wedging the journal queue', async () => {
    const { store, rows } = memory()
    const put = store.put
    store.put = async () => {
      throw new Error('Quota')
    }
    const journal = createRecoveryJournal(scope, 'tab', store)
    await expect(journal.write(doc('Failed'), base)).rejects.toThrow('Quota')
    store.put = put
    await journal.write(doc('Retained'), base)
    expect(rows.get(journal.key)?.document).toEqual(doc('Retained'))
  })
  it('distinguishes lost-response acknowledgement, same-base recovery and changed-head review', async () => {
    const { store, rows } = memory()
    await createRecoveryJournal(scope, 'tab', store).write(doc('Local work'), base)
    const record = [...rows.values()][0]!
    expect(recoveryDisposition(record, base)).toBe('same-base')
    expect(recoveryDisposition(record, { ...base, versionId: 'new', revision: 3, document: doc('Local work') })).toBe(
      'acknowledged',
    )
    expect(recoveryDisposition(record, { ...base, versionId: 'new', revision: 3, document: doc('Someone else') })).toBe(
      'changed-base',
    )
  })
  it('compares copies with the head in the stored metadata form the save command writes', async () => {
    // Saving parses metadata through SeoMeta, which spells out noindex: false.
    const stored = (document: ReturnType<typeof doc>, meta: Record<string, unknown> = { noindex: false }) => ({
      ...document,
      meta,
    })
    const { store, rows } = memory()
    await createRecoveryJournal(scope, 'tab', store).write(doc('Local work'), base)
    const record = [...rows.values()][0]!
    expect(
      recoveryDisposition(record, { ...base, versionId: 'saved', revision: 3, document: stored(doc('Local work')) }),
    ).toBe('acknowledged')
    expect(recoveryDisposition(record, { ...base, document: stored(base.document) })).toBe('same-base')
    expect(recoveryDisposition(record, { ...base, document: stored(base.document, { noindex: true }) })).toBe(
      'changed-base',
    )
    expect(sameStoredDocument(doc('A'), stored(doc('A')))).toBe(true)
    expect(sameStoredDocument(stored(doc('A'), { title: 'Kept' }), stored(doc('A'), { title: 'Changed' }))).toBe(false)
    // A copy that only differs from its base by that default holds nothing to recover.
    await createRecoveryJournal(scope, 'clean', store).write(stored(doc('Saved')), base)
    expect([...rows.keys()]).toEqual([record.key])
  })
  it('applies recovery as one undo step while retaining the saved baseline and per-field change markers', () => {
    const original = createEditorState(base.document)
    const recovered = recoverDocument(original, doc('Recovered'))
    expect(isDirty(recovered)).toBe(true)
    expect(isSlotChanged(recovered, 0, 'body')).toBe(true)
    expect(recovered.saved).toEqual(base.document)
    expect(recovered.past).toHaveLength(1)
    expect(undo(recovered).document).toEqual(base.document)
  })
})

it('keeps page identity in recovery and the same Undo stack, rejecting malformed browser values', async () => {
  const document = { sections: [], meta: {}, identity: { title: 'An earlier page', address: 'earlier' } }
  const next = { ...document, identity: { title: 'The recovered page', address: 'recovered' } }
  const state = recoverDocument(createEditorState(document), next)
  expect(state.document.identity).toEqual(next.identity)
  expect(undo(state).document.identity).toEqual(document.identity)
  const { store, rows } = memory()
  await createRecoveryJournal(scope, 'identity', store).write(next, { ...base, document }, 100)
  const record = [...rows.values()][0]!
  expect(readRecoveryRecord(record, scope, 100)?.document.identity).toEqual(next.identity)
  expect(
    readRecoveryRecord(
      { ...record, document: { ...next, identity: { title: 'Invalid', address: '../bad' } } },
      scope,
      100,
    ),
  ).toBeNull()
})
it('keeps canonical nested chapter addresses in recovery, refusing malformed segments and traversal', async () => {
  const document = { sections: [], meta: {}, identity: { title: '[Chapter name]', address: 'chapters/peoria' } },
    next = { ...document, meta: { description: '[Unsaved description]' } }
  const { store, rows } = memory()
  await createRecoveryJournal(scope, 'chapter-path', store).write(next, { ...base, document }, 100)
  const record = [...rows.values()][0]!
  expect(readRecoveryRecord(record, scope, 100)?.document.identity?.address).toBe('chapters/peoria')
  for (const address of [
    '../bad',
    'chapters/../bad',
    'chapters//peoria',
    '/chapters/peoria',
    'chapters/peoria/',
    'chapters/Peoria',
    'chapters/%2e%2e',
  ])
    expect(
      readRecoveryRecord({ ...record, document: { ...next, identity: { ...document.identity, address } } }, scope, 100),
    ).toBeNull()
})
