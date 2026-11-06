'use client'

import { useState, useTransition } from 'react'
import { setSectionFavourite } from '../app/sites/[siteId]/sections/library-actions.ts'

export function SectionFavourite({
  siteId,
  definitionId,
  name,
  initial = false,
  compact = false,
  onChange,
}: {
  siteId: string
  definitionId: string
  name: string
  initial?: boolean
  /** A star beside the card's name, as on the library page; the label is unchanged. */
  compact?: boolean
  onChange?: (favourite: boolean) => void
}) {
  const [favourite, setFavourite] = useState(initial)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  return (
    <>
      <button
        type="button"
        className={compact ? `icon-btn favourite-star${favourite ? ' is-on' : ''}` : 'secondary small'}
        aria-pressed={favourite}
        disabled={pending}
        aria-label={`${favourite ? 'Remove' : 'Save'} ${name} ${favourite ? 'from' : 'to'} favourites`}
        onClick={() =>
          startTransition(async () => {
            setError('')
            try {
              const result = await setSectionFavourite(siteId, definitionId, !favourite)
              if (!result.ok) {
                setError(result.message)
                return
              }
              setFavourite(!favourite)
              onChange?.(!favourite)
            } catch {
              setError('Your change could not be saved. Try again.')
            }
          })
        }
      >
        <span aria-hidden="true">{favourite ? '★' : '☆'}</span>
        {!compact && <> {pending ? 'Saving…' : favourite ? 'Favourite' : 'Save favourite'}</>}
      </button>
      {error && (
        <p className="error-inline" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
