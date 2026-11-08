'use client'
import { useNavigationGuard, requestClientNavigation } from '../../../../components/navigation-guard.ts'
import { ImageFocusControl } from '../../../../components/image-focus-control.tsx'
import styles from './media-workspace.module.css'
import mediaUi from '../../../../components/media-ui.module.css'
import { MediaThumbnail as MediaThumb } from '../../../../components/media-thumbnail.tsx'
import { Button, Disclosure, Field, Badge, Tabs, TextLink } from '../../../../components/ui/index.ts'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useEffect, useRef, useState } from 'react'
import { IconAlert, IconInfo, IconRevert, IconTrash } from '../../../../components/icons.tsx'
import {
  fetchMediaUsage,
  formatBytes,
  formatDimensions,
  mediaStatusLabel,
  MediaRequestError,
  updateMediaMetadata,
  type MediaAsset,
  type MediaMetadataInput,
  type MediaUsageResult,
} from '../../../../lib/media-library.ts'
import { normalizedTags } from './media-tags.ts'

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function MediaDetail({
  asset,
  canEdit,
  canDelete,
  working,
  onSaved,
  onDelete,
  onRestore,
  onBusyChange,
  onDirtyChange,
  externalSave = false,
  onTabChange,
  onReplace,
}: {
  onReplace: () => void
  externalSave?: boolean
  onTabChange?: (tab: 'details' | 'usage') => void
  onBusyChange?: (value: boolean) => void
  onDirtyChange?: (value: boolean) => void
  asset: MediaAsset
  canEdit: boolean
  canDelete: boolean
  working: boolean
  onSaved(asset: MediaAsset): Promise<void>
  onDelete(): void
  onRestore(): void
}) {
  const [tab, setTab] = useState<'details' | 'usage'>('details')
  const dirty = useRef(false)
  function changeTab(next: 'details' | 'usage') {
    if (working || next === tab) return
    const proceed = () => {
      dirty.current = false
      onDirtyChange?.(false)
      setTab(next)
      onTabChange?.(next)
    }
    if (requestClientNavigation(proceed)) proceed()
  }
  return (
    <>
      <div className="media-detail-preview">
        <MediaThumb asset={asset} large />
      </div>
      <div className={'media-detail-head ' + mediaUi.detailHeading}>
        <div>
          <p className="eyebrow">Selected image</p>
          <h3 className={recordTableStyles.truncateValue} title={asset.name}>
            {asset.name}
          </h3>
          <small className={styles.scope}>{asset.scope === 'shared' ? 'Shared' : 'This site'}</small>
        </div>
        <Badge
          tone={
            asset.status === 'ready'
              ? 'live'
              : asset.status === 'failed'
                ? 'error'
                : asset.status === 'processing'
                  ? 'info'
                  : 'neutral'
          }
        >
          {mediaStatusLabel(asset.status)}
        </Badge>
      </div>
      <Tabs
        label="Image details views"
        value={tab}
        tabs={[
          { value: 'details', label: 'Details' },
          { value: 'usage', label: 'Used on' },
        ]}
        onChange={value => changeTab(value as 'details' | 'usage')}
      >
        {tab === 'details' ? (
          <>
            {canEdit ? (
              <MetadataForm
                key={`${asset.id}:${asset.revision}`}
                asset={asset}
                onSaved={onSaved}
                externalSave={externalSave}
                onBusyChange={onBusyChange}
                onDirtyChange={value => {
                  dirty.current = value
                  onDirtyChange?.(value)
                }}
              />
            ) : (
              <div className="media-readonly">
                <IconInfo size={15} />
                <p>
                  {asset.scope === 'shared'
                    ? 'Shared metadata is maintained by a super admin.'
                    : 'This image is not editable in its current state.'}
                </p>
              </div>
            )}
            <div className="media-detail-actions">
              {canEdit && (
                <Button variant="secondary" disabled={working} onClick={onReplace}>
                  Replace image…
                </Button>
              )}
              {asset.status === 'deleted' && canDelete ? (
                <Button
                  variant="secondary"
                  disabled={working}
                  onClick={event => {
                    event.currentTarget.focus()
                    onRestore()
                  }}
                >
                  <IconRevert size={16} /> Restore image
                </Button>
              ) : asset.status === 'ready' && canDelete ? (
                <Button
                  variant="destructive"
                  disabled={working}
                  onClick={event => {
                    event.currentTarget.focus()
                    onDelete()
                  }}
                >
                  <IconTrash size={16} /> Delete image
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <UsagePanel mediaId={asset.id} />
        )}
      </Tabs>
    </>
  )
}

function MetadataForm({
  asset,
  onSaved,
  onBusyChange,
  onDirtyChange,
  externalSave = false,
}: {
  externalSave?: boolean
  onBusyChange?: (value: boolean) => void
  onDirtyChange?: (value: boolean) => void
  asset: MediaAsset
  onSaved(asset: MediaAsset): Promise<void>
}) {
  const [value, setValue] = useState<MediaMetadataInput>({
    altText: asset.altText,
    decorative: asset.decorative,
    focal: asset.focal,
    folder: asset.folder,
    attribution: asset.attribution,
    source: asset.source,
    tags: asset.tags,
  })
  const [tagInput, setTagInput] = useState(asset.tags.join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [saved, setSaved] = useState(() => ({ value: structuredClone(value), tags: tagInput })),
    currentAsset = useRef(asset)
  const dirty = JSON.stringify(value) !== JSON.stringify(saved.value) || tagInput !== saved.tags
  useNavigationGuard(() => ({
    dirty,
    pending: saving || inFlight.current,
    draft: {
      label: 'Image details',
      saveMode: 'library',
      saveDraft: save,
      discard: () => {
        setValue(structuredClone(saved.value))
        setTagInput(saved.tags)
        setError(null)
      },
    },
  }))
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty])
  useEffect(() => {
    if (typeof window === 'undefined') return
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty || saving || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty, saving])
  async function save(): Promise<{ ok: boolean; message?: string }> {
    if (inFlight.current) return { ok: false, message: 'Wait for the current image save to finish.' }
    if (!value.decorative && !value.altText.trim()) {
      const message = 'Add a description or mark the image as decorative.'
      setError(message)
      return { ok: false, message }
    }
    inFlight.current = true
    let completed = false
    onBusyChange?.(true)
    setSaving(true)
    setError(null)
    try {
      const next = await updateMediaMetadata(currentAsset.current, { ...value, tags: normalizedTags(tagInput) })
      completed = true
      currentAsset.current = next
      setSaved({ value: structuredClone(value), tags: tagInput })
      await onSaved(next)
      return { ok: true }
    } catch (reason) {
      const message = completed
        ? 'The metadata was saved, but the library could not be refreshed. Reload the library before editing it again.'
        : reason instanceof MediaRequestError
          ? reason.message
          : 'The metadata save could not be confirmed. Reload the library before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      inFlight.current = false
      setSaving(false)
      onBusyChange?.(false)
    }
  }
  return (
    <form
      id={'media-metadata-' + asset.id}
      className="media-metadata"
      aria-busy={saving}
      onSubmit={event => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset disabled={saving} aria-label="Image metadata" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Field id={`media-alt-${asset.id}`} label="Description for people who can’t see it" density="compact">
          <textarea
            id={`media-alt-${asset.id}`}
            required={!value.decorative}
            disabled={value.decorative}
            value={value.altText}
            onChange={event => setValue({ ...value, altText: event.target.value })}
          />
        </Field>
        <label className={selectionControlsStyles.checkRow}>
          <input
            type="checkbox"
            checked={value.decorative}
            onChange={event =>
              setValue({
                ...value,
                decorative: event.target.checked,
                altText: event.target.checked ? '' : value.altText,
              })
            }
          />
          <span>
            <strong>Decorative image</strong>
            <small>People using screen readers can skip it.</small>
          </span>
        </label>
        <Field id={`media-folder-${asset.id}`} label="Folder" density="compact">
          <input
            id={`media-folder-${asset.id}`}
            value={value.folder}
            placeholder="Campaigns/Fall Appeal"
            onChange={event => setValue({ ...value, folder: event.target.value })}
          />
        </Field>
        <ImageFocusControl
          src={asset.previewUrl}
          value={value.focal}
          disabled={saving}
          onChange={focal => setValue({ ...value, focal })}
        />
        <Disclosure title="More details">
          <div className={listInspectorStyles.formStack}>
            <dl className="media-facts">
              <div>
                <dt>Dimensions</dt>
                <dd>{formatDimensions(asset)}</dd>
              </div>
              <div>
                <dt>File size</dt>
                <dd>{formatBytes(asset.bytes)}</dd>
              </div>
              <div>
                <dt>Library</dt>
                <dd>{asset.scope === 'shared' ? 'Shared' : 'This site'}</dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>{dateFormatter.format(new Date(asset.createdAt))}</dd>
              </div>
            </dl>{' '}
            <Field
              id={`media-tags-${asset.id}`}
              label="Tags"
              density="compact"
              help="Comma-separated; up to 24."
              helpAfter
            >
              <input
                id={`media-tags-${asset.id}`}
                value={tagInput}
                placeholder="appeal, approved"
                onChange={event => setTagInput(event.target.value)}
              />
            </Field>
            <Field id={`media-credit-${asset.id}`} label="Attribution / credit" density="compact">
              <input
                id={`media-credit-${asset.id}`}
                value={value.attribution}
                onChange={event => setValue({ ...value, attribution: event.target.value })}
              />
            </Field>
            <Field id={`media-source-${asset.id}`} label="Source / rights note" density="compact">
              <textarea
                id={`media-source-${asset.id}`}
                value={value.source}
                onChange={event => setValue({ ...value, source: event.target.value })}
              />
            </Field>
          </div>
        </Disclosure>
      </fieldset>
      {error && (
        <p className="media-inline-error" role="alert">
          <IconAlert size={15} /> {error}
        </p>
      )}
      {!externalSave && (
        <Button variant="primary" type="submit" disabled={saving || (!value.decorative && value.altText.trim() === '')}>
          {saving ? 'Saving…' : 'Save image details'}
        </Button>
      )}
    </form>
  )
}

function UsagePanel({ mediaId }: { mediaId: string }) {
  const [usage, setUsage] = useState<MediaUsageResult | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setUsage(null)
    setError(false)
    fetchMediaUsage(mediaId)
      .then(next => {
        if (!cancelled) setUsage(next)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [mediaId])
  if (error) return <p className="media-readonly">Usage could not be loaded.</p>
  if (!usage)
    return (
      <p className="media-readonly" role="status">
        Loading usage…
      </p>
    )
  const groups: Array<[string, MediaUsageResult[keyof MediaUsageResult]]> = [
    ['Current on live site', usage.currentLive],
    ['Current draft only', usage.currentDraft],
    ['Saved history', usage.history],
  ]
  if (groups.every(([, rows]) => rows.length === 0))
    return (
      <div className="media-usage-empty">
        <IconInfo size={16} />
        <p>No saved content references this image.</p>
      </div>
    )
  return (
    <div className="media-usage-detail">
      {groups.map(([label, rows]) => (
        <section key={label}>
          <h4>
            {label}
            <span>{rows.length}</span>
          </h4>
          {rows.length === 0 ? (
            <p>None</p>
          ) : (
            <ul>
              {rows.map(row => (
                <li key={row.key}>
                  <span>
                    {row.href ? (
                      <TextLink href={row.href} title={row.title}>
                        {row.title}
                      </TextLink>
                    ) : (
                      <strong>{row.title}</strong>
                    )}
                    <small>
                      {
                        { page: 'Page', collection: 'List', global: 'Site look', 'site-files': 'Site interactions' }[
                          row.kind
                        ]
                      }{' '}
                      · {row.versionLabel}
                    </small>
                  </span>
                  <time dateTime={row.createdAt}>{dateFormatter.format(new Date(row.createdAt))}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
