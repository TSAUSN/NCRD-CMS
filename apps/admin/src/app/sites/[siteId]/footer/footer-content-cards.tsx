import { readFooterText, writeFooterText } from '../../../../lib/footer-links.ts'
import { Button, Card, Disclosure, Field } from '../../../../components/ui/index.ts'
import { RichTextField } from '../../../pages/[pageId]/rich-text-field.tsx'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
import type { FooterDraft, FooterWorkspaceProps } from './use-footer-draft.ts'
export function FooterTextField({ model, id, label }: { model: FooterDraft; id: string; label: string }) {
  const { fields, values, pending, value } = model
  const slot = fields.find(field => field.id === id)
  if (!slot) return null
  const stored = values[id]
  const plainText = slot.kind === 'richtext' ? readFooterText(stored) : null
  return (
    <Field key={id} id={'footer-' + id} label={label}>
      {plainText !== null ? (
        <textarea
          rows={4}
          value={plainText}
          disabled={pending}
          onChange={event => value(id, writeFooterText(event.target.value))}
        />
      ) : slot.kind === 'richtext' ? (
        <RichTextField
          sourceMode={false}
          id={'footer-' + id}
          labelId={'footer-' + id + '-label'}
          value={String(stored ?? '')}
          disabled={pending}
          onChange={next => value(id, next)}
        />
      ) : (
        <input
          value={String(stored ?? '')}
          maxLength={500}
          disabled={pending}
          onChange={event => value(id, event.target.value)}
        />
      )}
    </Field>
  )
}

export function FooterContentCards({
  model,
  logoPreviewUrl,
  superAdmin,
}: {
  model: FooterDraft
  logoPreviewUrl: string
} & Pick<FooterWorkspaceProps, 'superAdmin'>) {
  const {
    pending,
    setPicker,
    dirty,
    component,
    latest,
    logoSlot,
    inherits,
    logo,
    logoProblem,
    value,
    useHeader,
    prepare,
  } = model

  return (
    <>
      <Card title="Logo and name" density="editor">
        <p className="hint">Uses the header's logo unless you choose another.</p>
        {logoSlot ? (
          <>
            {!inherits && logo.src && (
              <img className={workspacePreviewStyles.assetThumb} src={logoPreviewUrl} alt={String(logo.alt ?? '')} />
            )}
            <div className={workspaceFormsStyles.actions}>
              <Button variant="secondary" disabled={pending} onClick={() => setPicker(true)}>
                {inherits ? 'Use a different logo' : 'Replace logo'}
              </Button>
              {!inherits && logoSlot.constraints?.inheritHeaderLogo === true && (
                <Button variant="tertiary" disabled={pending} onClick={useHeader}>
                  Use the header's logo
                </Button>
              )}
            </div>
            {!inherits && (
              <Field id="footer-logo-description" label="Description (for screen readers)" required>
                <input
                  value={String(logo.alt ?? '')}
                  maxLength={300}
                  disabled={pending}
                  onChange={event => value(logoSlot.id, { ...logo, alt: event.target.value, decorative: false })}
                />
              </Field>
            )}
            {logoProblem && <p role="alert">{logoProblem}</p>}
          </>
        ) : (
          <>
            <p>The current footer keeps its original logo. Preview the updated national footer to choose another.</p>
          </>
        )}
        {superAdmin &&
          component?.slug === 'national-footer' &&
          !latest?.slots.some(slot => slot.constraints?.inheritHeaderLogo === true) && (
            <Button variant="secondary" disabled={pending || dirty} onClick={() => void prepare()}>
              Prepare updated footer
            </Button>
          )}
        <Disclosure title="Words beside the logo">
          <div className={listInspectorStyles.formStack}>
            <FooterTextField model={model} id="name" label="Site name" />
            <FooterTextField model={model} id="tagline" label="Small line" />
          </div>
        </Disclosure>
      </Card>
      <Card title="Text" density="editor">
        <FooterTextField model={model} id="mission" label="Mission statement" />
        <Disclosure title="More footer text">
          <div className={listInspectorStyles.formStack}>
            <FooterTextField model={model} id="mission_heading" label="Mission heading" />
            <FooterTextField model={model} id="address" label="Address" />
            <FooterTextField model={model} id="disclaimer" label="Disclaimer" />
            <FooterTextField model={model} id="base" label="Legal text" />
          </div>
        </Disclosure>
      </Card>
    </>
  )
}
