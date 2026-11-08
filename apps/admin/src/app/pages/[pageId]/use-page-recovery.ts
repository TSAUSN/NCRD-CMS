'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { EditorDocument } from '@cms/domain'
import {
  createRecoveryJournal,
  readRecoveryRecord,
  recoveryCandidates,
  recoveryDisposition,
  recoveryScopeKey,
  sameStoredDocument,
  validRecoveryHead,
  type RecoveryHead,
  type RecoveryRecord,
  type RecoveryScope,
} from '../../../lib/page-recovery.ts'
import { browserRecoveryStore } from '../../../lib/page-recovery-store.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'

export type RecoveryReview = { record: RecoveryRecord; head: RecoveryHead; changedBase: boolean }
type Options = {
  scope: RecoveryScope
  document: EditorDocument
  base: RecoveryHead
  canApply(): boolean
  onRecover(document: EditorDocument, definitions: LibraryEntry[]): void
}

class RecoveryIdentityError extends Error {}
async function currentHead(
  scope: RecoveryScope,
  document?: EditorDocument,
): Promise<{ head: RecoveryHead; definitions: LibraryEntry[] }> {
  const query = new URLSearchParams({ user: scope.userId, site: scope.siteId })
  const response = await fetch(`/api/pages/${encodeURIComponent(scope.pageId)}/recovery?${query}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15_000),
    ...(document
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pins: document.sections.map(section => ({
              id: section.section_def_id,
              version: section.section_def_version,
            })),
          }),
        }
      : {}),
  })
  if (response.status === 403)
    throw new RecoveryIdentityError('Your sign-in changed. Reload this page before opening browser recovery.')
  if (!response.ok)
    throw new Error(
      'Could not confirm this page and its section versions are available. Reconnect or reload before opening browser recovery; the copy is still kept.',
    )
  const value = (await response.json()) as { scope?: RecoveryScope; head?: RecoveryHead; definitions?: LibraryEntry[] }
  if (!value.scope || recoveryScopeKey(value.scope) !== recoveryScopeKey(scope) || !validRecoveryHead(value.head)) {
    throw new Error('Could not confirm this recovery copy belongs to the current page. Reload before trying again.')
  }
  if (document && !Array.isArray(value.definitions))
    throw new Error('Section details could not be loaded. Your browser copy is still kept.')
  return { head: value.head, definitions: value.definitions ?? [] }
}
function sameHead(left: RecoveryHead, right: RecoveryHead): boolean {
  return (
    left.versionId === right.versionId &&
    left.revision === right.revision &&
    sameStoredDocument(left.document, right.document)
  )
}

/** A recovery copy is never an automatic save acknowledgement or automatic
 * restore. Storage, identity and the current head are checked independently. */
export function usePageRecovery(options: Options) {
  const scopeKey = recoveryScopeKey(options.scope)
  const journal = useMemo(
    () => createRecoveryJournal(options.scope, crypto.randomUUID(), browserRecoveryStore),
    [scopeKey],
  )
  const latest = useRef(options)
  useLayoutEffect(() => {
    latest.current = options
  }, [options])
  const mounted = useRef(false)
  const writeGeneration = useRef(0)
  const loadGeneration = useRef(0)
  const busyGeneration = useRef(0)
  const writing = useRef(0)
  const [writePending, setWritePending] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [stored, setStored] = useState(false)
  const [storageReady, setStorageReady] = useState(false)
  const [candidates, setCandidates] = useState<RecoveryRecord[]>([])
  const [review, setReview] = useState<RecoveryReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const applied = useRef<RecoveryRecord[]>([])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      ++loadGeneration.current
    }
  }, [])
  const currentOperation = (generation: number, scope: RecoveryScope) =>
    mounted.current &&
    generation === loadGeneration.current &&
    recoveryScopeKey(scope) === recoveryScopeKey(latest.current.scope)

  // Capture every committed edit and acknowledged baseline. The journal's
  // serialized queue retains typing that happened during an earlier save.
  useLayoutEffect(() => {
    const generation = ++writeGeneration.current
    ++writing.current
    setWritePending(true)
    void journal
      .write(options.document, options.base)
      .then(() => {
        if (mounted.current && generation === writeGeneration.current) {
          setStorageError(null)
          setStorageReady(true)
          setStored(!sameStoredDocument(options.document, options.base.document))
        }
      })
      .catch(cause => {
        if (mounted.current && generation === writeGeneration.current) {
          setStored(false)
          setStorageReady(false)
          setStorageError((cause as Error).message)
        }
      })
      .finally(() => {
        --writing.current
        if (mounted.current) setWritePending(writing.current > 0)
      })
    for (const record of applied.current.filter(record => sameStoredDocument(record.document, options.base.document))) {
      // Never erase a newer sequence written by the originating window.
      void browserRecoveryStore.remove(record.key, record.sequence).catch(() => undefined)
      applied.current = applied.current.filter(candidate => candidate !== record)
    }
  }, [journal, options.document, options.base.document, options.base.revision, options.base.versionId])

  /** Reauthorize, then list this account's copies, dropping any whose save the
   * server already holds. Returns null when a newer operation superseded it. */
  const loadCandidates = useCallback(
    async (generation: number, scope: RecoveryScope) => {
      const { head } = await currentHead(scope)
      if (!currentOperation(generation, scope)) return null
      const records = recoveryCandidates(await browserRecoveryStore.list(scope), scope)
      if (!currentOperation(generation, scope)) return null
      const remaining: RecoveryRecord[] = []
      for (const record of records) {
        if (!currentOperation(generation, scope)) return null
        if (record.key === journal.key || applied.current.some(copy => copy.key === record.key)) continue
        if (recoveryDisposition(record, head) === 'acknowledged') {
          await browserRecoveryStore.remove(record.key, record.sequence)
        } else remaining.push(record)
      }
      return currentOperation(generation, scope) ? remaining : null
    },
    [journal],
  )
  const refresh = useCallback(async () => {
    const generation = ++loadGeneration.current
    const scope = latest.current.scope
    // Do not expose even a title/date from local storage before reauthorizing.
    setCandidates([])
    setError(null)
    try {
      const remaining = await loadCandidates(generation, scope)
      if (remaining) setCandidates(remaining)
    } catch (cause) {
      if (mounted.current && generation === loadGeneration.current) {
        setReview(null)
        setError((cause as Error).message)
      }
    }
  }, [loadCandidates])
  /** Returning to the window re-checks the account without clearing the list
   * first: the click that returned focus here (for example from the canvas)
   * is often the author's click on “Review copy”, and removing that button or
   * superseding the review it starts made the first click do nothing. A failed
   * check still closes any review, hides the copies and supersedes every older
   * in-flight response, so another account's sign-in is never shown this work. */
  const revalidate = useCallback(async () => {
    const generation = loadGeneration.current
    const scope = latest.current.scope
    try {
      const remaining = await loadCandidates(generation, scope)
      if (remaining) setCandidates(remaining)
    } catch (cause) {
      if (!mounted.current || recoveryScopeKey(scope) !== recoveryScopeKey(latest.current.scope)) return
      ++loadGeneration.current
      setCandidates([])
      setReview(null)
      setError((cause as Error).message)
    }
  }, [loadCandidates])
  useEffect(() => {
    void refresh()
    const onFocus = () => {
      void revalidate()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh, revalidate])

  const openReview = async (record: RecoveryRecord) => {
    const scope = latest.current.scope
    const generation = ++loadGeneration.current
    busyGeneration.current = generation
    setBusy(true)
    setError(null)
    try {
      const { head } = await currentHead(scope)
      if (!currentOperation(generation, scope)) return
      if (!sameHead(head, latest.current.base))
        throw new Error(
          'The saved page changed since this editor opened. Reload it to compare with the latest draft; this browser copy is still kept.',
        )
      const copy = readRecoveryRecord(record, latest.current.scope)
      if (!copy) throw new Error('This browser copy is no longer available for recovery.')
      if (recoveryDisposition(copy, head) === 'acknowledged') {
        await refresh()
        return
      }
      setReview({ record: copy, head, changedBase: recoveryDisposition(copy, head) === 'changed-base' })
    } catch (cause) {
      if (currentOperation(generation, scope)) {
        setReview(null)
        setError((cause as Error).message)
      }
    } finally {
      if (mounted.current && busyGeneration.current === generation) setBusy(false)
    }
  }
  const applyReview = async (acceptChangedBase: boolean) => {
    if (!review || (review.changedBase && !acceptChangedBase) || !latest.current.canApply()) return
    const scope = latest.current.scope
    const generation = ++loadGeneration.current
    busyGeneration.current = generation
    setBusy(true)
    setError(null)
    try {
      const { head, definitions } = await currentHead(scope, review.record.document)
      if (!currentOperation(generation, scope)) return
      if (!sameHead(head, review.head) || !sameHead(head, latest.current.base) || !latest.current.canApply()) {
        throw new Error(
          'The page changed during this review. Cancel and reload to compare again. Your browser copy is still kept.',
        )
      }
      const current = recoveryCandidates(await browserRecoveryStore.list(scope), scope).find(
        copy => copy.key === review.record.key,
      )
      if (!currentOperation(generation, scope)) return
      if (!current || current.sequence !== review.record.sequence)
        throw new Error(
          'This browser copy changed in another window. Cancel and refresh the copies before reviewing it again.',
        )
      if (!mounted.current || recoveryScopeKey(scope) !== recoveryScopeKey(latest.current.scope)) return
      latest.current.onRecover(review.record.document, definitions)
      applied.current.push(review.record)
      setCandidates(copies => copies.filter(copy => copy.key !== review.record.key))
      setReview(null)
    } catch (cause) {
      if (currentOperation(generation, scope)) {
        if (cause instanceof RecoveryIdentityError) {
          setReview(null)
          setCandidates([])
        }
        setError((cause as Error).message)
      }
    } finally {
      if (mounted.current && busyGeneration.current === generation) setBusy(false)
    }
  }
  const discardReview = async () => {
    if (!review) return
    const scope = latest.current.scope
    const generation = ++loadGeneration.current
    busyGeneration.current = generation
    setBusy(true)
    setError(null)
    try {
      await currentHead(scope)
      if (!currentOperation(generation, scope)) return
      if (!(await browserRecoveryStore.remove(review.record.key, review.record.sequence)))
        throw new Error('This browser copy changed in another window. Cancel and refresh before discarding it.')
      if (!currentOperation(generation, scope)) return
      setCandidates(copies => copies.filter(copy => copy.key !== review.record.key))
      setReview(null)
    } catch (cause) {
      if (currentOperation(generation, scope)) {
        if (cause instanceof RecoveryIdentityError) {
          setReview(null)
          setCandidates([])
        }
        setError((cause as Error).message)
      }
    } finally {
      if (mounted.current && busyGeneration.current === generation) setBusy(false)
    }
  }
  return {
    candidates,
    review,
    busy,
    error,
    storageError,
    storageReady,
    stored,
    writePending,
    applyReady: options.canApply(),
    pending: () => writing.current > 0 || busy,
    refresh,
    openReview,
    applyReview,
    discardReview,
    closeReview: () => {
      if (!busy) {
        ++loadGeneration.current
        setReview(null)
        setError(null)
      }
    },
  }
}
