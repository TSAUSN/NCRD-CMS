import { siteFileAddress } from '@cms/schema'
import { Button, Card, EmptyState, Field } from '../../../../components/ui/index.ts'
import { removeReviewedFile, fileMoveTarget } from '../../../../lib/site-file-bundle.ts'
import styles from './files.module.css'
import type { SiteFilesModel, SiteFilesProps } from './use-site-files.ts'
import { formatFileBytes } from '../../../../lib/site-file-bundle.ts'

export function SiteFileLoading({ model, props }: { model: SiteFilesModel; props: SiteFilesProps }) {
  const {
    bundle,
    setBundle,
    setLocalFile,
    setSource,
    setReplacement,
    busy,
    fileInput,
    byId,
    move,
    scope,
    futureScope,
  } = model
  const bound = new Set([...bundle.scripts, ...bundle.styles].map(item => item.fileId))
  const rows = [
    ...bundle.scripts.map((item, index) => ({
      fileId: item.fileId,
      type: 'scripts' as const,
      index,
      pages: item.pages,
    })),
    ...bundle.styles.map((item, index) => ({ fileId: item.fileId, type: 'styles' as const, index, pages: item.pages })),
    ...bundle.files
      .filter(id => !bound.has(id))
      .map(fileId => ({ fileId, type: 'asset' as const, index: 0, pages: [] })),
  ]
  return (
    <>
      <Card title="Files in this version">
        <p>
          Scripts run in the order shown within each position. An empty chosen-page list means all pages of{' '}
          {props.siteName}.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No site scripts or files">
            Pages show their content before JavaScript runs. Add files only when the site's interactions need them.
          </EmptyState>
        ) : (
          <div className={styles.stack}>
            {rows.map(row => {
              const file = byId.get(row.fileId)
              if (!file) return null
              const binding = row.type === 'scripts' ? bundle.scripts[row.index] : null
              const choice = row.type === 'scripts' ? binding : row.type === 'styles' ? bundle.styles[row.index] : null
              return (
                <article
                  className={styles.file}
                  key={row.type + '-' + row.index + '-' + file.id}
                  aria-label={file.name + ' loading choices'}
                >
                  <div className={styles.heading}>
                    <div>
                      <h3>{file.name}</h3>
                      <p className={styles.meta}>
                        {file.kind} · {formatFileBytes(file.bytes)}
                        <br />
                        {file.source}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      {row.type !== 'asset' && (
                        <>
                          <Button
                            variant="tertiary"
                            size="s"
                            aria-label={'Move ' + file.name + ' earlier'}
                            disabled={
                              busy ||
                              props.archived ||
                              fileMoveTarget(bundle, row.type as 'scripts' | 'styles', row.index, -1) < 0
                            }
                            onClick={() => move(row.index, -1, row.type as 'scripts' | 'styles')}
                          >
                            ↑
                          </Button>
                          <Button
                            variant="tertiary"
                            size="s"
                            aria-label={'Move ' + file.name + ' later'}
                            disabled={
                              busy ||
                              props.archived ||
                              fileMoveTarget(bundle, row.type as 'scripts' | 'styles', row.index, 1) < 0
                            }
                            onClick={() => move(row.index, 1, row.type as 'scripts' | 'styles')}
                          >
                            ↓
                          </Button>
                          <Button
                            variant="secondary"
                            size="s"
                            disabled={busy || props.archived}
                            onClick={() => {
                              setReplacement(file.id)
                              setSource(file.source)
                              setLocalFile(null)
                              if (fileInput.current) {
                                fileInput.current.value = ''
                                fileInput.current.focus()
                                fileInput.current.scrollIntoView({ block: 'center' })
                              }
                            }}
                          >
                            Replace {file.name}
                          </Button>
                        </>
                      )}
                      <Button
                        variant="destructive"
                        size="s"
                        disabled={busy || props.archived}
                        onClick={() => setBundle(current => removeReviewedFile(current, file.id))}
                      >
                        Remove {file.name}
                      </Button>
                    </div>
                  </div>
                  {row.type !== 'asset' && (
                    <>
                      <div className={styles.controls}>
                        {binding && (
                          <>
                            <Field id={'position-' + row.index} label="Position">
                              <select
                                value={binding.position}
                                disabled={busy || props.archived}
                                onChange={event => {
                                  const value = event.target.value as typeof binding.position
                                  setBundle(current => ({
                                    ...current,
                                    scripts: current.scripts.map((item, index) =>
                                      index === row.index ? { ...item, position: value } : item,
                                    ),
                                  }))
                                }}
                              >
                                <option value="head">In the page head</option>
                                <option value="body-start">Before page content</option>
                                <option value="body-end">After page content</option>
                              </select>
                            </Field>
                            <Field id={'loading-' + row.index} label="Loading">
                              <select
                                value={binding.loading}
                                disabled={busy || props.archived}
                                onChange={event => {
                                  const value = event.target.value as typeof binding.loading
                                  setBundle(current => ({
                                    ...current,
                                    scripts: current.scripts.map((item, index) =>
                                      index === row.index ? { ...item, loading: value } : item,
                                    ),
                                  }))
                                }}
                              >
                                <option value="normal">In order</option>
                                <option value="defer">After the HTML is ready</option>
                                <option value="async">As soon as downloaded</option>
                              </select>
                            </Field>
                          </>
                        )}
                        <Field id={'scope-' + row.type + '-' + row.index} label="Show on">
                          <select
                            value={row.pages.length ? 'chosen' : 'all'}
                            disabled={busy || props.archived || !props.pages.length}
                            onChange={event =>
                              scope(
                                row.type as 'scripts' | 'styles',
                                row.index,
                                event.target.value === 'all' ? [] : [props.pages[0]!.id],
                              )
                            }
                          >
                            <option value="all">All pages</option>
                            <option value="chosen">Chosen pages</option>
                          </select>
                        </Field>
                      </div>
                      {row.pages.length > 0 && (
                        <fieldset className={styles.pages} disabled={busy || props.archived}>
                          <legend>Chosen pages for {file.name}</legend>
                          <p className={styles.meta}>Keep at least one page chosen, or select All pages above.</p>
                          {props.pages.map(page => (
                            <label key={page.id}>
                              <input
                                type="checkbox"
                                checked={row.pages.includes(page.id)}
                                disabled={row.pages.length === 1 && row.pages[0] === page.id}
                                onChange={event =>
                                  scope(
                                    row.type as 'scripts' | 'styles',
                                    row.index,
                                    event.target.checked
                                      ? [...row.pages, page.id]
                                      : row.pages.filter(id => id !== page.id),
                                  )
                                }
                              />
                              {page.title}
                            </label>
                          ))}
                        </fieldset>
                      )}
                    </>
                  )}
                  {row.type !== 'asset' && row.pages.length > 0 && bundle.original?.newPages && (
                    <label className={styles.ack}>
                      <input
                        type="checkbox"
                        checked={choice?.newPages === true}
                        disabled={busy || props.archived}
                        onChange={event =>
                          futureScope(row.type as 'scripts' | 'styles', row.index, event.target.checked)
                        }
                      />
                      Also use {file.name} on new pages with this original design
                    </label>
                  )}
                  {bundle.paths?.some(path => path.fileId === file.id) && (
                    <p className={styles.meta}>
                      Web addresses:{' '}
                      {bundle.paths
                        .filter(path => path.fileId === file.id)
                        .map(path => path.path)
                        .join(', ')}
                    </p>
                  )}
                  <details>
                    <summary>Advanced</summary>
                    <p className={styles.hash}>SHA-256 {file.sha256}</p>
                    <a href={siteFileAddress(file)} target="_blank" rel="noopener">
                      View {file.name}
                    </a>
                  </details>
                </article>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}
