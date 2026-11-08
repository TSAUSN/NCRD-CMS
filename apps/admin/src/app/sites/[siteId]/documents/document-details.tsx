import type { ReactNode } from 'react'
import { Button, Disclosure, Field, TextLink } from '../../../../components/ui/index.ts'
import { formatBytes } from '../../../../lib/media-library.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import type { DocumentLibraryModel } from './use-document-library.ts'

export function DocumentDetails({ model, feedback }: { model: DocumentLibraryModel; feedback: ReactNode }) {
  const { selected, canEdit, mutate, category, working, setCategory, dirty, navigate, upload, setPendingArchive } =
    model
  return (
    <aside className={listInspectorStyles.detailPanel} data-empty={!selected} aria-label="Document details">
      <div className={listInspectorStyles.detailPanelBody + ' ' + listInspectorStyles.formStack}>
        {selected ? (
          <>
            <p className="eyebrow">{selected.archived ? 'Archived PDF' : 'Selected PDF'}</p>
            <h2
              className={recordTableStyles.truncateValue + ' ' + siteSummaryStyles.cardTitle}
              title={selected.originalName}
            >
              {selected.originalName}
            </h2>
            <p>{formatBytes(selected.bytes)} · PDF document</p>
            <TextLink href={selected.url} target="_blank" rel="noopener noreferrer">
              Open PDF in a new tab
            </TextLink>
            <p className="hint">
              Use “Choose a PDF” in a collection, or this link in a page. Saving or uploading a PDF does not publish it.
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
                  className={listInspectorStyles.formStack}
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
                  <div className={workspaceFormsStyles.actions}>
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
          <div className={listInspectorStyles.formStack}>
            <h2 className={siteSummaryStyles.cardTitle}>Choose a document</h2>
            <p>Review its file details, category and link. Archived documents remain available to existing content.</p>
          </div>
        )}
      </div>
    </aside>
  )
}
