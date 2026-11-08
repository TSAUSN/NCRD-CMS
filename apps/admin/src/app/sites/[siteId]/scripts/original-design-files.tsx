import { nativeAliasPaths } from '@cms/schema'
import { Button, Card } from '../../../../components/ui/index.ts'
import { removeOriginalLayouts } from '../../../../lib/site-file-bundle.ts'
import styles from './files.module.css'
import type { SiteFilesModel, SiteFilesProps } from './use-site-files.ts'
import { formatFileBytes } from '../../../../lib/site-file-bundle.ts'

export function OriginalDesignFiles({ model, props }: { model: SiteFilesModel; props: SiteFilesProps }) {
  const { bundle, setBundle, busy } = model
  return (
    <>
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
                    {resource
                      ? formatFileBytes(resource.bytes) + ' · ' + resource.source
                      : 'This resource is unavailable.'}
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
    </>
  )
}
