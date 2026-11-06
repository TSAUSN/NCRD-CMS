'use client'
import type { CSSProperties } from 'react'
export type CanvasMenuAddState = { scale: number; disabled: boolean; options: { id: string; title: string }[] }
/** One in-place menu control for the ordinary and isolated site canvases. */
export function CanvasMenuAdd({
  scale,
  disabled,
  options,
  onAdd,
}: CanvasMenuAddState & { onAdd: (id: string) => void }) {
  return (
    <div
      data-cms-menu-add=""
      style={
        {
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 'calc(var(--cms-space-2) / var(--cms-editor-scale))',
          padding: 'calc(var(--cms-space-2) / var(--cms-editor-scale))',
          background: 'var(--cms-surface)',
          color: 'var(--cms-status-review)',
          '--cms-editor-scale': scale,
        } as CSSProperties
      }
    >
      <label
        style={{
          display: 'grid',
          minWidth: 0,
          maxWidth: '100%',
          gap: 'calc(var(--cms-space-1) / var(--cms-editor-scale))',
          fontSize: 'calc(var(--cms-text-meta) / var(--cms-editor-scale))',
        }}
      >
        Add page to menu
        <span style={{ position: 'relative', display: 'block', minWidth: 0, maxWidth: '100%' }}>
          <select
            aria-label="Add page to menu"
            value=""
            disabled={disabled || !options.length}
            style={{
              appearance: 'none',
              display: 'block',
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: '100%',
              minHeight: 'calc(var(--cms-target-small) / var(--cms-editor-scale))',
              paddingBlock: 'calc(var(--cms-space-1) / var(--cms-editor-scale))',
              paddingInlineStart: 'calc(var(--cms-space-2) / var(--cms-editor-scale))',
              paddingInlineEnd: 'calc(var(--cms-space-6, var(--cms-target-small)) / var(--cms-editor-scale))',
              font: 'inherit',
              lineHeight: '1.4',
              background: 'var(--cms-surface)',
              color: 'var(--cms-text)',
              border: 'calc(var(--cms-line-thin) / var(--cms-editor-scale)) dashed var(--cms-status-review)',
              borderRadius: 'calc(var(--cms-radius-control) / var(--cms-editor-scale))',
            }}
            onChange={event => onAdd(event.target.value)}
          >
            <option value="">{options.length ? 'Choose a page…' : 'All pages added'}</option>
            {options.map(page => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              insetInlineEnd: 'calc(var(--cms-space-2) / var(--cms-editor-scale))',
              insetBlockStart: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
            }}
          >
            ▾
          </span>
        </span>
      </label>
    </div>
  )
}
