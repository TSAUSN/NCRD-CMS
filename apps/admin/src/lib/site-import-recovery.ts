/** Content archives can be 64 MB. Keep browser recovery out of synchronous
 * localStorage and acknowledge only a completed IndexedDB transaction. */
const DATABASE = 'cms-site-import-recovery'
const STORE = 'setups'
export type ImportRecovery = {
  version: 1
  source: string
  fileName: string
  sourceId: string
  name: string
  slug: string
  requestId: string | null
}
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Browser storage is unavailable.'))
      return
    }
    const request = indexedDB.open(DATABASE, 1)
    let rejected = false
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error ?? new Error('Browser storage could not be opened.'))
    request.onblocked = () => {
      rejected = true
      reject(new Error('Another browser window is preventing storage from opening.'))
    }
    request.onsuccess = () => {
      if (rejected) {
        request.result.close()
        return
      }
      resolve(request.result)
    }
  })
}
async function transact(
  actorId: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
): Promise<unknown> {
  if (!actorId) throw new Error('Sign in again before saving import setup.')
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = operation(tx.objectStore(STORE))
      let result: unknown
      request.onsuccess = () => {
        result = request.result
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Browser storage failed.'))
      tx.onabort = () => reject(tx.error ?? new Error('Browser storage was interrupted.'))
    })
  } finally {
    db.close()
  }
}
export const readImportRecovery = (actorId: string) => transact(actorId, 'readonly', store => store.get(actorId))
export const saveImportRecovery = async (actorId: string, record: ImportRecovery) => {
  await transact(actorId, 'readwrite', store => store.put(record, actorId))
}
export const removeImportRecovery = async (actorId: string) => {
  await transact(actorId, 'readwrite', store => store.delete(actorId))
}
