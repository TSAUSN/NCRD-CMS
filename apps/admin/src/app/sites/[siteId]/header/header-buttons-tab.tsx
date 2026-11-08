import { validTrackingCode } from '@cms/schema'
import { Card, Field } from '../../../../components/ui/index.ts'
import { LinkDestinationPicker } from '../../../../components/link-settings.tsx'
import { PresetFrameFields } from '../../../../components/preset-frame-fields.tsx'
import { DEFAULT_FOOTER_CONFIG } from '@cms/schema'
import styles from '../../../../components/workspace.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import buttonStyles from './header-buttons.module.css'
import type { HeaderMenuModel, HeaderMenuProps } from './use-header-menu.ts'
import { frameValueRecord as record } from '../../../../lib/frame-field-values.ts'
export function HeaderButtonsTab({
  model,
  siteId,
  siteName,
  initial,
  navigation,
  media,
}: {
  model: HeaderMenuModel
} & Pick<HeaderMenuProps, 'siteId' | 'siteName' | 'initial' | 'navigation' | 'media'>) {
  const { header, setHeader, pending, values, buttons, buttonProblem, value } = model
  return (
    <>
      <>
        {header.schemaVersion === 2 ? (
          <div
            className={styles.equalColumns + ' ' + buttonStyles.buttons}
            data-align="controls"
            data-secondary={Object.hasOwn(values, 'secondary') ? 'on' : 'off'}
          >
            {buttons.map(slot => {
              const current = record(values[slot.id])
              const optional = slot.id === 'secondary'
              const enabled = !optional || Object.hasOwn(values, slot.id)
              return (
                <Card
                  key={slot.id}
                  title={optional ? 'Second button' : 'Donate button'}
                  density="editor"
                  headerActions={
                    optional ? (
                      <label className={selectionControlsStyles.toggleRow}>
                        <span className={selectionControlsStyles.visuallyHidden}>Show second button</span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={pending}
                          onChange={event => {
                            if (event.target.checked) value(slot.id, { label: '', url: '' })
                            else {
                              const next = { ...values }
                              delete next[slot.id]
                              setHeader({ ...header, component: { ...header.component, values: next } })
                            }
                          }}
                        />
                      </label>
                    ) : undefined
                  }
                >
                  {enabled ? (
                    <>
                      <Field id={'header-' + slot.id + '-label'} label="Label" required>
                        <input
                          value={String(current.label ?? '')}
                          disabled={pending}
                          maxLength={120}
                          onChange={event => value(slot.id, { ...current, label: event.target.value })}
                        />
                      </Field>
                      <LinkDestinationPicker
                        header
                        id={'header-' + slot.id}
                        value={current}
                        targets={navigation.pages.filter(page => page.published)}
                        disabled={pending}
                        onChange={next => value(slot.id, next)}
                      />
                      <Field
                        id={'header-' + slot.id + '-tracking'}
                        label="Tracking code"
                        helpAfter
                        help={
                          /^(mailto|tel):/i.test(String(current.url ?? ''))
                            ? "Email and phone links don't use tracking codes."
                            : "Added to the link automatically. Every page's header uses this button."
                        }
                        error={
                          !validTrackingCode(String(current.trackingCode ?? ''))
                            ? 'Use parameters such as utm_source=site, or leave this empty.'
                            : undefined
                        }
                      >
                        <input
                          value={String(current.trackingCode ?? '')}
                          disabled={pending}
                          maxLength={1000}
                          onChange={event => value(slot.id, { ...current, trackingCode: event.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <p className="muted">Optional, for example Find help. Off for this site.</p>
                  )}
                </Card>
              )
            })}
          </div>
        ) : (
          <PresetFrameFields
            identityControls={false}
            siteId={siteId}
            part="header"
            header={header}
            footer={initial.footer.draft.schemaVersion === 1 ? initial.footer.draft : DEFAULT_FOOTER_CONFIG}
            canManage={!pending}
            superAdmin={false}
            media={media.map(asset => ({
              id: asset.id,
              name: asset.name,
              url: asset.previewUrl ?? '',
              alt: asset.altText,
            }))}
            pages={navigation.pages}
            siteName={siteName}
            onHeader={setHeader}
            onFooter={() => {}}
          />
        )}
        {buttonProblem && (
          <p role="alert">Add button text, a valid destination and a valid tracking code for {buttonProblem.label}.</p>
        )}
      </>
    </>
  )
}
