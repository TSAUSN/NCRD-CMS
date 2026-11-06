'use client'
import { isSourceDrawing, SOURCE_DRAWINGS } from '@cms/schema'

/**
 * One of V1's own icon drawings, chosen by name (LIB-02). The drawings are the
 * code-owned set from @cms/schema, so drawing them here inserts no stored or
 * typed markup; a value outside the set shows as no icon.
 */
export function DrawingField({
  id,
  value,
  onChange,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
}) {
  const current = isSourceDrawing(value) ? value : null
  return (
    <div className="drawing-field">
      {current && (
        <p className="drawing-current">
          <span
            className="drawing-swatch"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: SOURCE_DRAWINGS[current].svg }}
          />
          {SOURCE_DRAWINGS[current].label}
        </p>
      )}
      <div className="drawing-grid" role="group" id={id} aria-labelledby={`field-label-${id}`}>
        {Object.entries(SOURCE_DRAWINGS).map(([key, drawing]) => (
          <button
            key={key}
            type="button"
            className="drawing-choice tip"
            data-tip={drawing.label}
            aria-label={drawing.label}
            aria-pressed={key === current}
            onClick={() => onChange(key)}
          >
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: drawing.svg }} />
          </button>
        ))}
      </div>
      <p className="hint">
        Decorative symbol. Keep its meaning in the nearby text too.
        {current && (
          <>
            {' '}
            <button type="button" className="link" onClick={() => onChange('')}>
              Remove the icon
            </button>
          </>
        )}
      </p>
    </div>
  )
}
