'use client'
import { useEffect, useState } from 'react'
import { IconSearch } from '../../../../components/icons.tsx'

/** Start accepting searches once the input can keep them. */
export function MediaSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [ready, setReady] = useState(false)
  // Text accepted before hydration has no search handler and can be lost.
  useEffect(() => setReady(true), [])
  return (
    <div className="media-search">
      <IconSearch size={16} />
      <label className="sr-only" htmlFor="media-search">
        Search all images
      </label>
      <input
        id="media-search"
        type="search"
        placeholder="Search names, descriptions, credits or tags"
        value={value}
        disabled={!ready}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  )
}
