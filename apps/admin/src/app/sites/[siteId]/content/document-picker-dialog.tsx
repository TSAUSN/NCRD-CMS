'use client'
import styles from './lists.module.css'
import shared from '../../../../components/workspace.module.css'
import { useEffect, useRef, useState } from 'react'
import { IconSearch } from '../../../../components/icons.tsx'
import { fetchDocuments, uploadSiteDocument, type SiteDocument } from '../../../../lib/document-library.ts'
import { Dialog } from './collection-dialog.tsx'

export function DocumentPickerDialog({
  siteId,
  documents,
  onClose,
  onChoose,
  onUploaded,
  forPage = false,
}: {
  siteId: string
  documents: SiteDocument[]
  onClose: () => void
  forPage?: boolean
  onChoose: (document: SiteDocument) => void
  onUploaded: (document: SiteDocument) => void
}) {
  const [search, setSearch] = useState('')
  const [available, setAvailable] = useState(documents)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(documents.length)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      fetchDocuments(siteId, { search, category: '', archived: false, page })
        .then(result => {
          if (!cancelled) {
            setAvailable(result.documents)
            setTotal(result.total)
            setLoading(false)
          }
        })
        .catch(reason => {
          if (!cancelled) {
            setAvailable([])
            setLoading(false)
            setError(reason instanceof Error ? reason.message : 'The document library could not be loaded.')
          }
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [siteId, search, page])
  function dismiss() {
    alive.current = false
    onClose()
  }
  async function upload(file: File | undefined) {
    if (!file || inFlight.current) return
    inFlight.current = true
    setUploading(true)
    setError(null)
    try {
      const document = await uploadSiteDocument(siteId, file)
      // Closing the picker never inserts a late link into the record. Keep
      // the uploaded asset available when the picker is opened again.
      onUploaded(document)
      if (alive.current) onChoose(document)
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'The upload could not be confirmed. Try the same file again.')
    } finally {
      inFlight.current = false
      if (alive.current) setUploading(false)
    }
  }
  const visible = available
  return (
    <Dialog
      title="Choose a PDF"
      lede={
        forPage
          ? 'Upload or select a document for this site. The link stays in your draft until you save and publish this page. PDFs download as files.'
          : 'Upload or select a document for this site. The link stays in your draft until you save and publish the list. PDFs download as files.'
      }
      onClose={dismiss}
    >
      <div className={forPage ? shared.denseStack : 'csv-tools'}>
        <section>
          <label className={forPage ? styles.pageDocumentUpload : 'csv-file'}>
            Upload a PDF (up to 25 MB)
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={uploading}
              onChange={event => {
                void upload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          {uploading && <p role="status">Checking and uploading the document…</p>}
          {error && (
            <p role="alert" className="error-inline">
              {error}
            </p>
          )}
        </section>
      </div>
      <div className={forPage ? styles.pageDocumentSearch : 'collection-search media-picker-search'}>
        <IconSearch size={16} />
        <input
          type="search"
          aria-label="Search PDFs"
          placeholder="Search documents"
          value={search}
          onChange={event => {
            setLoading(true)
            setSearch(event.target.value)
            setPage(1)
          }}
        />
      </div>
      {loading ? (
        <p role="status">Loading available PDFs…</p>
      ) : visible.length === 0 ? (
        <div className={forPage ? styles.pageDocumentEmpty : 'collection-empty compact'}>
          <h3>No documents match</h3>
          <p>Upload a PDF above, or close this window to paste an external link.</p>
        </div>
      ) : (
        <ul className="collection-document-list">
          {visible.map(document => (
            <li key={document.id}>
              <button type="button" className="secondary" disabled={uploading} onClick={() => onChoose(document)}>
                {document.originalName} · {Math.max(1, Math.ceil(document.bytes / 1024))} KB
              </button>
            </li>
          ))}
        </ul>
      )}
      <footer className={forPage ? styles.pageDocumentFooter : undefined}>
        <button
          type="button"
          className="secondary"
          disabled={loading || page === 1}
          onClick={() => {
            setLoading(true)
            setPage(page - 1)
          }}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="secondary"
          disabled={loading || page * 50 >= total}
          onClick={() => {
            setLoading(true)
            setPage(page + 1)
          }}
        >
          Next
        </button>
        <button type="button" className="secondary" onClick={dismiss}>
          Cancel
        </button>
      </footer>
    </Dialog>
  )
}
