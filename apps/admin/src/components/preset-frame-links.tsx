import type { GlobalElementLink, NavTarget } from '@cms/schema'
import { IconButton } from './ui/index.ts'
import { IconLink, IconTrash } from './icons.tsx'
import styles from './preset-frame-fields.module.css'

export type FramePageChoice = { id: string; title: string; path: string; published: boolean }
export type FrameMediaChoice = { id: string; name: string; url: string; alt: string }
export type LinkLocation =
  | { area: 'header-utility'; index: number }
  | { area: 'header-cta' }
  | { area: 'footer-group'; groupIndex: number; index: number }
  | { area: 'footer-legal'; key: 'privacy' | 'accessibility' | 'terms' }

export const emptyLink = (): GlobalElementLink => ({ label: 'New link', target: { type: 'url', url: '/' } })
export function LinkFields({
  value,
  pages,
  disabled,
  label,
  onChange,
  onRemove,
}: {
  value: GlobalElementLink
  pages: FramePageChoice[]
  disabled: boolean
  label: string
  onChange: (next: GlobalElementLink) => void
  onRemove: () => void
}) {
  const targetKind = value.target.type
  function setTargetKind(kind: 'page' | 'url') {
    const first = pages.find(page => page.published)
    const target: NavTarget = kind === 'page' && first ? { type: 'page', page_id: first.id } : { type: 'url', url: '/' }
    onChange({ ...value, target })
  }
  return (
    <div className="global-link-row">
      <div className="global-link-row-head">
        <span>
          <IconLink size={15} />
          {label}
        </span>
        {!disabled && (
          <IconButton
            className={styles.iconAction}
            variant="destructive"
            tooltip={`Remove ${label}`}
            onClick={onRemove}
          >
            <IconTrash size={15} />
          </IconButton>
        )}
      </div>
      <div className="global-link-fields">
        <div className="field">
          <label>Label</label>
          <input
            aria-label={`${label} label`}
            value={value.label}
            maxLength={80}
            disabled={disabled}
            onChange={event => onChange({ ...value, label: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Destination</label>
          <select
            aria-label={`${label} destination type`}
            value={targetKind}
            disabled={disabled}
            onChange={event => setTargetKind(event.target.value as 'page' | 'url')}
          >
            <option value="page">A page on this site</option>
            <option value="url">A web address</option>
          </select>
        </div>
        {value.target.type === 'page' ? (
          <div className="field global-link-destination">
            <label>Page</label>
            <select
              aria-label={`${label} page`}
              value={value.target.page_id}
              disabled={disabled}
              onChange={event => onChange({ ...value, target: { type: 'page', page_id: event.target.value } })}
            >
              {pages
                .filter(page => page.published)
                .map(page => (
                  <option value={page.id} key={page.id}>
                    {page.title} · {page.path}
                  </option>
                ))}
            </select>
          </div>
        ) : (
          <div className="field global-link-destination">
            <label>URL</label>
            <input
              aria-label={`${label} URL`}
              value={value.target.url}
              maxLength={2048}
              disabled={disabled}
              placeholder="/about or https://…"
              onChange={event => onChange({ ...value, target: { type: 'url', url: event.target.value } })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
