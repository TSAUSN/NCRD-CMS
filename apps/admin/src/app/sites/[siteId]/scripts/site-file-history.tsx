import { Button, Card } from '../../../../components/ui/index.ts'
import styles from './files.module.css'
import type { SiteFilesModel, SiteFilesProps } from './use-site-files.ts'

export function SiteFileHistory({ model, props }: { model: SiteFilesModel; props: SiteFilesProps }) {
  const { bundle, setBundle, busy, setNotice, dirty } = model
  return (
    <>
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
    </>
  )
}
