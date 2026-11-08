import { useEffect, useRef, useState } from 'react'
import { requestLocalDraftNavigation, useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  DEFAULT_DOCUMENT_LIBRARY_QUERY,
  DOCUMENT_LIBRARY_PAGE_SIZE,
  fetchDocuments,
  organizeDocument,
  uploadSiteDocument,
  type ManagedDocument,
  type DocumentLibraryQuery,
  type DocumentLibraryResult,
} from '../../../../lib/document-library.ts'

export type DocumentsProps = { siteId: string; initial: DocumentLibraryResult; canEdit: boolean }

export function useDocumentLibrary({ siteId, initial, canEdit }: DocumentsProps) {
  const [result, setResult] = useState(initial)
  const [query, setQuery] = useState(DEFAULT_DOCUMENT_LIBRARY_QUERY)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ManagedDocument | null>(null)
  const [category, setCategory] = useState('')
  const [pendingArchive, setPendingArchive] = useState(false)
  const [working, setWorking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)
  const sequence = useRef(0)
  const activeQuery = useRef(query)
  const dirty = selected !== null && category !== selected.category
  function leaveState() {
    return {
      dirty,
      pending: lock.current,
      draft: {
        label: 'PDF category',
        saveMode: 'library' as const,
        saveDraft: () => (selected ? mutate(selected.archived) : Promise.resolve({ ok: true })),
        discard: () => setCategory(selected?.category ?? ''),
      },
    }
  }
  useNavigationGuard(leaveState)
  function navigate(proceed: () => void) {
    if (requestLocalDraftNavigation(leaveState, proceed)) proceed()
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || lock.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function refresh(next = query) {
    const ticket = ++sequence.current
    setLoading(true)
    try {
      const list = await fetchDocuments(siteId, next)
      if (ticket === sequence.current) {
        setResult(list)
        setError('')
        if (next.page > 1 && list.documents.length === 0)
          setQuery({ ...next, page: Math.max(1, Math.ceil(list.total / DOCUMENT_LIBRARY_PAGE_SIZE)) })
      }
      return list
    } catch (reason) {
      if (ticket === sequence.current)
        setError(reason instanceof Error ? reason.message : 'The library could not be refreshed.')
      throw reason
    } finally {
      if (ticket === sequence.current) setLoading(false)
    }
  }
  useEffect(() => {
    activeQuery.current = query
    if (query === DEFAULT_DOCUMENT_LIBRARY_QUERY) return
    void refresh(query).catch(() => {})
    return () => {
      sequence.current++
    }
  }, [query, siteId])
  function selectNow(document: ManagedDocument | null) {
    setSelected(document)
    setCategory(document?.category ?? '')
    setError('')
    setNotice('')
  }
  async function mutate(archived: boolean) {
    if (!selected) return { ok: true }
    if (lock.current) return { ok: false, message: 'Wait for the current document action to finish.' }
    lock.current = true
    setWorking(true)
    setError('')
    setNotice('')
    let completed = false
    try {
      const revision = await organizeDocument(siteId, {
        id: selected.id,
        revision: selected.revision,
        category: category.trim(),
        archived,
      })
      completed = true
      setSelected({ ...selected, category: category.trim(), archived, revision })
      setCategory(category.trim())
      setPendingArchive(false)
      setNotice(
        archived
          ? 'Document archived. Existing content links are preserved.'
          : 'Document saved and available to choose.',
      )
      await refresh(activeQuery.current)
    } catch (reason) {
      const message = completed
        ? 'The document was saved, but the list could not be refreshed. Refresh the list to see it.'
        : reason instanceof Error
          ? reason.message
          : 'The document change could not be confirmed.'
      setError(message)
      return { ok: completed, message }
    } finally {
      lock.current = false
      setWorking(false)
    }
    return { ok: true }
  }
  async function upload(file: File | undefined, replacement = false) {
    if (!file || lock.current) return
    lock.current = true
    setWorking(true)
    setError('')
    setNotice('')
    let completed = false
    try {
      const document = await uploadSiteDocument(siteId, file)
      completed = true
      setNotice(
        replacement
          ? `“${document.originalName}” is ready. Choose it in the page or collection draft you want to update. Existing links still use their original PDF.`
          : `“${document.originalName}” is ready to choose in your content.`,
      )
      await refresh(activeQuery.current)
    } catch (reason) {
      setError(
        completed
          ? 'The PDF was uploaded, but the list could not be refreshed. Refresh before uploading again.'
          : reason instanceof Error
            ? reason.message
            : 'The upload could not be confirmed.',
      )
    } finally {
      lock.current = false
      setWorking(false)
    }
  }

  function changeQuery(patch: Partial<DocumentLibraryQuery>) {
    navigate(() => {
      selectNow(null)
      setQuery(current => ({ ...current, page: 1, ...patch }))
    })
  }

  return {
    canEdit,
    result,
    query,
    search,
    setSearch,
    selected,
    category,
    setCategory,
    pendingArchive,
    setPendingArchive,
    working,
    loading,
    error,
    notice,
    dirty,
    navigate,
    selectNow,
    refresh,
    changeQuery,
    mutate,
    upload,
  }
}

export type DocumentLibraryModel = ReturnType<typeof useDocumentLibrary>
