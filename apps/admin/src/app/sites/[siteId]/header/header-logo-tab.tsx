import { type SlotDef } from '@cms/schema'
import { Button, Card, Disclosure, Field, Note } from '../../../../components/ui/index.ts'
import { SiteLogoField } from '../../../../components/site-logo-field.tsx'
import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import { FrameField } from '../global-elements/frame-component-panel.tsx'
import styles from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
import ownedStyles from './workspace-styles.module.css'
import type { HeaderMenuModel, HeaderMenuProps } from './use-header-menu.ts'
export function HeaderLogoTab({
  model,
  siteId,
  media,
  superAdmin,
}: {
  model: HeaderMenuModel
} & Pick<HeaderMenuProps, 'siteId' | 'media' | 'superAdmin'>) {
  const {
    header,
    setHeader,
    pending,
    setPicker,
    logoFailed,
    setLogoFailed,
    dirty,
    component,
    pin,
    latest,
    fields,
    values,
    logo,
    logoSlot,
    logoUrl,
    logoPreset,
    logoProblem,
    value,
    prepare,
  } = model
  return (
    <>
      <div className={styles.equalColumns} data-align="stretch">
        <Card title="Logo" density="editor">
          {logoSlot ? (
            <>
              <div className={ownedStyles.assetChoice}>
                {logo.src && logoFailed !== logoUrl ? (
                  <img
                    className={workspacePreviewStyles.assetThumb}
                    src={logoUrl}
                    alt={String(logo.alt ?? '')}
                    onError={() => setLogoFailed(logoUrl)}
                  />
                ) : (
                  <p className="muted" role="status">
                    Logo preview unavailable. Use Replace to choose an image.
                  </p>
                )}
                <div className={listInspectorStyles.formStack}>
                  <p className="muted">PNG at least 400px wide. Transparent background works best.</p>
                  <div className={workspaceFormsStyles.actions}>
                    <Button variant="secondary" disabled={pending} onClick={() => setPicker(true)}>
                      Replace
                    </Button>
                    {logoPreset && logo.src !== logoPreset.value.src && (
                      <Button
                        variant="tertiary"
                        disabled={pending}
                        onClick={() => value(logoSlot.id, logoPreset.value)}
                      >
                        {logoPreset.label}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
              <Field id="header-logo-description" label="Description (for screen readers)" required>
                <input
                  value={String(logo.alt ?? '')}
                  maxLength={300}
                  disabled={pending}
                  onChange={event => value(logoSlot.id, { ...logo, alt: event.target.value, decorative: false })}
                />
              </Field>
              <Field id="header-logo-home" label="Clicking the logo goes to">
                <input value="Home page" readOnly />
              </Field>
              {logoProblem && <p role="alert">{logoProblem}</p>}
            </>
          ) : header.schemaVersion === 1 ? (
            <div className={listInspectorStyles.formStack}>
              <SiteLogoField
                siteId={siteId}
                siteName={header.brand.siteName}
                compact={false}
                fallback={header.brand.compactLogoMediaId ? 'compact' : 'name'}
                value={header.brand.logoMediaId}
                choices={media.map(asset => ({
                  id: asset.id,
                  name: asset.name,
                  url: asset.previewUrl ?? asset.deliveryUrl ?? '',
                  alt: asset.altText,
                }))}
                disabled={pending}
                onChange={id =>
                  setHeader(current =>
                    current.schemaVersion === 1
                      ? { ...current, brand: { ...current.brand, logoMediaId: id } }
                      : current,
                  )
                }
              />
              {(header.brand.logoMediaId || header.brand.compactLogoMediaId) && (
                <Field id="header-logo-description" label="Description (for screen readers)" required>
                  <input
                    value={header.brand.logoDescription ?? ''}
                    maxLength={300}
                    disabled={pending}
                    onChange={event =>
                      setHeader(current =>
                        current.schemaVersion === 1
                          ? { ...current, brand: { ...current.brand, logoDescription: event.target.value } }
                          : current,
                      )
                    }
                  />
                </Field>
              )}
              <Disclosure title="A different logo on phones">
                <SiteLogoField
                  siteId={siteId}
                  siteName={header.brand.siteName}
                  compact
                  fallback={header.brand.logoMediaId ? 'full' : 'name'}
                  value={header.brand.compactLogoMediaId}
                  choices={media.map(asset => ({
                    id: asset.id,
                    name: asset.name,
                    url: asset.previewUrl ?? asset.deliveryUrl ?? '',
                    alt: asset.altText,
                  }))}
                  disabled={pending}
                  onChange={id =>
                    setHeader(current =>
                      current.schemaVersion === 1
                        ? { ...current, brand: { ...current.brand, compactLogoMediaId: id } }
                        : current,
                    )
                  }
                />
              </Disclosure>
              {logoProblem && <p role="alert">{logoProblem}</p>}
            </div>
          ) : (
            <>
              <p>
                This saved header uses its original logo. A Super admin can prepare the national header controls, then
                preview them here.
              </p>
              {superAdmin && component?.slug === 'national-header' && (!latest || latest.version === pin?.version) && (
                <Button variant="secondary" disabled={pending || dirty} onClick={() => void prepare()}>
                  Prepare updated header
                </Button>
              )}
            </>
          )}
        </Card>
        <Card title="Words beside the logo" density="editor">
          {header.schemaVersion === 2 ? (
            fields
              .filter(slot => ['name', 'tagline'].includes(slot.id))
              .map(slot => (
                <Field key={slot.id} id={'header-' + slot.id} label={slot.id === 'name' ? 'Site name' : 'Small line'}>
                  <input
                    value={String(values[slot.id] ?? '')}
                    maxLength={200}
                    disabled={pending}
                    onChange={event => value(slot.id, event.target.value)}
                  />
                </Field>
              ))
          ) : header.schemaVersion === 1 ? (
            <div className={listInspectorStyles.formStack}>
              <Field id="header-site-name" label="Site name" required>
                <input
                  value={header.brand.siteName}
                  maxLength={120}
                  disabled={pending}
                  onChange={event =>
                    setHeader(current =>
                      current.schemaVersion === 1
                        ? { ...current, brand: { ...current.brand, siteName: event.target.value } }
                        : current,
                    )
                  }
                />
              </Field>
              <label className={selectionControlsStyles.toggleRow}>
                <span>Show site name beside the logo</span>
                <input
                  type="checkbox"
                  checked={header.brand.showName}
                  disabled={pending}
                  onChange={event =>
                    setHeader(current =>
                      current.schemaVersion === 1
                        ? { ...current, brand: { ...current.brand, showName: event.target.checked } }
                        : current,
                    )
                  }
                />
              </label>
            </div>
          ) : (
            <p>
              This header's existing identity controls are available in Site look until its national template is
              applied.
            </p>
          )}
          <Note>
            {header.schemaVersion === 1
              ? 'The colours and font are managed in Site look.'
              : "The colours, font and header shape come from the national template, so they can't drift from the other sites."}
          </Note>
        </Card>
      </div>
    </>
  )
}

export function HeaderExtraText({
  model,
  siteId,
}: {
  model: HeaderMenuModel
} & Pick<HeaderMenuProps, 'siteId'>) {
  const { tab, pending, values, otherFields, value } = model
  return (
    <>
      {tab === 'logo' && otherFields.length > 0 && (
        <Card title="Other header text" density="editor">
          {otherFields.map((slot: SlotDef) => (
            <FrameField
              key={slot.id}
              slot={slot}
              value={values[slot.id]}
              media={[]}
              disabled={pending}
              siteId={siteId}
              onChange={next => value(slot.id, next)}
            />
          ))}
        </Card>
      )}
    </>
  )
}

export function HeaderLogoPicker({
  model,
  siteId,
}: {
  model: HeaderMenuModel
} & Pick<HeaderMenuProps, 'siteId'>) {
  const { picker, setPicker, logo, logoSlot, value } = model
  return (
    <>
      {picker && logoSlot && (
        <MediaPicker
          siteId={siteId}
          mode="placement"
          confirmLabel="Use this logo"
          initialAssets={[]}
          currentValue={logo}
          onChoose={image => {
            value(logoSlot.id, { ...image, decorative: false })
            setPicker(false)
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </>
  )
}
