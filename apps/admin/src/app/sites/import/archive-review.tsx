import { useMemo } from 'react'
import type { SiteArchive } from '@cms/schema'
import { Button, Field } from '../../../components/ui/index.ts'
import type { SiteImportDraft } from './use-site-import-draft.ts'
import styles from './import.module.css'

export function ArchiveReview({ archive, model }: { archive: SiteArchive; model: SiteImportDraft }) {
  const {
    name,
    slug,
    siteId,
    busy,
    pending,
    changed,
    setName,
    setSlug,
    submit,
    reviewedSiteFiles,
    setReviewedSiteFiles,
    needsFileReview,
  } = model
  const fileCount = archive.content.site_files?.length ?? 0
  const versionCount = archive.content.site_file_versions?.length ?? 0
  const { originalPages, originalTitles, quirksPages } = useMemo(() => {
    const pages = archive.content.site_file_versions?.flatMap(version => version.bundle.original?.pages ?? []) ?? []
    return {
      originalPages: [...new Set(pages.map(page => page.pageId))],
      originalTitles: new Map(archive.content.pages.map(page => [page.id, page.title])),
      quirksPages: new Set(pages.filter(page => page.quirks).map(page => page.pageId)),
    }
  }, [archive])
  return (
    <div className={styles.review}>
      <h3>Review this import</h3>
      <p>
        {archive.content.pages.length} pages · {archive.content.page_versions.length} saved page versions ·{' '}
        {archive.content.collections.length} lists · {archive.content.collection_entries.length} items ·{' '}
        {archive.content.media.length} images
      </p>
      <Field id="import-site-name" label="New site name">
        <input
          value={name}
          maxLength={120}
          disabled={busy || Boolean(siteId)}
          onChange={event => {
            changed()
            setName(event.target.value)
          }}
        />
      </Field>
      <Field
        id="import-site-address"
        label="New short address"
        help="Lowercase words separated by hyphens. This reserves a CMS address; it does not connect a public hostname."
      >
        <input
          aria-label="New short address"
          value={slug}
          maxLength={40}
          disabled={busy || Boolean(siteId)}
          onChange={event => {
            changed()
            setSlug(event.target.value)
          }}
        />
      </Field>
      {needsFileReview && (
        <div className={styles.files}>
          <h3>{fileCount ? "Review the site's files" : 'Review original page layouts'}</h3>
          <p>
            {fileCount
              ? "These files include scripts that run on the site's pages. Review every file below."
              : 'These choices preserve the source page structure and document attributes.'}{' '}
            The copy keeps {versionCount} saved {versionCount === 1 ? 'version' : 'versions'}; publishing still requires
            a separate site release.
          </p>
          {fileCount > 0 && (
            <ol>
              {archive.content.site_files!.map(file => (
                <li key={file.id}>
                  <strong>{file.name}</strong>
                  <dl>
                    <dt>Size</dt>
                    <dd>{file.bytes.toLocaleString()} bytes</dd>
                    <dt>Source</dt>
                    <dd>{file.source}</dd>
                  </dl>
                </li>
              ))}
            </ol>
          )}
          {originalPages.length > 0 && (
            <>
              <p>
                Original page layouts are included for these pages. Review their choices in Site scripts before
                publishing.
              </p>
              <ul>
                {originalPages.map(id => (
                  <li key={id}>
                    {originalTitles.get(id) ?? 'Saved page'}
                    {quirksPages.has(id) ? ' · Original browser layout' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={reviewedSiteFiles}
              disabled={busy || Boolean(siteId)}
              onChange={event => {
                setReviewedSiteFiles(event.target.checked)
              }}
            />
            {fileCount ? 'I reviewed every site file, its size and source.' : 'I reviewed the original page layouts.'}
            {fileCount && originalPages.length > 0 ? ' I also reviewed the original page layouts.' : ''}
          </label>
        </div>
      )}
      {!siteId && (
        <Button
          disabled={busy || Boolean(siteId) || Boolean(needsFileReview && !reviewedSiteFiles)}
          onClick={() => void submit()}
        >
          {pending ? 'Importing content…' : 'Create private draft copy'}
        </Button>
      )}
    </div>
  )
}
