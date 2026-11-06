'use client'
import { useEffect, useState } from 'react'
import { validSectionAnchor } from '@cms/schema'

export function AnchorField({
  value,
  used,
  onChange,
}: {
  value: unknown
  used: unknown[]
  onChange: (value: string) => void
}) {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '')
  useEffect(() => setDraft(typeof value === 'string' ? value : ''), [value])
  const error =
    draft &&
    (!validSectionAnchor(draft)
      ? 'Start with a letter and use lowercase letters, numbers and hyphens. Avoid cms- and numbered section names.'
      : used.includes(draft)
        ? 'Another section already uses this anchor.'
        : null)
  return (
    <div className="field">
      <label htmlFor="section-anchor">Anchor link name</label>
      <input
        id="section-anchor"
        value={draft}
        maxLength={64}
        aria-invalid={Boolean(error)}
        aria-describedby="section-anchor-help"
        onChange={event => {
          const next = event.target.value.toLowerCase()
          setDraft(next)
          if (!next || (validSectionAnchor(next) && !used.includes(next))) onChange(next)
        }}
      />
      <p id="section-anchor-help" className={error ? 'error-inline' : 'hint'}>
        {error || 'Use this name after # in a link to jump here, for example #speakers.'}
      </p>
    </div>
  )
}
