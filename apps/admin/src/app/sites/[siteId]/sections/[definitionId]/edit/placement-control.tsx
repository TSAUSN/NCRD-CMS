'use client'

import { useState, useTransition } from 'react'
import { IconAlert, IconCheck, IconFrame } from '../../../../../../components/icons.tsx'
import { setSectionPlacement } from '../../library-actions.ts'

/** Where this definition may be used (ADR 0010). Shown to super admins only. */
export function PlacementControl({
  siteId,
  definitionId,
  initial,
}: {
  siteId: string
  definitionId: string
  initial: 'page' | 'header' | 'footer'
}) {
  const [placement, setPlacement] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <section className="global-panel placement-control" aria-label="Where this section is used">
      <div className="global-panel-head">
        <span>
          <IconFrame size={18} />
        </span>
        <div>
          <p className="eyebrow">Super admin</p>
          <h2>Used as</h2>
          <p>
            A site header or footer is chosen once in Header &amp; footer and appears on every page. It never appears in
            the page library. A definition that is already in use keeps its placement.
          </p>
        </div>
      </div>
      <div className="placement-control-row">
        <select
          aria-label="Used as"
          value={placement}
          disabled={pending}
          onChange={event => setPlacement(event.target.value as typeof placement)}
        >
          <option value="page">Page section</option>
          <option value="header">Site header</option>
          <option value="footer">Site footer</option>
        </select>
        <button
          type="button"
          className="secondary small"
          disabled={pending || placement === saved}
          onClick={() =>
            start(async () => {
              const outcome = await setSectionPlacement(siteId, definitionId, placement)
              setResult(outcome)
              if (outcome.ok) setSaved(placement)
              else setPlacement(saved)
            })
          }
        >
          {pending ? 'Saving…' : 'Change placement'}
        </button>
      </div>
      {result && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">{result.message}</span>
        </p>
      )}
    </section>
  )
}
