import { canRedo, canUndo, type EditorState } from '@cms/domain'
import { IconRedo, IconUndo } from '../../../components/icons.tsx'
import type { EditorPane } from './editor-types.ts'
import { VIEWPORTS, type Viewport } from './editor-viewports.ts'

type Inputs = {
  state: EditorState
  editingFrame?: boolean
  viewport: Viewport
  changeHistory: (forward: boolean) => void
  setViewport: (viewport: Viewport) => void
  setZoom: (zoom: 'fit' | 'actual') => void
  setPane: (pane: EditorPane) => void
}

/** Use draft history and choose the preview width. */
export function EditorViewTools({
  state,
  editingFrame,
  viewport,
  changeHistory,
  setViewport,
  setZoom,
  setPane,
}: Inputs) {
  return (
    <>
      <div className="cluster" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className="icon-btn tip"
          data-tip="Undo (⌘Z)"
          aria-label="Undo"
          disabled={editingFrame || !canUndo(state)}
          onClick={() => changeHistory(false)}
        >
          <IconUndo size={17} />
        </button>
        <button
          type="button"
          className="icon-btn tip"
          data-tip="Redo (⌘⇧Z)"
          aria-label="Redo"
          disabled={editingFrame || !canRedo(state)}
          onClick={() => changeHistory(true)}
        >
          <IconRedo size={17} />
        </button>
      </div>

      <div className="cluster">
        <div className="group" role="group" aria-label="Preview width">
          {(Object.keys(VIEWPORTS) as Viewport[]).map(name => {
            const { label, Icon } = VIEWPORTS[name]
            return (
              <button
                key={name}
                type="button"
                className="tip"
                data-tip={label}
                aria-label={label}
                aria-pressed={viewport === name}
                onClick={() => {
                  setViewport(name)
                  setZoom('fit')
                  setPane('canvas')
                }}
              >
                <Icon size={16} />
                <span className="device-label">{label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
