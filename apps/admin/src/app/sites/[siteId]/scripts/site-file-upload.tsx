import { Button, Card, Field } from '../../../../components/ui/index.ts'
import styles from './files.module.css'
import type { SiteFilesModel, SiteFilesProps } from './use-site-files.ts'

export function SiteFileUpload({ model, props }: { model: SiteFilesModel; props: SiteFilesProps }) {
  const {
    localFile,
    setLocalFile,
    source,
    setSource,
    setKind,
    replacement,
    setReplacement,
    busy,
    fileInput,
    byId,
    upload,
  } = model
  return (
    <>
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
    </>
  )
}
