import { validPageIdentity } from './page-identity.ts'
import { PageContent, SeoMeta } from '@cms/schema'
import { apply, createEditorState, deepEqual, type EditorDocument, type EditorState } from '@cms/domain'

export const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const RECOVERY_MAX_BYTES = 4 * 1024 * 1024
export const RECOVERY_MAX_COPIES = 20
export type RecoveryScope = { userId: string; siteId: string; pageId: string }
export type RecoveryHead = { versionId: string | null; revision: number; document: EditorDocument }
export type RecoveryRecord = {
  schemaVersion: 1
  key: string
  scopeKey: string
  scope: RecoveryScope
  journalId: string
  sequence: number
  updatedAt: number
  base: RecoveryHead
  document: EditorDocument
}
export type RecoveryStore = {
  list(scope: RecoveryScope): Promise<unknown[]>
  put(record: RecoveryRecord): Promise<void>
  /** A reviewed copy may advance in another window. Conditional deletion must
   * fail rather than removing that newer sequence. */
  remove(key: string, expectedSequence?: number): Promise<boolean>
}
/** Saving stores page metadata through `SeoMeta`, which spells out defaults
 * (such as `noindex: false`) that the editor's own document never receives.
 * Compare in that stored form; otherwise a copy whose save committed looks
 * like unsaved work, and an unchanged head looks like someone else's save. */
export function sameStoredDocument(left: EditorDocument, right: EditorDocument): boolean {
  return deepEqual(storedForm(left), storedForm(right))
}
function storedForm(document: EditorDocument): EditorDocument {
  const meta = SeoMeta.safeParse(document.meta)
  return meta.success ? { ...document, meta: meta.data } : document
}
export function recoveryScopeKey(scope: RecoveryScope): string {
  return JSON.stringify([scope.userId, scope.siteId, scope.pageId])
}
export function recoveryKey(scope: RecoveryScope, journalId: string): string {
  return JSON.stringify([scope.userId, scope.siteId, scope.pageId, journalId])
}

function validDocument(value: unknown): value is EditorDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as EditorDocument
  if (
    !PageContent.safeParse(doc.sections).success ||
    !doc.meta ||
    typeof doc.meta !== 'object' ||
    Array.isArray(doc.meta)
  )
    return false
  if (doc.identity !== undefined && !validPageIdentity(doc.identity)) return false
  if (doc.sections.some(section => section.raw_html !== undefined && typeof section.raw_html !== 'string')) return false
  return Object.entries(doc.meta).every(([key, item]) =>
    key === 'noindex'
      ? typeof item === 'boolean'
      : ['title', 'description', 'canonical', 'social_image'].includes(key) && typeof item === 'string',
  )
}

export function validRecoveryHead(value: unknown): value is RecoveryHead {
  if (!value || typeof value !== 'object') return false
  const head = value as RecoveryHead
  return (
    Number.isSafeInteger(head.revision) &&
    head.revision >= 0 &&
    (head.versionId === null || typeof head.versionId === 'string') &&
    validDocument(head.document)
  )
}

/** Local storage is untrusted. Check identity, shape, age and resource bounds
 * before presenting any content, and preserve accepted authored values exactly. */
export function readRecoveryRecord(value: unknown, scope: RecoveryScope, now = Date.now()): RecoveryRecord | null {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength > RECOVERY_MAX_BYTES
    )
      return null
    const entry = value as RecoveryRecord
    if (
      entry.schemaVersion !== 1 ||
      recoveryScopeKey(entry.scope) !== recoveryScopeKey(scope) ||
      entry.scopeKey !== recoveryScopeKey(scope) ||
      typeof entry.journalId !== 'string' ||
      !entry.journalId ||
      entry.journalId.length > 100 ||
      entry.key !== recoveryKey(scope, entry.journalId) ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 1 ||
      !Number.isFinite(entry.updatedAt) ||
      entry.updatedAt > now + 60_000 ||
      now - entry.updatedAt > RECOVERY_RETENTION_MS ||
      !validRecoveryHead(entry.base) ||
      !validDocument(entry.document)
    )
      return null
    return entry
  } catch {
    return null
  }
}

/** Invalid and expired copies cannot become candidates. Keep sorting stable so
 * the most recently committed local work is offered first, without merging
 * journals from separate windows. */
export function recoveryCandidates(values: unknown[], scope: RecoveryScope, now = Date.now()): RecoveryRecord[] {
  return values
    .map(value => readRecoveryRecord(value, scope, now))
    .filter((record): record is RecoveryRecord => record !== null)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.key.localeCompare(right.key))
}

export function recoveryDisposition(
  record: RecoveryRecord,
  head: RecoveryHead,
): 'acknowledged' | 'same-base' | 'changed-base' {
  if (sameStoredDocument(record.document, head.document)) return 'acknowledged'
  return record.base.versionId === head.versionId &&
    record.base.revision === head.revision &&
    sameStoredDocument(record.base.document, head.document)
    ? 'same-base'
    : 'changed-base'
}

/** Each mounted editor has its own journal; no tab overwrites another. Writes
 * serialize snapshots so a delayed earlier operation cannot erase newer input. */
export function createRecoveryJournal(scope: RecoveryScope, journalId: string, store: RecoveryStore) {
  let sequence = 0
  let chain: Promise<unknown> = Promise.resolve()
  const key = recoveryKey(scope, journalId)
  return {
    key,
    write(document: EditorDocument, base: RecoveryHead, now = Date.now()): Promise<void> {
      const record: RecoveryRecord = structuredClone({
        schemaVersion: 1,
        key,
        scopeKey: recoveryScopeKey(scope),
        scope,
        journalId,
        sequence: ++sequence,
        updatedAt: now,
        base,
        document,
      })
      const result = chain.then(async () => {
        if (sameStoredDocument(record.document, record.base.document)) {
          await store.remove(key)
          return
        }
        if (!readRecoveryRecord(record, scope, now))
          throw new Error('This draft is too large or cannot be kept as a browser recovery copy.')
        await store.put(record)
      })
      chain = result.catch(() => undefined)
      return result
    },
    settled: () => chain,
  }
}

/** Recovery is a single local history step; the ordinary save queue still
 * owns persistence/CAS. Position-based comparison is explicit in its review. */
export function recoverDocument(state: EditorState, document: EditorDocument): EditorState {
  const recovered = createEditorState(document)
  return apply(state, (draft, origins) => {
    draft.sections = recovered.document.sections
    draft.meta = recovered.document.meta
    if (recovered.document.identity) draft.identity = recovered.document.identity
    origins.splice(
      0,
      origins.length,
      ...recovered.sectionOrigins.map((fresh, index) =>
        state.document.sections[index]?.section_def_id === document.sections[index]?.section_def_id &&
        state.document.sections[index]?.section_def_version === document.sections[index]?.section_def_version
          ? state.sectionOrigins[index]!
          : fresh,
      ),
    )
  })
}
