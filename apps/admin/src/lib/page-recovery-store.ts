import {
  readRecoveryRecord,
  RECOVERY_MAX_COPIES,
  recoveryScopeKey,
  type RecoveryRecord,
  type RecoveryScope,
  type RecoveryStore,
} from './page-recovery.ts'

const DATABASE = 'cms-page-recovery'
const STORE = 'drafts'
let connection: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (connection) return connection
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Browser storage is unavailable.'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    let rejected = false
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore(STORE, { keyPath: 'key' })
      drafts.createIndex('scope', 'scopeKey')
    }
    request.onerror = () => reject(request.error ?? new Error('Browser storage could not be opened.'))
    request.onblocked = () => {
      rejected = true
      reject(new Error('Another browser window is preventing recovery storage from opening.'))
    }
    request.onsuccess = () => {
      const db = request.result
      if (rejected) {
        db.close()
        return
      }
      db.onversionchange = () => {
        db.close()
        connection = null
      }
      resolve(db)
    }
  }).catch(error => {
    connection = null
    throw error
  })
  return connection
}

/** Prune only this account/site/page's expired or invalid records. The copy
 * limit fails visibly instead of silently deleting another window's work. */
async function scopedTransaction(scope: RecoveryScope, record?: RecoveryRecord): Promise<RecoveryRecord[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const request = store.index('scope').getAll(recoveryScopeKey(scope))
    let records: RecoveryRecord[] = []
    let failure: Error | null = null
    request.onsuccess = () => {
      const now = Date.now()
      for (const value of request.result as RecoveryRecord[]) {
        const valid = readRecoveryRecord(value, scope, now)
        if (valid) records.push(valid)
        else store.delete(value.key)
      }
      if (!record) return
      if (!readRecoveryRecord(record, scope, now)) {
        failure = new Error('This browser recovery copy is invalid or too large.')
        tx.abort()
        return
      }
      if (records.length >= RECOVERY_MAX_COPIES && !records.some(existing => existing.key === record.key)) {
        failure = new Error(
          'This page has too many browser recovery copies. Review or discard an older copy to make room.',
        )
        tx.abort()
        return
      }
      store.put(record)
    }
    tx.oncomplete = () => resolve(records)
    tx.onerror = () => reject(failure ?? tx.error ?? request.error ?? new Error('Browser recovery storage failed.'))
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Browser recovery storage was interrupted.'))
  })
}

async function remove(key: string, expectedSequence?: number): Promise<boolean> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const request = store.get(key)
    let removed = false
    request.onsuccess = () => {
      if (expectedSequence !== undefined && request.result?.sequence !== expectedSequence) return
      store.delete(key)
      removed = true
    }
    // A successful request is not yet a durable write; acknowledge transaction
    // completion, including quota/abort failures that arrive after the request.
    tx.oncomplete = () => resolve(removed)
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Browser recovery storage failed.'))
    tx.onabort = () => reject(tx.error ?? new Error('Browser recovery storage was interrupted.'))
  })
}

export const browserRecoveryStore: RecoveryStore = {
  list: (scope: RecoveryScope) => scopedTransaction(scope),
  put: async (record: RecoveryRecord) => {
    await scopedTransaction(record.scope, record)
  },
  remove,
}
