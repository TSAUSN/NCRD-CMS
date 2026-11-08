import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { setSelection, type EditorState } from '@cms/domain'
import { isManagedChapterJumpLinks, isSharedChapterPart } from '../../../lib/chapter-section-locks.ts'
import type { PageEditorProps } from './editor-types.ts'

/** Limits moves and insertions around the shared part of a chapter page. */
export function editorSectionRules(props: PageEditorProps) {
  const sectionLocked = (index: number | null) =>
    Boolean(
      index !== null &&
      ((props.lockChapterShared && isSharedChapterPart(props.document.sections[index])) ||
        (props.chapterPage && isManagedChapterJumpLinks(props.document.sections[index], props.pinnedSections))),
    )
  const lastShared = props.lockChapterShared
    ? props.document.sections.reduce((last, section, index) => (isSharedChapterPart(section) ? index : last), -1)
    : -1
  const canManageSections = props.originalDesign || props.canAdvanced
  const canInsertAt = (index: number) => canManageSections && index > lastShared
  const canMoveSection = (from: number, to: number) =>
    canManageSections &&
    !Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => Math.min(from, to) + index).some(sectionLocked)
  return { sectionLocked, canManageSections, canInsertAt, canMoveSection }
}

/** The non-isolated preview handles blocked edits before its own input handlers. */
export function useCanvasSectionProtection({
  props,
  isolated,
  canvasReady,
  canvasRef,
  sectionLocked,
  setState,
  setPane,
}: {
  props: Pick<PageEditorProps, 'lockChapterShared'>
  isolated: { enabled: boolean }
  canvasReady: number
  canvasRef: { current: HTMLIFrameElement | null }
  sectionLocked: (index: number | null) => boolean
  setState: Dispatch<SetStateAction<EditorState>>
  setPane: Dispatch<SetStateAction<import('./editor-types.ts').EditorPane>>
}) {
  useEffect(() => {
    if (!props.lockChapterShared || isolated.enabled || !canvasReady) return
    const doc = canvasRef.current?.contentDocument
    if (!doc) return
    const protect = (event: Event) => {
      const key = event as KeyboardEvent
      if (
        event.type === 'keydown' &&
        (key.key === 'Tab' || key.key === 'Escape' || key.key.startsWith('Arrow') || key.metaKey || key.ctrlKey)
      )
        return
      const target = event.target as Element,
        root = target.closest?.('[data-cms-section]')
      const index = Number(root?.getAttribute('data-cms-section'))
      if (!root || !sectionLocked(index)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      setState(current => setSelection(current, { section: index, slot: null }))
      setPane('inspector')
    }
    const events = ['click', 'dblclick', 'beforeinput', 'keydown']
    for (const event of events) doc.addEventListener(event, protect, true)
    return () => {
      for (const event of events) doc.removeEventListener(event, protect, true)
    }
  }, [props.lockChapterShared, isolated.enabled, canvasReady, setState])
}
