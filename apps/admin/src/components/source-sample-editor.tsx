'use client'

/** Technical source authors can review examples using the same content shapes
 * the ordinary editor will copy. No sample is rendered as raw admin markup. */
export function SourceSampleEditor({
  id,
  label,
  kind,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  kind: string
  value: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  if (kind === 'text' || kind === 'richtext')
    return (
      <div className="field">
        <label htmlFor={`source-sample-${id}`}>
          {label}
          {kind === 'richtext' ? ' — formatted HTML sample' : ''}
        </label>
        <textarea
          id={`source-sample-${id}`}
          aria-label={`Sample content for ${id}`}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          maxLength={100_000}
          onChange={event => onChange(event.target.value)}
        />
      </div>
    )
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (kind === 'image')
    return (
      <div className="field">
        <strong>{label}</strong>
        <label htmlFor={`source-sample-${id}`}>Image address</label>
        <input
          id={`source-sample-${id}`}
          aria-label={`Sample image for ${id}`}
          type="text"
          value={String(record.src ?? '')}
          disabled={disabled}
          maxLength={2048}
          onChange={event => onChange({ ...record, src: event.target.value })}
        />
        <label htmlFor={`source-alt-${id}`}>Image description</label>
        <input
          id={`source-alt-${id}`}
          type="text"
          value={String(record.alt ?? '')}
          disabled={disabled}
          maxLength={2000}
          onChange={event => onChange({ ...record, alt: event.target.value, decorative: event.target.value === '' })}
        />
      </div>
    )
  if (kind === 'link' || kind === 'button')
    return (
      <div className="field">
        <strong>{label}</strong>
        <label htmlFor={`source-sample-${id}`}>Destination</label>
        <input
          id={`source-sample-${id}`}
          aria-label={`Sample destination for ${id}`}
          type="text"
          value={String(record.url ?? '')}
          disabled={disabled}
          maxLength={2048}
          onChange={event => onChange({ ...record, url: event.target.value })}
        />
        <label htmlFor={`source-label-${id}`}>Link label</label>
        <input
          id={`source-label-${id}`}
          type="text"
          value={String(record.label ?? '')}
          disabled={disabled}
          maxLength={2000}
          onChange={event => onChange({ ...record, label: event.target.value })}
        />
      </div>
    )
  return null
}
