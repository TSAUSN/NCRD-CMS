'use client'
import { contentCounts } from '../../../../lib/content-counts.ts'

// Editing an authored header or footer (ADR 0010). The definition's own fields
// are edited here, once, for the whole site; its markup and styling belong to
// the section creator, and its menu belongs to Navigation.
import { IconPicker } from '../../../../components/icon-picker.tsx'
import { sourceSampleValues, isIconSlot, type FooterConfigV2, type HeaderConfigV2, type SlotDef } from '@cms/schema'
import { carryFrameValues } from '../../../../lib/frame-field-values.ts'
import { RichTextField } from '../../../pages/[pageId]/rich-text-field.tsx'
import type { FrameComponentChoice } from '../../../../lib/queries.ts'
import {
  IconAlert,
  IconFrame,
  IconImage,
  IconInfo,
  IconLink,
  IconMenu,
  IconText,
} from '../../../../components/icons.tsx'

type MediaChoice = { id: string; name: string; url: string; alt: string }
type Config = HeaderConfigV2 | FooterConfigV2

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export function FrameComponentPanel({
  kind,
  config,
  components,
  media,
  pageCount,
  pageCountLabel,
  canManage,
  siteId,
  onChange,
}: {
  kind: 'header' | 'footer'
  config: Config
  components: FrameComponentChoice[]
  media: MediaChoice[]
  pageCount: number
  pageCountLabel?: string
  canManage: boolean
  siteId: string
  onChange: (next: Config) => void
}) {
  const choices = components.filter(
    component =>
      component.placement === kind &&
      (component.status === 'active' || component.id === config.component.section_def_id),
  )
  const chosen = choices.find(component => component.id === config.component.section_def_id)
  const pinned = chosen?.versions.find(version => version.version === config.component.section_def_version)
  const latest = chosen?.versions.at(-1)
  const values = config.component.values
  const setValue = (id: string, value: unknown) =>
    onChange({ ...config, component: { ...config.component, values: { ...values, [id]: value } } })

  function choose(id: string) {
    const next = choices.find(component => component.id === id)
    const version = next?.versions.at(-1)
    if (!next || !version || next.status !== 'active') return
    onChange({
      ...config,
      component: {
        section_def_id: next.id,
        section_def_version: version.version,
        values: {
          ...sourceSampleValues(version.slots),
          ...carryFrameValues(values, version.slots, pinned?.slots ?? []),
        },
      },
    })
  }

  function upgrade() {
    if (!latest || chosen?.status !== 'active') return
    onChange({
      ...config,
      component: {
        ...config.component,
        section_def_version: latest.version,
        values: carryFrameValues(values, latest.slots, pinned?.slots ?? []),
      },
    })
  }

  return (
    <>
      <section className="global-panel frame-scope-notice" aria-label={`Site-wide ${kind}`}>
        <div className="global-panel-head">
          <span>
            <IconFrame size={18} />
          </span>
          <div>
            <p className="eyebrow">Authored {kind}</p>
            <h2>Site-wide: {pageCountLabel ?? contentCounts(pageCount)}</h2>
            <p>
              These fields appear on every page of the site. Nothing here changes until you publish the site frame, and
              page editors cannot change it from a page.
            </p>
          </div>
        </div>
        <div className="global-form-grid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.enabled}
              disabled={!canManage}
              onChange={event => onChange({ ...config, enabled: event.target.checked })}
            />
            <span>
              <strong>Show the {kind}</strong>
              <small>Disabling it removes the landmark from every page.</small>
            </span>
          </label>
          {'sticky' in config && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={config.sticky}
                disabled={!canManage}
                onChange={event => onChange({ ...config, sticky: event.target.checked })}
              />
              <span>
                <strong>Keep it visible while scrolling</strong>
                <small>Applied by the site, not by the component.</small>
              </span>
            </label>
          )}
          <div className="field global-span-two">
            <label htmlFor={`frame-${kind}-component`}>Component</label>
            <select
              id={`frame-${kind}-component`}
              value={chosen?.id ?? ''}
              disabled={!canManage}
              onChange={event => choose(event.target.value)}
            >
              {!chosen && <option value="">Unavailable component</option>}
              {choices.map(component => (
                <option value={component.id} key={component.id} disabled={component.status !== 'active'}>
                  {component.name}
                  {component.scope === 'site' ? ' · this site' : ' · shared'}
                  {component.status !== 'active' ? ` · ${component.status}` : ''}
                </option>
              ))}
            </select>
            <small>
              Version {config.component.section_def_version}. Components are written in the section creator by a
              technical administrator.
            </small>
          </div>
        </div>
        {chosen && chosen.status !== 'active' && (
          <p className="notice" role="note">
            This component is {chosen.status} in the library. Its pinned fields still work here; choose an active
            component to replace it.
          </p>
        )}
        {!pinned && (
          <p className="notice notice-error" role="alert">
            <IconAlert size={16} />
            <span className="notice-body">
              This version is not available to this site, so the public site would keep its baseline frame. Choose a
              component.
            </span>
          </p>
        )}
        {pinned && chosen?.status === 'active' && latest && latest.version > pinned.version && (
          <p className="notice" role="note">
            <IconInfo size={16} />
            <span className="notice-body">
              Version {latest.version} of this component is available. Compatible fields keep their values; fields with
              a new type need new content. Check the preview before saving.
            </span>
            {canManage && (
              <button type="button" className="small secondary" onClick={upgrade}>
                Use version {latest.version}
              </button>
            )}
          </p>
        )}
      </section>

      {pinned && (
        <section className="global-panel">
          <div className="global-panel-head">
            <span>
              <IconText size={18} />
            </span>
            <div>
              <p className="eyebrow">Fields</p>
              <h2>Content</h2>
              <p>Only the component's declared fields are editable, so its layout stays exactly as designed.</p>
            </div>
          </div>
          <div className="global-list">
            {pinned.slots.length === 0 && <p className="global-empty">This component has no editable fields.</p>}
            {pinned.slots.map(slot => (
              <FrameField
                key={slot.id}
                slot={slot}
                value={values[slot.id]}
                media={media}
                disabled={!canManage}
                siteId={siteId}
                onChange={next => setValue(slot.id, next)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}

export function FrameField({
  slot,
  value,
  media,
  disabled,
  siteId,
  onChange,
}: {
  slot: SlotDef
  value: unknown
  media: MediaChoice[]
  disabled: boolean
  siteId: string
  onChange: (next: unknown) => void
}) {
  const id = `frame-field-${slot.id}`
  if (isIconSlot(slot))
    return (
      <div className="field">
        <label htmlFor={id}>{slot.label}</label>
        <IconPicker id={id} value={value} disabled={disabled} onChange={onChange} />
      </div>
    )
  if (slot.kind === 'navigation') {
    return (
      <div className="global-link-row">
        <div className="global-link-row-head">
          <span>
            <IconMenu size={15} />
            {slot.label}
          </span>
        </div>
        <p className="global-empty">
          The site menu. Its items, order and visibility are managed in{' '}
          <a href={`/sites/${siteId}/navigation`}>Navigation</a>.
        </p>
      </div>
    )
  }
  if (slot.kind === 'repeat') {
    return <p className="global-empty">{slot.label}: repeated collections are not available in the site frame.</p>
  }
  if (slot.kind === 'image') {
    const current = record(value)
    const chosen = typeof current['media_id'] === 'string' ? current['media_id'] : ''
    return (
      <div className="global-link-row">
        <div className="global-link-row-head">
          <span>
            <IconImage size={15} />
            {slot.label}
          </span>
        </div>
        <div className="global-link-fields">
          <div className="field">
            <label htmlFor={`${id}-media`}>Image</label>
            <select
              id={`${id}-media`}
              value={chosen}
              disabled={disabled}
              onChange={event => {
                const asset = media.find(item => item.id === event.target.value)
                if (!asset) return
                onChange({
                  src: `/media/${asset.id}/original`,
                  variant: 'original',
                  media_id: asset.id,
                  alt: String(current['alt'] ?? asset.alt ?? ''),
                  decorative: current['decorative'] === true,
                })
              }}
            >
              {!media.some(item => item.id === chosen) && (
                <option value={chosen}>{chosen ? 'Current image' : 'Choose an image'}</option>
              )}
              {media.map(asset => (
                <option value={asset.id} key={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field global-link-destination">
            <label htmlFor={`${id}-alt`}>Description for people who can't see the picture</label>
            <input
              id={`${id}-alt`}
              value={String(current['alt'] ?? '')}
              maxLength={300}
              disabled={disabled}
              placeholder="Describe the image, or leave empty if decorative"
              onChange={event =>
                onChange({ ...current, alt: event.target.value, decorative: event.target.value === '' })
              }
            />
          </div>
        </div>
      </div>
    )
  }
  if (slot.kind === 'link' || slot.kind === 'button') {
    const current = record(value)
    const destinationOnly = slot.constraints?.['destinationOnly'] === true
    return (
      <div className="global-link-row">
        <div className="global-link-row-head">
          <span>
            <IconLink size={15} />
            {slot.label}
          </span>
        </div>
        <div className="global-link-fields">
          {!destinationOnly && (
            <div className="field">
              <label htmlFor={`${id}-label`}>Label</label>
              <input
                id={`${id}-label`}
                value={String(current['label'] ?? '')}
                maxLength={120}
                disabled={disabled}
                onChange={event => onChange({ ...current, label: event.target.value })}
              />
            </div>
          )}
          <div className="field global-link-destination">
            <label htmlFor={`${id}-url`}>Destination</label>
            <input
              id={`${id}-url`}
              aria-label={`${slot.label} destination`}
              value={String(current['url'] ?? '')}
              maxLength={2048}
              disabled={disabled}
              placeholder="/about, #section or https://…"
              onChange={event => onChange({ ...current, url: event.target.value })}
            />
          </div>
        </div>
      </div>
    )
  }
  if (slot.kind === 'richtext') {
    return (
      <div className="field">
        <label id={`${id}-label`}>{slot.label}</label>
        <RichTextField
          key={id}
          id={id}
          labelId={`${id}-label`}
          value={typeof value === 'string' ? value : ''}
          constraints={slot.constraints}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    )
  }
  const text = typeof value === 'string' ? value : ''
  return (
    <div className="field">
      <label htmlFor={id}>{slot.label}</label>
      <textarea id={id} rows={2} value={text} disabled={disabled} onChange={event => onChange(event.target.value)} />
    </div>
  )
}
