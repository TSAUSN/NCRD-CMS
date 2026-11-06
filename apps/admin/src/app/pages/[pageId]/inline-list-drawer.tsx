'use client'
import { useEffect, useRef, useState } from 'react'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { parseCollectionEntryValues } from '@cms/schema'
import { listItemFields } from '../../../lib/list-items.ts'
import { Drawer, Button } from '../../../components/ui/index.ts'
import { CollectionFieldControl } from '../../../components/collection-field-control.tsx'
import type { MediaAsset } from '../../../lib/media-library.ts'
import { loadInlineList, saveInlineListItem } from './inline-list-actions.ts'
import { DocumentPickerDialog } from '../../sites/[siteId]/content/document-picker-dialog.tsx'
import { MediaPicker } from './media-picker.tsx'
import styles from './inspector.module.css'
export function InlineListDrawer({
  pageId,
  readerKey,
  stableKey,
  unit,
  media,
  onClose,
  onSaved,
}: {
  pageId: string
  readerKey: string
  stableKey?: string
  unit: string
  media: MediaAsset[]
  onClose: () => void
  onSaved: () => void
}) {
  const busy = useRef(false),
    [saved, setSaved] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<Awaited<ReturnType<typeof loadInlineList>> | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [error, setError] = useState<string | null>(null),
    [pending, setPending] = useState(false)
  const [documentField, setDocumentField] = useState<string | null>(null)
  const [pictureField, setPictureField] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void loadInlineList(pageId, readerKey)
      .then(result => {
        if (!active) return
        setLoaded(result)
        if (result.ok) {
          const entry = result.list.entries.find(entry => entry.stableKey === stableKey && !entry.archived)
          if (stableKey && !entry) {
            setError('This item is no longer in the list.')
            return
          }
          const initial =
            entry?.values ??
            Object.fromEntries(
              result.list.draft.fields.map(field => [field.key, field.type === 'boolean' ? false : '']),
            )
          setValues(structuredClone(initial))
          setSaved(JSON.stringify(initial))
        }
      })
      .catch(() => {
        if (active) setError('The list could not be loaded. Close this form and try again.')
      })
    return () => {
      active = false
    }
  }, [pageId, readerKey, stableKey])
  const list = loaded?.ok ? loaded.list : null
  const fields = list ? listItemFields(list.draft, Boolean(stableKey)) : []
  const check = list ? parseCollectionEntryValues(fields, values) : null
  const dirty = (saved !== null && JSON.stringify(values) !== saved) || pictureField !== null || documentField !== null
  useNavigationGuard(() => ({
    dirty,
    pending: pending || busy.current,
    draft: { label: unit, saveDraft: save, discard: onClose },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || pending || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, pending])
  async function save(): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for the current list save to finish.' }
    if (pictureField || documentField)
      return {
        ok: false,
        message: 'Finish choosing the photo or document before saving this item. Keep editing to return to the picker.',
      }
    if (!list) return { ok: false, message: 'The list is not ready. Keep editing and reopen the form before saving.' }
    if (!check?.ok) {
      const message = check?.problems.join(' ') || 'Complete the required item fields before saving.'
      setError(message)
      return { ok: false, message }
    }
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await saveInlineListItem({
        pageId,
        readerKey,
        entryRevision: list.entryRevision,
        ...(stableKey ? { stableKey } : {}),
        values: check.values,
      })
      if (!result.ok) {
        setError(result.message)
        return { ok: false, message: result.message }
      }
      setSaved(JSON.stringify(values))
      onSaved()
      return { ok: true }
    } catch {
      const message = 'The save could not be confirmed. Reopen this form before trying again.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Drawer
      title={stableKey ? 'Edit ' + unit : 'Add ' + unit}
      pending={pending}
      onClose={() => {
        if (!busy.current) onClose()
      }}
      footer={
        list ? (
          <>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (!busy.current) onClose()
              }}
            >
              Cancel
            </Button>
            <Button loading={pending} disabled={!check?.ok} onClick={() => void save()}>
              Save {unit}
            </Button>
          </>
        ) : undefined
      }
    >
      {error && (
        <p role="alert" className="error-inline">
          {error}
        </p>
      )}
      {!loaded && !error && <p role="status">Loading the list…</p>}
      {loaded && !loaded.ok && <p role="alert">{loaded.message}</p>}
      {list && (
        <div className={styles.content}>
          <p className="notice notice-info">
            Updates this {unit} everywhere it appears
            {loaded?.ok && loaded.usedOn.length ? ' (' + loaded.usedOn.join(', ') + ')' : ''}. Save creates a private
            list draft. Publish the list when it is ready for visitors.
          </p>
          {fields.map(field => (
            <CollectionFieldControl
              key={field.key}
              field={field}
              entry={{ id: null, stableKey: stableKey ?? 'new', values }}
              media={media}
              disabled={pending}
              onChange={value => setValues(current => ({ ...current, [field.key]: value }))}
              onChooseImage={() => setPictureField(field.key)}
              onChooseDocument={() => setDocumentField(field.key)}
            />
          ))}
        </div>
      )}
      {documentField && loaded?.ok && (
        <DocumentPickerDialog
          siteId={loaded.siteId}
          documents={[]}
          onClose={() => setDocumentField(null)}
          onUploaded={() => {}}
          onChoose={document => {
            setValues(current => ({ ...current, [documentField]: document.url }))
            setDocumentField(null)
          }}
        />
      )}
      {pictureField && loaded?.ok && (
        <MediaPicker
          siteId={loaded.siteId}
          initialAssets={media}
          currentValue={
            values[pictureField] && typeof values[pictureField] === 'object'
              ? (values[pictureField] as { src?: string; alt?: string; decorative?: boolean })
              : undefined
          }
          onClose={() => setPictureField(null)}
          onChoose={image => {
            const asset = media.find(asset => asset.id === image.media_id)
            const src = asset?.deliveryUrl ?? image.src
            if (src)
              setValues(current => ({
                ...current,
                [pictureField]: { src, alt: image.alt ?? '', decorative: image.decorative === true },
              }))
            setPictureField(null)
          }}
        />
      )}
    </Drawer>
  )
}
