'use client'
import { Button, Disclosure } from '../../../../components/ui/index.ts'
import { useNavigationGuard, requestClientNavigation } from '../../../../components/navigation-guard.ts'
import { useEffect, useRef, useState } from 'react'
import { createCollection, type CollectionCreateResult } from '../../../actions/collections.ts'
import { IconAlert, IconCollection } from '../../../../components/icons.tsx'
import { COLLECTION_PRESETS, type CollectionPresetKey } from './collection-workspace-model.ts'
import { Dialog } from './collection-dialog.tsx'

export function CreateCollectionDialog({
  siteId,
  siteName,
  onClose,
  onResult,
  onCreatedAfterClose,
  onDraftCreated,
}: {
  siteId: string
  siteName: string
  onClose: () => void
  onCreatedAfterClose: () => void
  onDraftCreated: () => void
  onResult: (result: Extract<CollectionCreateResult, { ok: true }>) => void
}) {
  const [presetKey, setPresetKey] = useState<CollectionPresetKey>('speakers')
  const [name, setName] = useState('Speakers')
  const [slug, setSlug] = useState('speakers')
  const [readerKey, setReaderKey] = useState('speakers')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const touchedSlug = useRef(false)
  const touchedReaderKey = useRef(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  const created = useRef<Extract<CollectionCreateResult, { ok: true }> | null>(null)
  const dirty =
    !created.current &&
    JSON.stringify([presetKey, name, slug, readerKey]) !==
      JSON.stringify(['speakers', 'Speakers', 'speakers', 'speakers'])
  const discard = () => {
    setPresetKey('speakers')
    setName('Speakers')
    setSlug('speakers')
    setReaderKey('speakers')
    touchedSlug.current = false
    touchedReaderKey.current = false
    setError(null)
  }
  const saveBeforeLeaving = async () => {
    if (!name.trim()) return { ok: false, message: 'Give the list a name before saving.' }
    const result = await submit(false)
    return result?.ok
      ? { ok: true }
      : { ok: false, message: result?.message ?? 'Wait for the current list creation to finish before leaving.' }
  }
  useNavigationGuard(() => ({
    dirty,
    pending: working || inFlight.current,
    draft: { label: 'New list setup', saveDraft: saveBeforeLeaving, discard },
  }))
  useEffect(() => {
    if (typeof window === 'undefined') return
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || working || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, working])
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  function dismiss() {
    const leave = () => {
      alive.current = false
      onClose()
    }
    // Closing a creation already sent to the server cannot cancel its result.
    if (inFlight.current) {
      leave()
      return
    }
    if (requestClientNavigation(leave)) leave()
  }
  function setNameAndMaybeSlug(value: string) {
    setName(value)
    const generated = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!touchedSlug.current) setSlug(generated)
    if (!touchedReaderKey.current) setReaderKey(generated.replaceAll('-', '_'))
  }
  async function submit(navigate = true): Promise<CollectionCreateResult | undefined> {
    if (created.current) {
      if (navigate && alive.current) onResult(created.current)
      return created.current
    }
    if (inFlight.current) return
    inFlight.current = true
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('name', name)
    data.set('slug', slug)
    data.set('readerKey', readerKey)
    data.set('model', JSON.stringify(COLLECTION_PRESETS[presetKey].model))
    setWorking(true)
    setError(null)
    try {
      const result = await createCollection(data)
      if (result.ok) {
        created.current = result
        if (alive.current) {
          if (navigate) onResult(result)
          else onDraftCreated()
        } else onCreatedAfterClose()
      } else if (alive.current) setError(result.message)
      return result
    } catch {
      const message = 'Creation could not be confirmed. Check the Lists before trying again.'
      if (alive.current) setError(message)
      return { ok: false, kind: 'error', message }
    } finally {
      inFlight.current = false
      if (alive.current) setWorking(false)
    }
  }
  return (
    <Dialog
      title="Create a list"
      lede={`Choose a useful starting shape for ${siteName}. You can refine every field before publishing.`}
      onClose={dismiss}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={dismiss}>
            Cancel
          </Button>
          <Button disabled={working || !name.trim() || !slug.trim() || !readerKey.trim()} onClick={() => void submit()}>
            {working ? 'Creating…' : 'Create list'}
          </Button>
        </>
      }
    >
      <div className="preset-grid">
        {(
          Object.entries(COLLECTION_PRESETS) as [
            CollectionPresetKey,
            (typeof COLLECTION_PRESETS)[CollectionPresetKey],
          ][]
        ).map(([key, preset]) => (
          <Button
            key={key}
            variant="secondary"
            disabled={working}
            className={presetKey === key ? 'is-selected' : ''}
            aria-pressed={presetKey === key}
            onClick={() => {
              setPresetKey(key)
              setNameAndMaybeSlug(preset.label.replace(' & people', ''))
            }}
          >
            <IconCollection size={18} />
            <span>
              <strong>{preset.label}</strong>
              <small>{preset.description}</small>
            </span>
          </Button>
        ))}
      </div>
      <div className="collection-create-fields">
        <div className="field">
          <label htmlFor="new-collection-name">List name</label>
          <input
            id="new-collection-name"
            disabled={working}
            value={name}
            onChange={event => setNameAndMaybeSlug(event.target.value)}
          />
        </div>
      </div>
      <Disclosure title="Advanced · addresses and keys">
        <p className="hint">Generated from the name. Change these only when connecting an existing section.</p>
        <div className="collection-create-fields">
          <div className="field">
            <label htmlFor="new-collection-slug">List address</label>
            <input
              id="new-collection-slug"
              disabled={working}
              value={slug}
              onChange={event => {
                touchedSlug.current = true
                setSlug(event.target.value)
              }}
            />
            <small>Lowercase words separated by hyphens.</small>
          </div>
          <div className="field">
            <label htmlFor="new-collection-key">Reader key</label>
            <input
              id="new-collection-key"
              disabled={working}
              value={readerKey}
              onChange={event => {
                touchedReaderKey.current = true
                setReaderKey(event.target.value)
              }}
              aria-describedby="new-collection-key-hint"
            />
            <small id="new-collection-key-hint">
              Start with a letter; use lowercase letters, numbers and underscores, for example guest_speakers. Pages
              keep this key even if the list is renamed.
            </small>
          </div>
        </div>
      </Disclosure>
      {working && (
        <p role="status" className="hint">
          Creation has started. Closing this window keeps you here, but the list may still be created.
        </p>
      )}
      {error && (
        <p className="notice notice-error collection-dialog-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{error}</span>
        </p>
      )}
    </Dialog>
  )
}
