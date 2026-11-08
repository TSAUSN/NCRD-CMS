import { nativeAliasPaths } from '@cms/schema'
import { Button, Dialog } from '../../../../components/ui/index.ts'
import { describeFileLoading } from '../../../../lib/site-file-bundle.ts'
import styles from './files.module.css'
import type { SiteFilesModel, SiteFilesProps } from './use-site-files.ts'
import { formatFileBytes } from '../../../../lib/site-file-bundle.ts'

export function SiteFileReview({ model, props }: { model: SiteFilesModel; props: SiteFilesProps }) {
  const { bundle, baseline, busy, setReview, ack, setAck, notice, alert, dirty, byId, approve } = model
  const removed = baseline.files.filter(id => !bundle.files.includes(id)).map(id => byId.get(id)?.name ?? 'Saved file')
  return (
    <>
      <Dialog
        title="Review site file changes"
        pending={busy}
        onClose={() => setReview(false)}
        size="wide"
        footer={
          <div className={styles.reviewFooter}>
            <label className={styles.ack}>
              <input type="checkbox" checked={ack} disabled={busy} onChange={event => setAck(event.target.checked)} />I
              reviewed every file, its size and source, where and in which order it will run, and any original image or
              document addresses.{bundle.original ? ' I also reviewed the original page layouts.' : ''}
            </label>
            <div className={styles.actions}>
              <Button variant="secondary" disabled={busy} onClick={() => setReview(false)}>
                Cancel
              </Button>
              <Button disabled={!ack || busy || !dirty} onClick={approve}>
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
              Original page layouts will be removed. These pages will use the CMS frame when this version is published.
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
                        <dd>{formatFileBytes(file.bytes)}</dd>
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
                      item.kind === alias.kind && item.id === (alias.kind === 'media' ? alias.mediaId : alias.assetId),
                  )
                  return (
                    <li key={alias.kind + alias.sourceId}>
                      <strong>{resource?.name ?? 'Saved resource'}</strong>
                      <p>
                        {resource
                          ? formatFileBytes(resource.bytes) + ' · ' + resource.source
                          : 'This resource is unavailable.'}
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
    </>
  )
}
