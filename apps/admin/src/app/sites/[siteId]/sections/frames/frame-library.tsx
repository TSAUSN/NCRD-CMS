'use client'

import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../../../../components/confirm.tsx'
import type { FrameLibraryEntry } from '../../../../../lib/frame-library.ts'
import { setFrameLibraryStatus } from './actions.ts'

export function FrameLibrary({ siteId, initial }: { siteId: string; initial: FrameLibraryEntry[] }) {
  const [entries, setEntries] = useState(initial)
  useEffect(() => {
    setEntries(initial)
  }, [initial])
  const [selected, setSelected] = useState<FrameLibraryEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  async function change() {
    if (!selected || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    const status = selected.status === 'retired' ? 'active' : 'retired'
    try {
      const result = await setFrameLibraryStatus(siteId, selected.id, status)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setEntries(current => current.map(entry => (entry.id === selected.id ? { ...entry, status } : entry)))
      setMessage(result.message)
      setSelected(null)
    } catch {
      setError('This request could not be completed. Try again.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <>
      {message && (
        <p className="notice notice-ok" role="status">
          {message}
        </p>
      )}
      {entries.length === 0 && (
        <div className="empty-state">
          <h2>No authored frame components yet</h2>
          <p>Create an HTML component, choose Site header or Site footer, then check its preview and save.</p>
        </div>
      )}
      <div className="grid grid-cards">
        {entries.map(entry => (
          <article className="card" key={entry.id}>
            <h2>{entry.name}</h2>
            <p>
              {entry.placement === 'header' ? 'Header' : 'Footer'} · v{entry.version} ·{' '}
              {entry.scope === 'global' ? 'Shared across sites' : 'This site'}
            </p>
            <p>
              <span className="chip chip-neutral">{entry.status}</span> · Pinned on {entry.usedOnSites}{' '}
              {entry.usedOnSites === 1 ? 'site' : 'sites'}
            </p>
            <div className="actions">
              {entry.status === 'active' && (
                <a className="btn secondary small" href={`/sites/${siteId}/sections/${entry.id}/edit`}>
                  Edit component<span className="sr-only"> {entry.name}</span>
                </a>
              )}
              <button
                type="button"
                className="secondary small"
                disabled={busy}
                onClick={() => {
                  setSelected(entry)
                  setError(undefined)
                }}
              >
                {entry.status === 'retired' ? 'Restore' : 'Retire'}
                <span className="sr-only"> {entry.name}</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {selected && (
        <ConfirmDialog
          title={`${selected.status === 'retired' ? 'Restore' : 'Retire'} ${selected.name}?`}
          what={
            selected.status === 'retired'
              ? 'This component will be available for new site frames again.'
              : 'This component will be removed from new choices in the Header & footer picker.'
          }
          reassurance="Existing drafts, published frames and historical versions keep their content and pinned version. You can reverse this library change."
          confirmLabel={selected.status === 'retired' ? 'Restore component' : 'Retire component'}
          pending={busy}
          error={error}
          onConfirm={() => void change()}
          onCancel={() => {
            if (!busy) setSelected(null)
          }}
        />
      )}
    </>
  )
}
