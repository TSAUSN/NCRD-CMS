import type { Dispatch, SetStateAction } from 'react'
import {
  addSection,
  captureSectionInsertionPoint,
  duplicateSection,
  moveSection,
  resolveSectionInsertionPoint,
  setSelection,
  toggleHidden,
  type EditorState,
  type SaveQueue,
} from '@cms/domain'
import { validSectionAnchor } from '@cms/schema'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import { clipboardKey, type SectionClipboard } from '../../../lib/section-clipboard.ts'
import type { SectionToolSource } from '../../../lib/section-tools-commands.ts'
import type { CanvasAction } from './canvas-chrome.tsx'
import type { EditorPane, PageEditorProps } from './editor-types.ts'
import { copiedSectionLayout } from './page-copy-actions.ts'
import { saveSectionLink } from './section-tools-actions.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type SectionTool = { kind: 'link' | 'copy'; index: number; source: SectionToolSource | null }

type Inputs = {
  draft: {
    props: Pick<
      PageEditorProps,
      'pageId' | 'siteId' | 'userId' | 'originalDesign' | 'sitePublicOrigin' | 'metadataContext' | 'liveSections'
    >
    state: EditorState
    setState: Set<EditorState>
    currentEditor: Current<EditorState>
    queue: Current<SaveQueue<SaveSnapshot>>
    savedVersionId: Current<string | null>
    revision: number
    setRevision: Set<number>
    setApprovedVersionId: Set<string | null>
    setResult: Set<ActionResult | null>
    flushForReview: () => Promise<boolean>
  }
  sections: {
    canManageSections: boolean
    sectionLocked: (index: number | null) => boolean
    sectionTool: SectionTool | null
    setSectionTool: Set<SectionTool | null>
    setPane: Set<EditorPane>
    openLayoutChoice: (index: number) => void
    setLiveSourceIndex: Set<number>
    setSectionConfirmation: Set<{ origin: string; action: 'delete' | 'reset' } | null>
    canvasOperations: Current<{ section: (action: CanvasAction, index: number) => void } | null>
    withCanvasValues: (action: () => void | Promise<void>) => Promise<void>
  }
  clipboard: {
    copiedSection: SectionClipboard | null
    setCopiedSection: Set<SectionClipboard | null>
    pasting: boolean
    setPasting: Set<boolean>
    insertAt: number | null
    setReplacementDefinitions: Set<LibraryEntry[]>
    setLibraryOpen: Set<boolean>
  }
}

/** Manage section changes initiated from the canvas or section library. */
export function sectionTools({ draft, sections, clipboard }: Inputs) {
  const {
    props,
    state,
    setState,
    currentEditor,
    queue,
    savedVersionId,
    revision,
    setRevision,
    setApprovedVersionId,
    setResult,
    flushForReview,
  } = draft
  const {
    canManageSections,
    sectionLocked,
    sectionTool,
    setSectionTool,
    setPane,
    openLayoutChoice,
    setLiveSourceIndex,
    setSectionConfirmation,
    canvasOperations,
    withCanvasValues,
  } = sections
  const { copiedSection, setCopiedSection, pasting, setPasting, insertAt, setReplacementDefinitions, setLibraryOpen } =
    clipboard
  async function openSectionTool(kind: 'link' | 'copy', index: number) {
    if (!canManageSections || props.originalDesign || sectionLocked(index) || sectionTool) return
    setSectionTool({ kind, index, source: null })
    setPane('inspector')
    try {
      if (!(await flushForReview()) || !savedVersionId.current) {
        setSectionTool(null)
        setResult({
          ok: false,
          kind: 'error',
          message: 'Save the current page successfully before opening this section step.',
        })
        return
      }
      setSectionTool({
        kind,
        index,
        source: {
          pageId: props.pageId,
          versionId: savedVersionId.current,
          revision: String(queue.current.revision()),
          index,
        },
      })
    } catch {
      setSectionTool(null)
      setResult({
        ok: false,
        kind: 'error',
        message: 'This section step could not be opened. Your page edits are still here.',
      })
    }
  }
  async function applySectionLink(input: SectionToolSource & { name: string; fingerprint: string }) {
    let result: Awaited<ReturnType<typeof saveSectionLink>> | undefined
    await queue.current.enqueue({
      snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
      run: async currentRevision => {
        result = await saveSectionLink({ ...input, revision: String(currentRevision) })
        if (result.ok) {
          savedVersionId.current = result.versionId
          setRevision(result.revision)
          setApprovedVersionId(null)
          return { ok: true, revision: result.revision }
        }
        return { ok: false, conflict: result.kind === 'conflict' }
      },
    })
    return (
      result ?? {
        ok: false as const,
        kind: 'error' as const,
        message: 'The result could not be confirmed. Reload the page before trying again.',
      }
    )
  }
  function closeSectionTool(reload = false) {
    const index = sectionTool?.index
    if (reload && index !== undefined) {
      window.location.assign('/pages/' + props.pageId + '?section=' + index)
      return
    }
    setSectionTool(null)
  }
  function canvasAction(action: CanvasAction, index: number) {
    if (action === 'link-copy' && !props.originalDesign && canManageSections) {
      const anchor = currentEditor.current.document.sections[index]?.values.__cms_anchor
      const identity = currentEditor.current.document.identity
      const path = identity ? (identity.address ? '/' + identity.address : '/') : props.metadataContext.path
      if (validSectionAnchor(anchor) && props.sitePublicOrigin && navigator.clipboard) {
        void navigator.clipboard
          .writeText(props.sitePublicOrigin + path + '#' + anchor)
          .then(() =>
            setResult({
              ok: true,
              revision,
              versionId: savedVersionId.current,
              message: 'Section link copied. Publish any changes before sharing it.',
            }),
          )
          .catch(() => void openSectionTool('link', index))
        return
      }
    }
    void withCanvasValues(() => canvasOperations.current?.section(action, index))
  }
  function applyCanvasAction(action: CanvasAction, index: number) {
    if (!canManageSections || sectionLocked(index)) return
    if (!state.document.sections[index]) return
    if (action === 'link-copy' || action === 'link-name') {
      void openSectionTool('link', index)
      return
    }
    if (action === 'send') {
      void openSectionTool('copy', index)
      return
    }
    if (action === 'copy') {
      const copy = {
        userId: props.userId,
        siteId: props.siteId,
        copiedAt: Date.now(),
        section: structuredClone(state.document.sections[index]!),
      }
      setCopiedSection(copy)
      try {
        localStorage.setItem(clipboardKey(props.userId, props.siteId), JSON.stringify(copy))
      } catch {
        /* Keep the copy in this session. */
      }
      setResult({
        ok: true,
        revision,
        versionId: savedVersionId.current,
        message: 'Section copied in this browser. Choose an insertion point, then Paste copied section.',
      })
      return
    }
    if (action === 'layout') {
      openLayoutChoice(index)
      return
    }
    if (action === 'delete' || action === 'reset') {
      setLiveSourceIndex(
        Math.max(
          0,
          props.liveSections.findIndex(
            section =>
              section.section_def_id === state.document.sections[index]!.section_def_id &&
              section.label === state.document.sections[index]!.label,
          ),
        ),
      )
      setSectionConfirmation({ origin: state.sectionOrigins[index]!, action })
      return
    }
    setState(current =>
      action === 'duplicate'
        ? duplicateSection(current, index)
        : action === 'hide'
          ? toggleHidden(current, index)
          : setSelection(moveSection(current, index, index + (action === 'up' ? -1 : 1)), {
              section: index + (action === 'up' ? -1 : 1),
              slot: null,
            }),
    )
  }
  async function pasteSection() {
    if (!copiedSection || pasting) return
    const gap = captureSectionInsertionPoint(
      currentEditor.current,
      insertAt ?? currentEditor.current.document.sections.length,
    )
    setPasting(true)
    try {
      const section = copiedSection.section
      const definition = await copiedSectionLayout(props.pageId, section.section_def_id, section.section_def_version)
      if (!definition) {
        setResult({ ok: false, kind: 'error', message: 'The copied layout is unavailable on this site.' })
        return
      }
      const at = resolveSectionInsertionPoint(currentEditor.current, gap)
      if (at === null) {
        setResult({ ok: false, kind: 'error', message: 'This insertion point changed. Choose where to paste again.' })
        return
      }
      setReplacementDefinitions(previous => [...previous, definition])
      setState(current => setSelection(addSection(current, section, at), { section: at, slot: null }))
      setLibraryOpen(false)
      setPane('inspector')
    } catch {
      setResult({ ok: false, kind: 'error', message: 'The copied section could not be loaded. Try pasting again.' })
    } finally {
      setPasting(false)
    }
  }
  return { openSectionTool, applySectionLink, closeSectionTool, canvasAction, applyCanvasAction, pasteSection }
}
