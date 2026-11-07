import type { Dispatch, RefObject, SetStateAction } from 'react'
import { setSectionValues, setSelection, setValue, type EditorSection, type EditorState } from '@cms/domain'
import {
  moveRepeatItem,
  preserveNationalTileLayout,
  removeRepeatItem,
  repeatItemSlotId,
  repeatItemSpec,
  type FieldLike,
} from '@cms/schema'
import { addEditorRepeatItem } from '../../../lib/editor-repeat-item.ts'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'

type ListSelection = { section: number; readerKey: string; stableKey: string; field: string }
type Repeat = (
  index: number,
  slot: FieldLike,
  action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
  key?: string,
) => void
type Inputs = {
  draft: { setState: Dispatch<SetStateAction<EditorState>>; slotsByDef: ReadonlyMap<string, LibraryEntry> }
  frame: {
    isolated: { enabled: boolean }
    canvasRef: RefObject<HTMLIFrameElement | null>
    toCanvas: (message: Record<string, unknown>) => void
    canvasOperations: { current: { repeat: Repeat } | null }
    withCanvasValues: (action: () => void | Promise<void>) => Promise<void>
  }
  selection: {
    listSelection: ListSelection | null
    setListSelection: Dispatch<SetStateAction<ListSelection | null>>
    setInlineList: Dispatch<SetStateAction<{ readerKey: string; stableKey?: string; unit: string } | null>>
  }
}

/** Translate a canvas list or repeated-field action into a draft edit. */
export function canvasCollectionCommands({ draft, frame, selection }: Inputs) {
  const { setState, slotsByDef } = draft
  const { isolated, canvasRef, toCanvas, canvasOperations, withCanvasValues } = frame
  const { listSelection, setListSelection, setInlineList } = selection
  function listAction(action: 'edit' | 'hide' | 'up' | 'down', renderedKeys?: string[]) {
    if (!listSelection) return
    if (action === 'edit') {
      setInlineList({
        readerKey: listSelection.readerKey,
        stableKey: listSelection.stableKey,
        unit: listUnit(listSelection.readerKey),
      })
      return
    }
    if (isolated.enabled && !renderedKeys) {
      toCanvas({ type: 'cms:list-action-request', action })
      return
    }
    const nodes = isolated.enabled
      ? []
      : (canvasRef.current?.contentDocument?.querySelectorAll<HTMLElement>(
          '[data-cms-section="' + listSelection.section + '"] [data-cms-entry]',
        ) ?? [])
    const keys = renderedKeys
      ? [...renderedKeys]
      : [...nodes]
          .filter(
            node =>
              node.dataset.cmsReader === listSelection.readerKey && node.dataset.cmsListField === listSelection.field,
          )
          .map(node => node.dataset.cmsEntry!)
    const index = keys.indexOf(listSelection.stableKey)
    if (index < 0) return
    if (action === 'hide') keys.splice(index, 1)
    else {
      const to = index + (action === 'up' ? -1 : 1)
      if (to < 0 || to >= keys.length) return
      ;[keys[index], keys[to]] = [keys[to]!, keys[index]!]
    }
    setState(current =>
      setValue(current, listSelection.section, listSelection.field, {
        readerKey: listSelection.readerKey,
        selection: { mode: 'manual', stableKeys: keys },
      }),
    )
    if (action === 'hide') setListSelection(null)
  }
  function canvasRepeat(
    index: number,
    slot: FieldLike,
    action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
    key?: string,
  ) {
    void withCanvasValues(() => canvasOperations.current?.repeat(index, slot, action, key))
  }
  function repeatValues(section: EditorSection, next: Record<string, unknown>) {
    return preserveNationalTileLayout(
      slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slug,
      section.values,
      next,
    )
  }
  function applyCanvasRepeat(
    index: number,
    slot: FieldLike,
    action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
    key?: string,
  ) {
    setState(current => {
      const spec = repeatItemSpec(slot)
      if (!current.document.sections[index] || !spec) return current
      const values = current.document.sections[index]!.values
      if (action === 'add' || action === 'duplicate') {
        const added = addEditorRepeatItem(values, slot, action === 'duplicate' && key ? { from: key, after: key } : {})
        const updated = setSectionValues(current, index, repeatValues(current.document.sections[index]!, added.values))
        return added.key && spec.fields[0]
          ? setSelection(updated, { section: index, slot: repeatItemSlotId(slot.id, added.key, spec.fields[0].id) })
          : updated
      }
      if (!key) return current
      return setSectionValues(
        current,
        index,
        repeatValues(
          current.document.sections[index]!,
          action === 'delete'
            ? removeRepeatItem(values, slot, key)
            : moveRepeatItem(values, slot, key, action === 'up' ? -1 : 1),
        ),
      )
    })
  }

  return { listAction, canvasRepeat, repeatValues, applyCanvasRepeat }
}
