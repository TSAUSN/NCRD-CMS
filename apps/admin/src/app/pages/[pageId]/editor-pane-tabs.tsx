import type { EditorPane as Pane } from './editor-types.ts'
import foundationStyles from './editor-foundation.module.css'

const PANES: readonly { id: Pane; label: string }[] = [
  { id: 'tree', label: 'Structure' },
  { id: 'canvas', label: 'Page' },
  { id: 'inspector', label: 'Edit' },
] as const

/** Switch between Structure, Page and Edit with a keyboard or pointer. */
export function EditorPaneTabs({
  originalDesign,
  libraryOpen,
  pane,
  setPane,
}: {
  originalDesign?: boolean
  libraryOpen: boolean
  pane: Pane
  setPane: (pane: Pane) => void
}) {
  return (
    <div
      className={'pane-tabs' + (!originalDesign ? ' ' + foundationStyles.nativePaneTabs : '')}
      role="tablist"
      aria-label="Editor panes"
    >
      {(libraryOpen ? [...PANES, { id: 'library' as const, label: 'Sections' }] : PANES).map(
        (option, index, visiblePanes) => (
          <button
            key={option.id}
            id={`editor-tab-${option.id}`}
            type="button"
            role="tab"
            aria-selected={pane === option.id}
            aria-controls={`editor-panel-${option.id}`}
            tabIndex={pane === option.id ? 0 : -1}
            className={pane === option.id ? 'on' : ''}
            onKeyDown={event => {
              let next = index
              if (event.key === 'ArrowRight') next = (index + 1) % visiblePanes.length
              else if (event.key === 'ArrowLeft') next = (index - 1 + visiblePanes.length) % visiblePanes.length
              else if (event.key === 'Home') next = 0
              else if (event.key === 'End') next = visiblePanes.length - 1
              else return
              event.preventDefault()
              const target = visiblePanes[next]!
              setPane(target.id)
              document.getElementById(`editor-tab-${target.id}`)?.focus()
            }}
            onClick={() => setPane(option.id)}
          >
            {option.label}
          </button>
        ),
      )}
    </div>
  )
}
