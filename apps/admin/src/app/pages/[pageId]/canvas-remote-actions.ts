import type { Dispatch, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { setValue, type EditorDocument, type EditorState } from '@cms/domain'
import { repeatItemKeys, repeatItemSpec, type FieldLike } from '@cms/schema'
import { COMMAND_SEARCH_EVENT } from '../../../lib/command-search-model.ts'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { withCanvasValue } from './canvas-sync.ts'
import type { CanvasAction, CanvasHover } from './canvas-chrome.tsx'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import { isRichTextToolbarState, type RichTextToolbarState } from './rich-text-commands.ts'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type RepeatAction = 'add' | 'up' | 'down' | 'duplicate' | 'delete'
type ListAction = 'edit' | 'hide' | 'up' | 'down'

type Inputs = {
  document: {
    state: EditorState
    setState: Set<EditorState>
    shown: Current<EditorDocument>
    slotsByDef: ReadonlyMap<string, LibraryEntry>
    canvasHistoryBlocked: Current<boolean>
    canvasRefreshBlocked: Current<boolean>
  }
  frame: {
    siteWide: { part: 'header' | 'footer'; editing: boolean } | null
    setCanvasMenuPage: Set<{ id: string; sequence: number } | null>
    setCanvasFramePending: Set<boolean>
    setFocusCanvas: Set<boolean>
  }
  editing: {
    activeRichText: CanvasRichTextRequest | null
    setRemoteRichState: Set<RichTextToolbarState | null>
    setRemoteRichUnavailable: Set<boolean>
    setRemoteHover: Set<CanvasHover | null>
    openLibrary: (at: number) => void
    canvasAction: (action: CanvasAction, index: number) => void
    canvasRepeat: (index: number, slot: FieldLike, action: RepeatAction, key?: string) => void
    setInlineList: Set<{ readerKey: string; stableKey?: string; unit: string } | null>
    listAction: (action: ListAction, renderedKeys?: string[]) => void
  }
}

/** Handle the isolated frame’s editing commands after the message boundary checks. */
export function canvasRemoteActions({ document: editorDocument, frame, editing }: Inputs) {
  const { state, setState, shown, slotsByDef, canvasHistoryBlocked, canvasRefreshBlocked } = editorDocument
  const { siteWide, setCanvasMenuPage, setCanvasFramePending, setFocusCanvas } = frame
  const {
    activeRichText,
    setRemoteRichState,
    setRemoteRichUnavailable,
    setRemoteHover,
    openLibrary,
    canvasAction,
    canvasRepeat,
    setInlineList,
    listAction,
  } = editing
  return (data: Record<string, unknown>) => {
    if (
      ![
        'cms:command-search',
        'cms:add-menu-page',
        'cms:exit-focus',
        'cms:frame-editing',
        'cms:rich-state',
        'cms:rich-unavailable',
        'cms:rich-value',
        'cms:hover-card',
        'cms:add-section',
        'cms:section-action',
        'cms:repeat-action',
        'cms:add-list-item',
        'cms:list-action',
      ].includes(String(data['type']))
    )
      return false
    const index = data['section']
    const validIndex =
      typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < state.document.sections.length
    if (data['type'] === 'cms:add-menu-page') {
      if (
        siteWide?.editing &&
        siteWide.part === 'header' &&
        typeof data['id'] === 'string' &&
        /^[0-9a-f-]{36}$/.test(data['id'])
      )
        setCanvasMenuPage(previous => ({ id: data['id'] as string, sequence: (previous?.sequence ?? 0) + 1 }))
      return true
    }
    if (data['type'] === 'cms:command-search') {
      window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))
      return true
    }
    if (data['type'] === 'cms:exit-focus') {
      setFocusCanvas(false)
      return true
    }
    if (data['type'] === 'cms:frame-editing') {
      if (siteWide?.editing && data['part'] === siteWide.part) setCanvasFramePending(false)
      return true
    }
    if (data['type'] === 'cms:rich-state') {
      const field = data['field'] as { section?: unknown; slot?: unknown } | null
      if (
        activeRichText &&
        field?.section === activeRichText.section &&
        field?.slot === activeRichText.slot &&
        isRichTextToolbarState(data['active'])
      ) {
        setRemoteRichState(data['active'])
        setRemoteRichUnavailable(false)
      }
      return true
    }
    if (data['type'] === 'cms:rich-unavailable') {
      if (activeRichText && index === activeRichText.section && data['slot'] === activeRichText.slot)
        setRemoteRichUnavailable(true)
      return true
    }
    if (data['type'] === 'cms:rich-value') {
      if (
        activeRichText &&
        index === activeRichText.section &&
        data['slot'] === activeRichText.slot &&
        typeof data['value'] === 'string' &&
        data['value'].length <= 1_048_576 &&
        !canvasHistoryBlocked.current
      ) {
        const value = data['value']
        shown.current = withCanvasValue(shown.current, index as number, activeRichText.slot, value)
        flushSync(() => setState(current => setValue(current, index as number, activeRichText.slot, value)))
      }
      return true
    }
    if (data['type'] === 'cms:hover-card') {
      const item = data['item'] as CanvasHover | null
      if (item === null) setRemoteHover(null)
      else if (
        item &&
        Number.isSafeInteger(item.section) &&
        typeof item.repeatId === 'string' &&
        typeof item.key === 'string' &&
        repeatItemKeys(state.document.sections[item.section]?.values[item.repeatId]).includes(item.key)
      )
        setRemoteHover(item)
      return true
    }
    if (canvasHistoryBlocked.current || canvasRefreshBlocked.current) return true
    if (
      data['type'] === 'cms:add-section' &&
      Number.isSafeInteger(data['at']) &&
      Number(data['at']) >= 0 &&
      Number(data['at']) <= state.document.sections.length
    ) {
      openLibrary(Number(data['at']))
      return true
    }
    if (
      data['type'] === 'cms:section-action' &&
      validIndex &&
      [
        'up',
        'down',
        'duplicate',
        'hide',
        'layout',
        'reset',
        'delete',
        'copy',
        'link-copy',
        'link-name',
        'send',
      ].includes(String(data['action']))
    ) {
      canvasAction(data['action'] as CanvasAction, index)
      return true
    }
    if (
      data['type'] === 'cms:repeat-action' &&
      validIndex &&
      typeof data['field'] === 'string' &&
      ['add', 'up', 'down', 'duplicate', 'delete'].includes(String(data['action']))
    ) {
      const section = state.document.sections[index]!
      const field = slotsByDef
        .get(sectionVersionKey(section.section_def_id, section.section_def_version))
        ?.slots.find(field => field.id === data['field'])
      if (
        field &&
        repeatItemSpec(field) &&
        (data['key'] === undefined ||
          (typeof data['key'] === 'string' && repeatItemKeys(section.values[field.id]).includes(data['key'])))
      )
        canvasRepeat(
          index,
          field,
          data['action'] as 'add' | 'up' | 'down' | 'duplicate' | 'delete',
          data['key'] as string | undefined,
        )
      return true
    }
    if (
      data['type'] === 'cms:add-list-item' &&
      typeof data['readerKey'] === 'string' &&
      state.document.sections.some(section =>
        Object.values(section.values).some(
          value => value && typeof value === 'object' && 'readerKey' in value && value.readerKey === data['readerKey'],
        ),
      )
    ) {
      setInlineList({ readerKey: data['readerKey'], unit: listUnit(data['readerKey']) })
      return true
    }
    if (
      data['type'] === 'cms:list-action' &&
      ['edit', 'hide', 'up', 'down'].includes(String(data['action'])) &&
      Array.isArray(data['keys']) &&
      data['keys'].length <= 1000 &&
      data['keys'].every(key => typeof key === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) &&
      new Set(data['keys']).size === data['keys'].length
    ) {
      listAction(data['action'] as 'edit' | 'hide' | 'up' | 'down', data['keys'])
      return true
    }
    return false
  }
}
