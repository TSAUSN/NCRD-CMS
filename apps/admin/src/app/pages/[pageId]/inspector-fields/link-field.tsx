'use client'
import { useState } from 'react'
import { safeUrl } from '@cms/renderer'
import { IconAlert } from '../../../../components/icons.tsx'
import type { LinkTarget } from '../../../../lib/queries.ts'
import { ButtonAppearanceField } from './button-appearance-field.tsx'

/**
 * A link: the words, and where they go.
 *
 * The destination is judged by `safeUrl` — the function that decides the `href`
 * the page actually ships — so "this will not work" here and "this became `#`"
 * on the page are one decision rather than two. Saying which kinds of address
 * are refused, in words, matters more than the refusal: `javascript:` is not
 * something a person types by accident, but a pasted `//example.org/thing` is,
 * and being told it reads as another site rather than as a path is the
 * difference between fixing it and retyping it three times.
 */
export function LinkField({
  id,
  value,
  targets,
  onChange,
  destinationOnly = false,
  grouped = false,
  themeColors,
  customCode,
}: {
  id: string
  value: unknown
  targets: LinkTarget[]
  destinationOnly?: boolean
  /** The words are edited just above, in the same link group. */
  grouped?: boolean
  themeColors: Record<string, string>
  onEditList?: (readerKey: string, stableKey?: string) => void
  customCode: boolean
  onChange: (value: unknown) => void
}) {
  const current = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const url = String(current['url'] ?? '')
  const label = String(current['label'] ?? '')
  const target = targets.find(candidate => candidate.path === url)
  const [destinationType, setDestinationType] = useState<'page' | 'address'>(target ? 'page' : 'address')
  const refused = url.trim() !== '' && safeUrl(url) === '#' && url.trim() !== '#'
  const offSite = /^https?:/i.test(safeUrl(url))

  return (
    <div className="subfields">
      {destinationOnly ? (
        !grouped && <p className="hint">Edit the link’s words directly on the page or in its text fields.</p>
      ) : (
        <>
          <label htmlFor={`${id}-label`}>Words people click</label>
          <input
            id={`${id}-label`}
            type="text"
            value={label}
            onChange={event => onChange({ ...current, label: event.target.value })}
          />
        </>
      )}
      {!destinationOnly && label.trim() === '' && url.trim() !== '' && (
        <p className="warn-inline">
          <IconAlert size={14} />
          <span>A link with no words is invisible to somebody using a screen reader.</span>
        </p>
      )}

      {!grouped && <span className="subfield-label">Where it goes</span>}
      <div className="group link-destination-switch" role="group" aria-label="Link destination type">
        <button type="button" aria-pressed={destinationType === 'page'} onClick={() => setDestinationType('page')}>
          Page on this site
        </button>
        <button
          type="button"
          aria-pressed={destinationType === 'address'}
          onClick={() => setDestinationType('address')}
        >
          Web address, email or phone
        </button>
      </div>

      {destinationType === 'page' ? (
        <>
          <label htmlFor={`${id}-page`}>Page</label>
          <select
            id={`${id}-page`}
            value={target?.id ?? ''}
            disabled={targets.length === 0}
            aria-describedby={`${id}-page-note`}
            onChange={event => {
              const selected = targets.find(candidate => candidate.id === event.target.value)
              if (selected) onChange({ ...current, url: selected.path })
            }}
          >
            <option value="">Choose a published page…</option>
            {targets.map(candidate => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title} — {candidate.path}
              </option>
            ))}
          </select>
          <p className="hint" id={`${id}-page-note`}>
            Only published pages are listed, so this link cannot lead visitors to a draft.
          </p>
          {url.trim() !== '' && !target && (
            <p className="hint">The existing address stays unchanged until you choose a page.</p>
          )}
        </>
      ) : (
        <>
          <label htmlFor={`${id}-url`}>Address</label>
          <input
            id={`${id}-url`}
            type="text"
            placeholder="https://example.org, mailto: or tel:"
            value={url}
            aria-describedby={`${id}-url-note`}
            onChange={event => onChange({ ...current, url: event.target.value })}
          />
          <p className="hint" id={`${id}-url-note`}>
            Use the whole address for another website, or start with <code className="mono">mailto:</code> or{' '}
            <code className="mono">tel:</code>.
          </p>
        </>
      )}
      {destinationType === 'address' && refused && (
        <p className="error-inline">
          <IconAlert size={14} />
          <span>
            This address will not be used — the link would go nowhere. Addresses starting{' '}
            <code className="mono">//</code> mean another site, and only <code className="mono">https</code>,{' '}
            <code className="mono">http</code>, <code className="mono">mailto</code> and{' '}
            <code className="mono">tel</code> addresses are allowed.
          </span>
        </p>
      )}
      {destinationType === 'address' && offSite && !refused && (
        <p className="hint">This link leaves your website. Check its destination in Preview before publishing.</p>
      )}
      {!destinationOnly && (
        <div className="link-choices">
          {/* Choices that travel with this one link. Cleared choices
            are removed rather than stored as false, so an untouched link stays
            byte-identical. */}
          <label className="checkbox">
            <input
              type="checkbox"
              checked={current['newTab'] === true}
              onChange={event => onChange(withLinkChoice(current, 'newTab', event.target.checked))}
            />
            <span>
              Open in a new tab
              <small>
                Best for documents and other websites; people can lose their place when a page opens elsewhere.
              </small>
            </span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={current['nofollow'] === true}
              onChange={event => onChange(withLinkChoice(current, 'nofollow', event.target.checked))}
            />
            <span>
              Don’t recommend to search engines (nofollow)<small>For sponsored or unvetted destinations.</small>
            </span>
          </label>
        </div>
      )}
      {!destinationOnly && (
        <ButtonAppearanceField
          id={id}
          value={current}
          colors={themeColors}
          customCode={customCode}
          onChange={onChange}
        />
      )}
    </div>
  )
}

function withLinkChoice(
  value: Record<string, unknown>,
  choice: 'newTab' | 'nofollow',
  on: boolean,
): Record<string, unknown> {
  const next = { ...value }
  if (on) next[choice] = true
  else delete next[choice]
  return next
}
