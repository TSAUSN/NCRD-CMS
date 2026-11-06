'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SiteFileView, siteFileAddress, nativeAliasPaths, type SiteFileBundle, type SiteFileKind } from '@cms/schema'
import { Button, Card, Dialog, EmptyState, Field, StatusPill } from '../../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  addReviewedFile,
  removeReviewedFile,
  removeOriginalLayouts,
  describeFileLoading,
  fileMoveTarget,
} from '../../../../lib/site-file-bundle.ts'
import { approveSiteFiles } from './actions.ts'
import styles from './files.module.css'
type FileView = import('@cms/schema').SiteFileView
type Version = { id: string; version: string; bundle: SiteFileBundle; reviewed_at: string }
type Props = {
  nativeResources: { kind: 'media' | 'asset'; id: string; name: string; bytes: number; source: string }[]
  siteId: string
  siteName: string
  archived: boolean
  revision: string
  draftVersionId: string | null
  publishedVersionId: string | null
  files: FileView[]
  bundle: SiteFileBundle
  versions: Version[]
  pages: { id: string; title: string }[]
}
const bytes = (size: number) => size.toLocaleString('en-US') + ' bytes'
export function SiteFilesWorkspace(props: Props) {
  const router = useRouter(),
    [bundle, setBundle] = useState(props.bundle),
    [baseline, setBaseline] = useState(props.bundle),
    [revision, setRevision] = useState(props.revision),
    [savedVersion, setSavedVersion] = useState(props.draftVersionId)
  const [files, setFiles] = useState(props.files),
    [localFile, setLocalFile] = useState<File | null>(null),
    [source, setSource] = useState(''),
    [kind, setKind] = useState<SiteFileKind>('script'),
    [replacement, setReplacement] = useState<string | undefined>()
  const [busy, setBusy] = useState(false),
    [review, setReview] = useState(false),
    [ack, setAck] = useState(false),
    [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null)
  const inFlight = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    alert = useRef<HTMLParagraphElement>(null)
  const dirty = JSON.stringify(bundle) !== JSON.stringify(baseline),
    byId = new Map(files.map(file => [file.id, file]))
  useNavigationGuard(() => ({ dirty: dirty || !!localFile, pending: inFlight.current }))
  useEffect(() => {
    if (notice?.error) alert.current?.focus()
  }, [notice])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || localFile || inFlight.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, localFile])
  function beginReview() {
    setAck(false)
    setNotice(null)
    setReview(true)
  }
  async function upload() {
    if (inFlight.current || !localFile || props.archived) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      const response = await fetch('/api/sites/' + props.siteId + '/files', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-site-file-name': encodeURIComponent(localFile.name),
          'x-site-file-source': encodeURIComponent(source),
          'x-site-file-kind': kind,
        },
        body: localFile,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(typeof result.error === 'string' ? result.error : 'The file could not be added.')
      const file = SiteFileView.parse(result.file)
      setBundle(current => addReviewedFile(current, file, replacement))
      setFiles(current => (current.some(old => old.id === file.id) ? current : [...current, file]))
      setLocalFile(null)
      setSource('')
      setReplacement(undefined)
      if (fileInput.current) fileInput.current.value = ''
      setNotice({
        error: false,
        text: 'File added to your choices. Review the complete list before approving it; nothing has been published.',
      })
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : 'The file could not be added.' })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  async function approve() {
    if (inFlight.current || !ack || props.archived) return
    inFlight.current = true
    setBusy(true)
    try {
      const result = await approveSiteFiles(props.siteId, revision, bundle, ack)
      if (!result.ok) {
        setNotice({ error: true, text: result.message })
        return
      }
      setRevision(result.revision)
      setSavedVersion(result.versionId)
      setBaseline(structuredClone(bundle))
      setReview(false)
      setNotice({ error: false, text: 'Reviewed version saved. Publish it through the site release when ready.' })
      router.refresh()
    } catch {
      setNotice({
        error: true,
        text: 'The review could not be confirmed. Your choices are still here; refresh the current version before retrying.',
      })
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  function move(index: number, direction: -1 | 1, type: 'scripts' | 'styles') {
    setBundle(current => {
      const next = structuredClone(current),
        items = next[type],
        target = fileMoveTarget(current, type, index, direction)
      if (target < 0) return current
      ;[items[index], items[target]] = [items[target]!, items[index]!]
      return next
    })
  }
  function scope(type: 'scripts' | 'styles', index: number, pages: string[]) {
    setBundle(current => ({
      ...current,
      [type]: current[type].map((item, at) => (at === index ? { ...item, pages } : item)),
    }))
  }
  function futureScope(type: 'scripts' | 'styles', index: number, newPages: boolean) {
    setBundle(current => ({
      ...current,
      [type]: current[type].map((item, at) => (at === index ? { ...item, newPages } : item)),
    }))
  }
  const rows = [
    ...bundle.scripts.map((item, index) => ({
      fileId: item.fileId,
      type: 'scripts' as const,
      index,
      pages: item.pages,
    })),
    ...bundle.styles.map((item, index) => ({ fileId: item.fileId, type: 'styles' as const, index, pages: item.pages })),
    ...bundle.files
      .filter(id => !bundle.scripts.some(item => item.fileId === id) && !bundle.styles.some(item => item.fileId === id))
      .map(fileId => ({ fileId, type: 'asset' as const, index: 0, pages: [] })),
  ]
  const changed = JSON.stringify(baseline) !== JSON.stringify(bundle),
    removed = baseline.files.filter(id => !bundle.files.includes(id)).map(id => byId.get(id)?.name ?? 'Saved file')
  return (
    <div className={styles.workspace}>
      <div className={styles.heading}>
        <div>
          <StatusPill
            status={
              props.publishedVersionId
                ? savedVersion === props.publishedVersionId
                  ? 'Live'
                  : 'Live · changes not published'
                : 'Draft'
            }
          />
          <p>
            {dirty
              ? 'File choices have not been reviewed yet.'
              : 'Every reviewed version is retained. Saving a review keeps it private until you publish.'}
          </p>
        </div>
        <div className={styles.actions}>
          {dirty ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setBundle(structuredClone(baseline))
                  setNotice(null)
                }}
              >
                Discard file choices
              </Button>
              <Button disabled={busy || props.archived} onClick={beginReview}>
                Review file changes
              </Button>
            </>
          ) : savedVersion !== props.publishedVersionId && savedVersion ? (
            <Link className="btn publish" href={'/sites/' + props.siteId + '/publishing?area=site-look'}>
              Review publication
            </Link>
          ) : null}
        </div>
      </div>
      {notice && !review && (
        <p
          ref={alert}
          tabIndex={notice.error ? -1 : undefined}
          role={notice.error ? 'alert' : 'status'}
          className={notice.error ? styles.error : styles.success}
        >
          {notice.text}
        </p>
      )}
      <Card title={replacement ? 'Replace ' + (byId.get(replacement)?.name ?? 'file') : 'Add a site file'}>
        <p>
          Upload a self-hosted script or stylesheet and record its original source. The complete file list, order and
          chosen pages are reviewed together before anything can go live.
        </p>
        <fieldset disabled={busy || props.archived} className={styles.upload}>
          <Field id="site-file-upload" label="Local file" help="JavaScript (.js) or CSS (.css). Up to 5 MB.">
            <input
              ref={fileInput}
              type="file"
              accept=".js,.css"
              onChange={event => {
                const file = event.target.files?.[0] ?? null
                setLocalFile(file)
                if (file) {
                  setKind(/\.css$/i.test(file.name) ? 'stylesheet' : 'script')
                  if (!source) setSource('local:' + file.name)
                }
              }}
            />
          </Field>
          <Field
            id="site-file-source"
            label="Original source"
            required
            help="A public download address or local source path. Never include credentials."
          >
            <input value={source} onChange={event => setSource(event.target.value)} maxLength={2000} />
          </Field>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={!localFile || !source.trim()} onClick={upload}>
              {busy ? 'Adding file…' : replacement ? 'Add replacement to review' : 'Add file to review'}
            </Button>
            {replacement && (
              <Button
                variant="tertiary"
                onClick={() => {
                  setReplacement(undefined)
                  setLocalFile(null)
                  setSource('')
                  if (fileInput.current) fileInput.current.value = ''
                }}
              >
                Cancel replacement
              </Button>
            )}
          </div>
        </fieldset>
      </Card>
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
                        {file.kind} · {bytes(file.bytes)}
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
      {!!bundle.native?.length && (
        <Card title="Original image and document addresses">
          <p>
            These addresses keep images, documents and fonts working inside the original site files. Removing an address
            can break those interactions.
          </p>
          <div className={styles.stack}>
            {bundle.native.map(alias => {
              const resource = props.nativeResources.find(
                item =>
                  item.kind === alias.kind && item.id === (alias.kind === 'media' ? alias.mediaId : alias.assetId),
              )
              return (
                <article
                  className={styles.file}
                  key={alias.kind + alias.sourceId}
                  aria-label={(resource?.name ?? 'Saved resource') + ' original addresses'}
                >
                  <div className={styles.heading}>
                    <strong>{resource?.name ?? 'Saved resource'}</strong>
                    <Button
                      variant="destructive"
                      size="s"
                      disabled={busy || props.archived}
                      onClick={() =>
                        setBundle(current => ({
                          ...current,
                          native: current.native?.filter(
                            item => item.kind !== alias.kind || item.sourceId !== alias.sourceId,
                          ),
                        }))
                      }
                    >
                      Remove addresses for {resource?.name ?? 'saved resource'}
                    </Button>
                  </div>
                  <p className={styles.meta}>
                    {resource ? bytes(resource.bytes) + ' · ' + resource.source : 'This resource is unavailable.'}
                  </p>
                  <p className={styles.meta}>{nativeAliasPaths(alias).join(', ')}</p>
                </article>
              )
            })}
          </div>
        </Card>
      )}
      {bundle.original && (
        <Card title="Original page layouts">
          <p>
            These pages keep their original document structure, classes and page attributes.{' '}
            {bundle.original.definitions.length} saved{' '}
            {bundle.original.definitions.length === 1 ? 'layout is' : 'layouts are'} approved. Ordinary sections keep
            the CMS layout.
          </p>
          {bundle.original.newPages && (
            <p>
              New pages use this original design ·{' '}
              {bundle.original.newPages.header ? 'shared header' : 'no shared header'} ·{' '}
              {bundle.original.newPages.footer ? 'shared footer' : 'no shared footer'}. Existing page choices below take
              priority. Only files marked for new pages are added.
            </p>
          )}
          <ul>
            {bundle.original.pages.map(page => (
              <li key={page.pageId}>
                {props.pages.find(item => item.id === page.pageId)?.title ?? 'Saved page'}{' '}
                {page.quirks ? ' · Original browser layout' : ''} · {page.header ? 'Site header' : 'No site header'} ·{' '}
                {page.footer ? 'Site footer' : 'No site footer'}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              variant="destructive"
              size="s"
              disabled={busy || props.archived}
              onClick={() => setBundle(current => removeOriginalLayouts(current))}
            >
              Remove original page layouts
            </Button>
          </div>
        </Card>
      )}
      <Card title="Reviewed versions">
        <p>
          Restore an earlier file list as new choices, then review and publish it. Every previous file and approval
          stays in history.
        </p>
        {props.versions.length === 0 ? (
          <p>No file list has been reviewed yet.</p>
        ) : (
          <div className={styles.versions}>
            {props.versions.map(version => (
              <div className={styles.heading} key={version.id}>
                <span>
                  Version {version.version} · {version.bundle.files.length} files ·{' '}
                  <time dateTime={version.reviewed_at}>{version.reviewed_at.slice(0, 10)}</time>
                  {version.id === props.publishedVersionId ? ' · live' : ''}
                </span>
                <Button
                  variant="secondary"
                  size="s"
                  disabled={
                    busy || props.archived || dirty || JSON.stringify(version.bundle) === JSON.stringify(bundle)
                  }
                  onClick={() => {
                    setBundle(structuredClone(version.bundle))
                    setNotice({
                      error: false,
                      text: 'Earlier file choices restored for review. Nothing has been published.',
                    })
                  }}
                >
                  Restore version {version.version} as choices
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {review && (
        <Dialog
          title="Review site file changes"
          pending={busy}
          onClose={() => setReview(false)}
          size="wide"
          footer={
            <div className={styles.reviewFooter}>
              <label className={styles.ack}>
                <input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />
                I reviewed every file, its size and source, where and in which order it will run, and any original image
                or document addresses.{bundle.original ? ' I also reviewed the original page layouts.' : ''}
              </label>
              <div className={styles.actions}>
                <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>
                  Cancel
                </Button>
                <Button disabled={!ack || busy || !changed} onClick={approve}>
                  {busy ? 'Saving reviewed version…' : 'Save reviewed version'}
                </Button>
              </div>
            </div>
          }
        >
          <div className={styles.review}>
            <p>
              These files belong to {props.siteName}. Approval saves a private version; publish it through the site
              release to change the live site.
            </p>
            {notice?.error && (
              <p ref={alert} tabIndex={-1} role="alert" className={styles.error}>
                {notice.text}
              </p>
            )}
            {bundle.original && (
              <>
                <h3>Original page layouts</h3>
                <p>
                  {bundle.original.pages.length} pages keep their original document structure and{' '}
                  {bundle.original.definitions.length} saved layouts. Document attributes cannot contain scripts, styles
                  or event handlers.
                </p>
                {bundle.original.newPages && (
                  <p>
                    New pages also use the reviewed original design, with{' '}
                    {bundle.original.newPages.header ? 'the shared header' : 'no shared header'} and{' '}
                    {bundle.original.newPages.footer ? 'the shared footer' : 'no shared footer'}. Each file below states
                    whether it runs on new pages. Existing imported-page choices take priority.
                  </p>
                )}
              </>
            )}
            {baseline.original && !bundle.original && (
              <p>
                Original page layouts will be removed. These pages will use the CMS frame when this version is
                published.
              </p>
            )}
            {bundle.files.length === 0 ? (
              <p>
                {bundle.original
                  ? 'No executable files are loaded. The original page layouts listed below are retained.'
                  : 'This version removes all site scripts and files from the live pages when published.'}
              </p>
            ) : (
              <ol>
                {bundle.files.map(id => {
                  const file = byId.get(id)
                  return file ? (
                    <li key={id}>
                      <strong>{file.name}</strong>
                      <dl>
                        <div>
                          <dt>Size</dt>
                          <dd>{bytes(file.bytes)}</dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd>{file.source}</dd>
                        </div>
                        <div>
                          <dt>Loading</dt>
                          <dd>{describeFileLoading(bundle, id, props.pages)}</dd>
                        </div>
                        {bundle.paths?.some(path => path.fileId === id) && (
                          <div>
                            <dt>Web addresses</dt>
                            <dd>
                              {bundle.paths
                                .filter(path => path.fileId === id)
                                .map(path => path.path)
                                .join(', ')}
                            </dd>
                          </div>
                        )}
                      </dl>
                      <details>
                        <summary>Advanced</summary>
                        <p className={styles.hash}>SHA-256 {file.sha256}</p>
                      </details>
                    </li>
                  ) : null
                })}
              </ol>
            )}
            {!!bundle.native?.length && (
              <>
                <h3>Original image and document addresses</h3>
                <ol>
                  {bundle.native.map(alias => {
                    const resource = props.nativeResources.find(
                      item =>
                        item.kind === alias.kind &&
                        item.id === (alias.kind === 'media' ? alias.mediaId : alias.assetId),
                    )
                    return (
                      <li key={alias.kind + alias.sourceId}>
                        <strong>{resource?.name ?? 'Saved resource'}</strong>
                        <p>
                          {resource ? bytes(resource.bytes) + ' · ' + resource.source : 'This resource is unavailable.'}
                        </p>
                        <p>{nativeAliasPaths(alias).join(', ')}</p>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
            {!!baseline.native?.filter(
              old => !bundle.native?.some(item => item.kind === old.kind && item.sourceId === old.sourceId),
            ).length && (
              <p>
                Removed original addresses:{' '}
                {baseline.native
                  .filter(old => !bundle.native?.some(item => item.kind === old.kind && item.sourceId === old.sourceId))
                  .flatMap(nativeAliasPaths)
                  .join(', ')}
                . Earlier versions keep their choices.
              </p>
            )}
            {removed.length > 0 && (
              <p>Removed from this version: {removed.join(', ')}. Earlier versions and files remain retained.</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}
