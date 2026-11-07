'use client'
import dynamic from 'next/dynamic'
import { parseCollectionEntryValues, type CollectionField } from '@cms/schema'
import type { MediaAsset } from '../lib/media-library.ts'
import { Button, Field } from './ui/index.ts'
import selectionControlsStyles from './workspace-styles/selection-controls.module.css'
import ownedStyles from './collection-field-control-styles.module.css'
import { IconImage } from './icons.tsx'
const entryIdentity = (entry: { id: string | null; clientId?: string; stableKey: string }) =>
  entry.id ?? entry.clientId ?? entry.stableKey
const RichTextField = dynamic(
  () => import('../app/pages/[pageId]/rich-text-field.tsx').then(module => module.RichTextField),
  { ssr: false, loading: () => <p role="status">Loading formatting tools…</p> },
)
export function imagePreview(value: unknown, media: readonly MediaAsset[]): string | null {
  const src = value && typeof value === 'object' ? (value as { src?: unknown }).src : null
  if (typeof src !== 'string' || !src) return null
  const asset = media.find(item => item.deliveryUrl === src)
  if (asset) return asset.previewUrl ?? null
  return /^https?:\/\//i.test(src) ? src : null
}

export function CollectionFieldControl({
  field,
  entry,
  media,
  disabled,
  onChange,
  onChooseImage,
  onChooseDocument,
}: {
  field: CollectionField
  entry: { id: string | null; stableKey: string; clientId?: string; values: Record<string, unknown> }
  media: readonly MediaAsset[]
  disabled: boolean
  onChange: (value: unknown) => void
  onChooseImage: () => void
  onChooseDocument: () => void
}) {
  const value = entry.values[field.key]
  const id = `${entryIdentity(entry)}-${field.key}`
  const problem = parseCollectionEntryValues([field], { [field.key]: value })
  const help = !problem.ok ? problem.problems[0] : field.help
  if (field.type === 'boolean')
    return (
      <label className={selectionControlsStyles.checkRow} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
        <span>
          <strong>{field.label}</strong>
          {field.help && <small>{field.help}</small>}
        </span>
      </label>
    )
  return (
    <Field
      id={id}
      label={field.label}
      required={field.required}
      help={problem.ok ? help : undefined}
      error={!problem.ok ? help : undefined}
      className={'collection-field ' + (!problem.ok ? 'has-error' : '')}
    >
      {field.type === 'richtext' ? (
        <RichTextField
          id={id}
          labelId={`${id}-label`}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={onChange}
        />
      ) : field.type === 'select' ? (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={event => onChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {field.options.map(option => (
            <option key={option}>{option}</option>
          ))}
        </select>
      ) : field.type === 'image' ? (
        <ImageField
          value={value}
          preview={imagePreview(value, media)}
          id={id}
          disabled={disabled}
          onChoose={onChooseImage}
          onClear={() => onChange('')}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'url' ? 'url' : undefined}
          value={field.type === 'number' && typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={event =>
            onChange(
              field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value,
            )
          }
        />
      )}
      {field.type === 'url' && !disabled && (
        <span className="actions">
          <Button
            variant="secondary"
            size="compact"
            onClick={event => {
              event.currentTarget.focus()
              onChooseDocument()
            }}
          >
            Choose or upload PDF
          </Button>
          {!!value && (
            <Button variant="tertiary" size="compact" onClick={() => onChange('')}>
              Clear link
            </Button>
          )}
        </span>
      )}
    </Field>
  )
}

function ImageField({
  value,
  preview,
  id,
  disabled,
  onChoose,
  onClear,
}: {
  value: unknown
  preview: string | null
  id: string
  disabled: boolean
  onChoose: () => void
  onClear: () => void
}) {
  const image = value && typeof value === 'object' ? (value as { src?: string; alt?: string }) : null
  return (
    <div id={id} className={'collection-image-field ' + ownedStyles.assetField}>
      {image?.src ? (
        <span className={'collection-image-thumb ' + ownedStyles.assetPreview}>
          {preview ? <img src={preview} alt="" /> : <IconImage size={19} />}
          <span title={image.alt || 'Decorative image'}>{image.alt || 'Decorative image'}</span>
        </span>
      ) : (
        <span className="collection-image-empty">
          <IconImage size={19} /> No image selected
        </span>
      )}
      {!disabled && (
        <span className="actions">
          <Button
            variant="secondary"
            size="compact"
            onClick={event => {
              event.currentTarget.focus()
              onChoose()
            }}
          >
            Choose from Media
          </Button>
          {image?.src && (
            <Button variant="tertiary" size="compact" onClick={onClear}>
              Clear
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
