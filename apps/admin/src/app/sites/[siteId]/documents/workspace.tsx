'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, Card, CardContent, Disclosure, Field, TextLink, EmptyState } from '../../../../components/ui/index.ts'
import mediaUi from '../../../../components/media-ui.module.css'
import shared from '../../../../components/workspace.module.css'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { requestLocalDraftNavigation, useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  fetchDocuments,
  organizeDocument,
  uploadSiteDocument,
  type ManagedDocument,
  type DocumentLibraryQuery,
  type DocumentLibraryResult,
} from '../../../../lib/document-library.ts'
import { formatBytes } from '../../../../lib/media-library.ts'

const initialQuery: DocumentLibraryQuery = { search: '', category: '', archived: false, page: 1 }
export function DocumentsWorkspace({
  siteId,
  initial,
  canEdit,
}: {
  siteId: string
  initial: DocumentLibraryResult
  canEdit: boolean
}) {
  const [result, setResult] = useState(initial),
    [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<ManagedDocument | null>(null)
  const [category, setCategory] = useState(''),
    [pendingArchive, setPendingArchive] = useState(false)
  const [working, setWorking] = useState(false),
    [loading, setLoading] = useState(false)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const lock = useRef(false),
    sequence = useRef(0),
    activeQuery = useRef(query)
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
          setQuery({ ...next, page: Math.max(1, Math.ceil(list.total / 50)) })
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
  const feedback = error && (
    <p className="notice notice-error" role="alert">
      {error}{' '}
      <Button
        variant="secondary"
        type="button"
        className="secondary small"
        disabled={working}
        onClick={() =>
          navigate(() => {
            selectNow(null)
            void refresh().catch(() => {})
          })
        }
      >
        Refresh list
      </Button>
    </p>
  )
  return (
    <div className={shared.formStack + ' ' + shared.compactForm}>
      <div className={shared.workbenchActions}>
        <form
          className={shared.toolbarField}
          onSubmit={event => {
            event.preventDefault()
            navigate(() => {
              selectNow(null)
              setQuery({ ...query, search: search.trim(), page: 1 })
            })
          }}
        >
          <Field id="document-search" label="Search documents" density="compact">
            <div className={shared.inputActions}>
              <input
                id="document-search"
                type="search"
                value={search}
                maxLength={200}
                onChange={event => setSearch(event.target.value)}
                disabled={working}
                placeholder="File name or category"
              />
              <Button variant="secondary" type="submit" className="secondary" disabled={working}>
                Search
              </Button>
            </div>
          </Field>
        </form>
        <Field id="document-category-filter" label="Category" density="compact">
          <select
            aria-label="Filter document category"
            value={query.category}
            disabled={working}
            onChange={event => {
              const category = event.target.value
              navigate(() => {
                selectNow(null)
                setQuery({ ...query, category, page: 1 })
              })
            }}
          >
            <option value="">All categories</option>
            {result.categories.map(value => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </Field>
        <Field id="document-status-filter" label="Show" density="compact">
          <select
            aria-label="Document status"
            value={String(query.archived)}
            disabled={working}
            onChange={event => {
              const archived = event.target.value === 'true'
              navigate(() => {
                selectNow(null)
                setQuery({ ...query, archived, page: 1 })
              })
            }}
          >
            <option value="false">Available documents</option>
            <option value="true">Archived documents</option>
          </select>
        </Field>
      </div>
      {canEdit && (
        <Card density="compact">
          <CardContent>
            <Field
              id="upload-pdf"
              label="Upload a PDF"
              help="Up to 25 MB. Documents stay private until used in published content."
              density="compact"
              helpAfter
            >
              <input
                aria-label="Upload a PDF"
                type="file"
                accept=".pdf,application/pdf"
                disabled={working}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) navigate(() => void upload(file))
                }}
              />
            </Field>
          </CardContent>
        </Card>
      )}
      {!selected && feedback}
      {notice && (
        <p className="notice notice-ok" role="status">
          {notice}
        </p>
      )}
      {dirty && (
        <p className="notice notice-info">
          The category has unsaved changes. Saving updates this PDF in the Media library immediately; page and story
          content stays unchanged.
        </p>
      )}
      <div className={mediaUi.layout} data-details="true">
        <section aria-label="Document library" aria-busy={loading}>
          <p className="hint">
            {loading
              ? 'Refreshing…'
              : `${result.total} ${query.archived ? 'archived' : 'available'} ${result.total === 1 ? 'document' : 'documents'}`}
          </p>
          {result.documents.length === 0 ? (
            <EmptyState title="No documents here yet">
              {query.search || query.category
                ? 'Try another search or category.'
                : query.archived
                  ? 'Archived PDFs will appear here.'
                  : 'Upload a PDF to make it available in your content editor.'}
            </EmptyState>
          ) : (
            <ul className={shared.listRows}>
              {result.documents.map(document => (
                <li key={document.id}>
                  <button
                    type="button"
                    className={shared.optionCard + ' ' + shared.actions}
                    data-layout="record"
                    data-selected={selected?.id === document.id}
                    disabled={working || loading}
                    aria-pressed={selected?.id === document.id}
                    onClick={() => navigate(() => selectNow(document))}
                  >
                    <span className="document-mark">PDF</span>
                    <span className={shared.rowCopy}>
                      <strong className={shared.truncateValue} title={document.originalName}>
                        {document.originalName}
                      </strong>
                      <small>
                        {document.category || 'Uncategorized'} · {formatBytes(document.bytes)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className={shared.workbenchActions}>
            <Button
              variant="secondary"
              type="button"
              className="secondary"
              disabled={working || loading || query.page === 1}
              onClick={() =>
                navigate(() => {
                  selectNow(null)
                  setQuery({ ...query, page: query.page - 1 })
                })
              }
            >
              Previous
            </Button>
            <span>Page {query.page}</span>
            <Button
              variant="secondary"
              type="button"
              className="secondary"
              disabled={working || loading || query.page * 50 >= result.total}
              onClick={() =>
                navigate(() => {
                  selectNow(null)
                  setQuery({ ...query, page: query.page + 1 })
                })
              }
            >
              Next
            </Button>
          </div>
        </section>
        <aside className={shared.detailPanel} data-empty={!selected} aria-label="Document details">
          <div className={shared.detailPanelBody + ' ' + shared.formStack}>
            {selected ? (
              <>
                <p className="eyebrow">{selected.archived ? 'Archived PDF' : 'Selected PDF'}</p>
                <h2 className={shared.truncateValue + ' ' + shared.cardTitle} title={selected.originalName}>
                  {selected.originalName}
                </h2>
                <p>{formatBytes(selected.bytes)} · PDF document</p>
                <TextLink href={selected.url} target="_blank" rel="noopener noreferrer">
                  Open PDF in a new tab
                </TextLink>
                <p className="hint">
                  Use “Choose a PDF” in a collection, or this link in a page. Saving or uploading a PDF does not publish
                  it.
                </p>
                <Field id="document-link" label="Document link" density="compact">
                  <input
                    type="text"
                    aria-label="Document link"
                    readOnly
                    value={selected.url}
                    onFocus={event => event.currentTarget.select()}
                  />
                </Field>
                {!canEdit && feedback}
                {canEdit && (
                  <>
                    <form
                      className={shared.formStack}
                      onSubmit={event => {
                        event.preventDefault()
                        void mutate(selected.archived)
                      }}
                    >
                      <Field id="document-category" label="Category (optional)" density="compact">
                        <input
                          type="text"
                          aria-label="Document category"
                          maxLength={80}
                          value={category}
                          disabled={working}
                          onChange={event => setCategory(event.target.value)}
                        />
                      </Field>
                      <div className={shared.actions}>
                        <Button variant="primary" type="submit" disabled={working || !dirty}>
                          Save category
                        </Button>
                        {dirty && (
                          <Button
                            variant="secondary"
                            type="button"
                            className="secondary"
                            disabled={working}
                            onClick={() => setCategory(selected.category)}
                          >
                            Discard change
                          </Button>
                        )}
                      </div>
                    </form>
                    {feedback}
                    <Disclosure title="Replace in a draft">
                      <p>
                        Upload the new PDF, then choose its link in the content you want to change. The original remains
                        available to existing pages and history.
                      </p>
                      <input
                        aria-label="Upload replacement PDF"
                        type="file"
                        accept=".pdf,application/pdf"
                        disabled={working}
                        onChange={event => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) navigate(() => void upload(file, true))
                        }}
                      />
                    </Disclosure>
                    <Button
                      variant="secondary"
                      type="button"
                      className="secondary"
                      disabled={working || dirty}
                      onClick={() => (selected.archived ? void mutate(false) : setPendingArchive(true))}
                    >
                      {selected.archived ? 'Restore to library' : 'Archive document'}
                    </Button>
                  </>
                )}
              </>
            ) : (
              <div className={shared.formStack}>
                <h2 className={shared.cardTitle}>Choose a document</h2>
                <p>
                  Review its file details, category and link. Archived documents remain available to existing content.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
      {pendingArchive && selected && (
        <ConfirmDialog
          title="Archive this document?"
          what={`“${selected.originalName}” will leave future PDF selections.`}
          reassurance="Existing draft, live and history links keep their original file. You can restore it to the library."
          confirmLabel="Archive document"
          pending={working}
          onConfirm={() => void mutate(true)}
          onCancel={() => setPendingArchive(false)}
        />
      )}
    </div>
  )
}
