import { Button, Dialog, Field } from '../../../../components/ui/index.ts'
import { TemplateUpdateSites } from '../../../../components/template-update-sites.tsx'
import { ScriptlessPreview } from '../../../../components/scriptless-preview.tsx'
import styles from '../../../../components/workspace.module.css'
import ownedStyles from './workspace-styles.module.css'
import type { NationalTemplateModel } from './use-national-template.ts'

export function TemplateReviewDialog({ model }: { model: NationalTemplateModel }) {
  const { pending, close, apply, selected, preview, error, applying, sites, previewSite, choosePreview, selectSite } =
    model
  return (
    <Dialog
      size="large"
      title="Review the national template update"
      pending={pending}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Not now
          </Button>
          <Button onClick={apply} disabled={pending || !selected.length || !preview || !!error}>
            {pending && applying
              ? 'Creating drafts…'
              : `Create drafts on ${selected.length} ${selected.length === 1 ? 'site' : 'sites'}`}
          </Button>
        </>
      }
    >
      <p>Applying creates a draft on each chosen site, so it can be checked first.</p>
      {pending && (
        <p role="status">
          {applying
            ? 'Creating private drafts. This may take up to a minute.'
            : 'Preparing the preview. This may take up to a minute.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {!!sites.length && (
        <Field id="national-preview-site" label="Preview on">
          <select value={previewSite} disabled={pending} onChange={event => choosePreview(event.target.value)}>
            {sites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {preview && (
        <>
          <p>{preview.pageTitle}</p>
          <div className={styles.grid}>
            <div>
              <strong>Before</strong>
              <ScriptlessPreview
                className={ownedStyles.comparisonFrame}
                title="Before national template update"
                srcDoc={preview.beforeHtml}
              />
            </div>
            <div>
              <strong>After</strong>
              <ScriptlessPreview
                className={ownedStyles.comparisonFrame}
                title="After national template update"
                srcDoc={preview.html}
              />
            </div>
          </div>
        </>
      )}
      <TemplateUpdateSites sites={sites} selected={selected} pending={pending} onSelect={selectSite} />
    </Dialog>
  )
}
