'use client'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { HeroContrastCheck } from './hero-contrast-check.tsx'
import { HERO_BUTTON_PALETTE } from '@cms/renderer'
import { heroSlidePresentation, repeatItemSlotId } from '@cms/schema'
import { Card, Field, SegmentedControl, Disclosure } from '../../../components/ui/index.ts'
import { LinkSettings } from '../../../components/link-settings.tsx'
import type { LinkTarget } from '../../../lib/queries.ts'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../components/workspace-styles/selection-controls.module.css'
import workspacePreviewStyles from '../../../components/workspace-styles/workspace-preview.module.css'
import buttonStyles from '../../../components/ui/styles/button.module.css'
/** The miniature button is a noninteractive preview; actual page links remain in the canvas. */
export function HeroSlideFields({
  repeat,
  item,
  values,
  onChange,
  renderField,
  targets,
  canStyle,
  photoUrl,
  phonePhotoUrl,
  publishedIntro,
  selectedField,
}: {
  repeat: string
  item: string
  values: Record<string, unknown>
  onChange: (id: string, value: unknown) => void
  renderField: (id: string) => ReactNode
  targets: LinkTarget[]
  canStyle: boolean
  photoUrl: string | null
  phonePhotoUrl: string | null
  publishedIntro?: unknown
  selectedField?: string | null
}) {
  const field = (id: string) => values[repeatItemSlotId(repeat, item, id)]
  const p = heroSlidePresentation(values, repeat, item)
  const photoSelected =
    selectedField === repeatItemSlotId(repeat, item, 'photo') ||
    selectedField === repeatItemSlotId(repeat, item, 'phone_photo')
  const [photoOpen, setPhotoOpen] = useState(!photoUrl || photoSelected)
  useEffect(() => {
    if (!photoUrl || photoSelected) setPhotoOpen(true)
  }, [photoUrl, photoSelected])
  const counter = (id: string, label: string, max: number, multiline = false) => (
    <Field
      key={id}
      id={'hero-' + item + '-' + id}
      label={label}
      counter={String(field(id) ?? '').length + ' of ' + max}
    >
      {multiline ? (
        <textarea
          maxLength={max}
          rows={4}
          value={String(field(id) ?? '')}
          onChange={event => onChange(id, event.target.value)}
        />
      ) : (
        <input maxLength={max} value={String(field(id) ?? '')} onChange={event => onChange(id, event.target.value)} />
      )}
    </Field>
  )
  return (
    <div className={shared.denseStack}>
      {counter('title', 'Title', 100)}
      {counter('intro', 'Introduction', 200, true)}
      {String(field('intro') ?? '').length > 200 && field('intro') === publishedIntro && (
        <p className={recordTableStyles.meta}>
          Existing published wording is kept. Shorten it to 200 characters before changing this introduction.
        </p>
      )}
      <Disclosure title="Photo and crop" open={photoOpen} onToggle={event => setPhotoOpen(event.currentTarget.open)}>
        <div className={shared.denseStack}>
          {renderField('photo')}
          <label className={selectionControlsStyles.toggleRow}>
            <span>
              Different picture on phones
              <small className={recordTableStyles.meta}>Off: phones use this picture and its dot.</small>
            </span>
            <input
              type="checkbox"
              checked={field('phone_photo_enabled') === 'on'}
              onChange={event => onChange('phone_photo_enabled', event.target.checked ? 'on' : 'off')}
            />
          </label>
          {field('phone_photo_enabled') === 'on' && renderField('phone_photo')}
        </div>
      </Disclosure>
      <HeroContrastCheck photoUrl={photoUrl} shade={p.shade} />
      {field('phone_photo_enabled') === 'on' && (
        <HeroContrastCheck photoUrl={phonePhotoUrl} shade={p.shade} label="Phone text contrast" />
      )}
      {canStyle && (
        <>
          <Field id={'hero-position-' + item} label="Text position">
            <SegmentedControl
              label="Text position"
              value={p.position}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={value => onChange('position', value)}
            />
          </Field>
          <Field id={'hero-shade-' + item} label="Shade behind the text">
            <SegmentedControl
              label="Shade behind the text"
              value={p.shade}
              options={[
                { value: 'blue', label: 'Black to blue' },
                { value: 'black', label: 'Black' },
                { value: 'white', label: 'White' },
                { value: 'none', label: 'None' },
              ]}
              onChange={value => onChange('shade', value)}
            />
          </Field>
        </>
      )}
      {(['primary', 'secondary'] as const).map((id, index) => {
        const value = field(id)
        const link = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const color = index ? p.secondColor : p.mainColor
        const shown = index ? p.second : p.main
        const label = index ? 'Second button' : 'Main button'
        const palette = color === 'red' ? HERO_BUTTON_PALETTE.red : HERO_BUTTON_PALETTE.white
        const ink = p.shade === 'white' ? HERO_BUTTON_PALETTE.white.foreground : HERO_BUTTON_PALETTE.red.foreground
        const preview: CSSProperties = {
          background: color === 'outline' ? 'transparent' : palette.background,
          color: color === 'outline' ? ink : palette.foreground,
          borderColor: color === 'outline' ? 'currentColor' : palette.border,
          cursor: 'default',
        }
        return (
          <Card key={id} density="editor" className={workspaceFormsStyles.compactForm} aria-label={label}>
            <label className={selectionControlsStyles.toggleRow}>
              <strong>{label}</strong>
              <span>
                Show{' '}
                <input
                  type="checkbox"
                  aria-label={'Show ' + label.toLowerCase()}
                  checked={shown}
                  onChange={event => onChange(id + '_visible', event.target.checked ? 'on' : 'off')}
                />
              </span>
            </label>
            {shown && (
              <>
                <div
                  className={workspacePreviewStyles.previewPanel}
                  style={color === 'outline' && p.shade !== 'white' ? { background: 'var(--primary)' } : undefined}
                >
                  <span
                    role="img"
                    aria-label={label + ' preview: ' + String(link.label ?? '')}
                    className={buttonStyles.button}
                    data-size="s"
                    style={preview}
                  >
                    {String(link.label ?? '') || 'Button text'}
                  </span>
                </div>
                <Field
                  id={'hero-' + item + '-' + id + '-text'}
                  label="Button text"
                  counter={String(link.label ?? '').length + ' of 20'}
                >
                  <input
                    maxLength={20}
                    value={String(link.label ?? '')}
                    onChange={event => onChange(id, { ...link, label: event.target.value })}
                  />
                </Field>
                {canStyle && (
                  <Field id={'hero-' + item + '-' + id + '-color'} label="Color">
                    <SegmentedControl
                      label={label + ' color'}
                      value={color}
                      options={[
                        { value: 'red', label: 'Red' },
                        { value: 'white', label: 'White' },
                        { value: 'outline', label: 'Outline' },
                      ]}
                      onChange={value => onChange(id + '_color', value)}
                    />
                  </Field>
                )}
                <LinkSettings
                  id={'hero-' + item + '-' + id}
                  value={link}
                  targets={targets}
                  onChange={value => onChange(id, value)}
                  destinationOnly
                  showLinkOptions
                  sectionJumps
                  summaryLabel="Goes to"
                  title={'Where does “' + String(link.label ?? 'this button') + '” go?'}
                  confirmLabel="Use this link"
                />
              </>
            )}
          </Card>
        )
      })}
    </div>
  )
}
