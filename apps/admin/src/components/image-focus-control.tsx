'use client'
import { useId, useRef, useState } from 'react'
import { imageFocus, imageFocusPosition, type ImageFocus } from '@cms/schema'
import { pointerImageFocus, keyboardImageFocus } from '../lib/image-focus-control.ts'
import { Button } from './ui/button.tsx'
import { Disclosure } from './ui/disclosure.tsx'
import { IconImage } from './icons.tsx'
import styles from './image-focus-control.module.css'

export function ImageFocusControl({
  src,
  value,
  onChange,
  disabled = false,
}: {
  src: string | null
  value: unknown
  onChange: (value: ImageFocus | null) => void
  disabled?: boolean
}) {
  const id = useId()
  const drag = useRef<{ pointer: number; point: ImageFocus } | null>(null)
  const [draft, setDraft] = useState<ImageFocus | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const stored = imageFocus(value)
  const point = draft ?? stored ?? { x: 0.5, y: 0.5 }
  const available = Boolean(src && src !== failed)
  const position = imageFocusPosition(point)!
  function place(event: React.PointerEvent<HTMLButtonElement>) {
    const box = event.currentTarget.querySelector('img')?.getBoundingClientRect()
    return box ? pointerImageFocus(event.clientX, event.clientY, box) : null
  }
  function choose(next: ImageFocus | null) {
    if (!disabled) {
      setDraft(null)
      onChange(next)
    }
  }
  return (
    <fieldset className={styles.control} disabled={disabled}>
      <legend>Focus point</legend>
      <p id={`${id}-help`}>Drag the blue dot onto the part to keep in view.</p>
      <button
        type="button"
        aria-label="Choose focus point on image"
        aria-describedby={`${id}-help ${id}-position ${id}-keyboard`}
        className={styles.image}
        onPointerDown={event => {
          if (disabled || !available || loaded !== src || event.button !== 0) return
          const next = place(event)
          if (!next) return
          event.preventDefault()
          event.currentTarget.focus()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { pointer: event.pointerId, point: next }
          setDraft(next)
        }}
        onPointerMove={event => {
          if (drag.current?.pointer !== event.pointerId) return
          const next = place(event)
          if (next) {
            drag.current.point = next
            setDraft(next)
          }
        }}
        onPointerUp={event => {
          if (drag.current?.pointer !== event.pointerId) return
          const next = place(event) ?? drag.current.point
          drag.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          choose(next)
        }}
        onPointerCancel={() => {
          drag.current = null
          setDraft(null)
        }}
        onLostPointerCapture={() => {
          drag.current = null
          setDraft(null)
        }}
        onClick={event => {
          if (event.detail === 0) choose({ x: 0.5, y: 0.5 })
        }}
        onKeyDown={event => {
          const next = keyboardImageFocus(event.key, point, event.shiftKey)
          if (next) {
            event.preventDefault()
            choose(next)
          }
        }}
      >
        {available ? (
          <span className={styles.picture} data-loading={loaded !== src || undefined}>
            <img
              ref={node => {
                if (node?.complete && node.naturalWidth > 0 && loaded !== src) setLoaded(src)
              }}
              src={src!}
              alt=""
              draggable={false}
              onLoad={() => setLoaded(src)}
              onError={() => setFailed(src)}
            />
            {loaded === src ? (
              <span
                className={styles.dot}
                style={{
                  left: `clamp(var(--space-3),${point.x * 100}%,calc(100% - var(--space-3)))`,
                  top: `clamp(var(--space-3),${point.y * 100}%,calc(100% - var(--space-3)))`,
                }}
              />
            ) : (
              <span className={styles.loading} role="status">
                Loading image…
              </span>
            )}
          </span>
        ) : (
          <span className={styles.unavailable}>
            <IconImage size={24} />
            Image preview unavailable
          </span>
        )}
      </button>
      <p id={`${id}-position`} aria-live="polite">
        {!stored && !draft ? 'Automatic crop · ' : ''}
        {Math.round(point.x * 100)}% across · {Math.round(point.y * 100)}% down
      </p>

      {available && loaded === src ? (
        <div className={styles.crops} aria-label="Live crop previews">
          {(['Card', 'Phone', 'Wide'] as const).map(label => (
            <figure key={label}>
              <img
                alt={`${label} crop preview`}
                src={src!}
                data-crop={label.toLowerCase()}
                style={{ objectPosition: position }}
              />
              <figcaption>{label}</figcaption>
            </figure>
          ))}
        </div>
      ) : !available ? (
        <p role="status">You can still set the focus point with the controls.</p>
      ) : null}
      {src && failed === src && (
        <Button
          variant="secondary"
          size="s"
          onClick={() => {
            setFailed(null)
            setLoaded(null)
          }}
        >
          Try image again
        </Button>
      )}
      <Button variant="tertiary" size="s" onClick={() => choose(null)}>
        Use automatic crop
      </Button>
      <Disclosure title="Fine-tune position">
        <p id={`${id}-keyboard`}>Use arrow keys on the picture, Shift for a bigger move, or Home to centre it.</p>
        <div className={styles.ranges}>
          <label>
            Across
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={point.x}
              onChange={event => choose({ ...point, x: Number(event.target.value) })}
            />
          </label>
          <label>
            Down
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={point.y}
              onChange={event => choose({ ...point, y: Number(event.target.value) })}
            />
          </label>
        </div>
      </Disclosure>
    </fieldset>
  )
}
