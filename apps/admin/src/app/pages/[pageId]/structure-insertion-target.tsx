import type { Dispatch, DragEvent, SetStateAction } from 'react'
import { DropIndicator } from '../../../components/ui/drop-indicator.tsx'
import type { useReorderableList } from '../../../components/ui/use-reorderable-list.ts'
import { IconPlus } from '../../../components/icons.tsx'

export const structureGapKey = (at: number) => 'gap:' + at

export function StructureInsertionTarget({
  at,
  label,
  reorder,
  dropAt,
  setDropAt,
  onAdd,
  onDropLibrary,
}: {
  at: number
  label: string
  reorder: ReturnType<typeof useReorderableList<{ from: number; to: number }>>
  dropAt: number | null
  setDropAt: Dispatch<SetStateAction<number | null>>
  onAdd: (at: number) => void
  onDropLibrary: (definitionId: string, at: number) => void
}) {
  const target = reorder.row(structureGapKey(at), false, false)
  const isLibrary = (event: DragEvent) => event.dataTransfer.types.includes('application/x-cms-section')
  return (
    <li
      className={`tree-gap ${dropAt === at || reorder.marker?.row === structureGapKey(at) ? 'drop-active' : ''}`}
      {...target}
      onDragOver={event => {
        if (!isLibrary(event)) return target.onDragOver(event)
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropAt(at)
      }}
      onDragLeave={event => {
        target.onDragLeave(event)
        setDropAt(current => (current === at ? null : current))
      }}
      onDrop={event => {
        if (!isLibrary(event)) return target.onDrop(event)
        event.preventDefault()
        setDropAt(null)
        const sectionDefId = event.dataTransfer.getData('application/x-cms-section')
        if (sectionDefId) onDropLibrary(sectionDefId, at)
      }}
    >
      <DropIndicator marker={reorder.marker} row={structureGapKey(at)} />
      <button type="button" aria-label={label} onClick={() => onAdd(at)}>
        <span>
          <IconPlus size={11} /> Add here
        </span>
      </button>
    </li>
  )
}
