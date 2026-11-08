import { Button, EmptyState } from '../../../../components/ui/index.ts'
import { formatBytes } from '../../../../lib/media-library.ts'
import { DOCUMENT_LIBRARY_PAGE_SIZE } from '../../../../lib/document-library.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import type { DocumentLibraryModel } from './use-document-library.ts'

export function DocumentResults({ model }: { model: DocumentLibraryModel }) {
  const { loading, result, query, selected, working, navigate, selectNow, changeQuery } = model
  return (
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
        <ul className={listInspectorStyles.listRows}>
          {result.documents.map(document => (
            <li key={document.id}>
              <button
                type="button"
                className={selectionControlsStyles.optionCard + ' ' + workspaceFormsStyles.actions}
                data-layout="record"
                data-selected={selected?.id === document.id}
                disabled={working || loading}
                aria-pressed={selected?.id === document.id}
                onClick={() => navigate(() => selectNow(document))}
              >
                <span className="document-mark">PDF</span>
                <span className={recordTableStyles.rowCopy}>
                  <strong className={recordTableStyles.truncateValue} title={document.originalName}>
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
      <div className={reviewWorkbenchStyles.workbenchActions}>
        <Button
          variant="secondary"
          type="button"
          className="secondary"
          disabled={working || loading || query.page === 1}
          onClick={() => changeQuery({ page: query.page - 1 })}
        >
          Previous
        </Button>
        <span>Page {query.page}</span>
        <Button
          variant="secondary"
          type="button"
          className="secondary"
          disabled={working || loading || query.page * DOCUMENT_LIBRARY_PAGE_SIZE >= result.total}
          onClick={() => changeQuery({ page: query.page + 1 })}
        >
          Next
        </Button>
      </div>
    </section>
  )
}
