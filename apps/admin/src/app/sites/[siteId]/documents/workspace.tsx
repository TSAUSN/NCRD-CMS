'use client'
import { Button, Card, CardContent, Field } from '../../../../components/ui/index.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import mediaUi from '../../../../components/media-ui.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import ownedStyles from './workspace-styles.module.css'
import { useDocumentLibrary, type DocumentsProps } from './use-document-library.ts'
import { DocumentResults } from './document-results.tsx'
import { DocumentDetails } from './document-details.tsx'

export function DocumentsWorkspace(props: DocumentsProps) {
  const model = useDocumentLibrary(props)
  const {
    error,
    working,
    navigate,
    selectNow,
    refresh,
    query,
    changeQuery,
    search,
    setSearch,
    result,
    canEdit,
    upload,
    selected,
    notice,
    dirty,
    pendingArchive,
    mutate,
    setPendingArchive,
  } = model
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
    <div className={listInspectorStyles.formStack + ' ' + workspaceFormsStyles.compactForm}>
      <div className={reviewWorkbenchStyles.workbenchActions}>
        <form
          className={workspaceFormsStyles.toolbarField}
          onSubmit={event => {
            event.preventDefault()
            changeQuery({ search: search.trim() })
          }}
        >
          <Field id="document-search" label="Search documents" density="compact">
            <div className={ownedStyles.inputActions}>
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
            onChange={event => changeQuery({ category: event.target.value })}
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
            onChange={event => changeQuery({ archived: event.target.value === 'true' })}
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
        <DocumentResults model={model} />
        <DocumentDetails model={model} feedback={feedback} />
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
