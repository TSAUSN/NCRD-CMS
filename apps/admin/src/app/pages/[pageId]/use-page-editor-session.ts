import { useEditorInitialField } from './use-editor-initial-field.ts'
import { useSectionUpdateDialogs } from './editor-section-update-dialogs.tsx'
import { useEditorCanvasSession } from './use-editor-canvas-session.ts'
import { useEditorPanels } from './use-editor-panels.ts'
import { useEditorLiveRestoreState } from './editor-live-restore.tsx'
import { useSectionLibraryState } from './library-commands.ts'
import type { SaveSnapshot } from './use-draft-save.ts'
import { useEditorDraftSession } from './use-editor-draft-session.ts'
import { useEditorReviewState } from './use-editor-review-state.ts'
import type { PageEditorProps, EditorPane as Pane } from './editor-types.ts'
import { useEditorViewportState } from './use-editor-viewport-state.ts'
import { useEditorSiteFrameState } from './editor-site-frame-state.ts'
import type { SectionToolSource } from '../../../lib/section-tools-commands.ts'
import { useRouter } from 'next/navigation'
import { preservesSharedChapterParts } from '../../../lib/chapter-section-locks.ts'
import { useEditorSectionClipboard } from './use-editor-section-clipboard.ts'
import { useCallback, useRef, useState } from 'react'
import {
  createEditorState,
  createSaveQueue,
  isDirty,
  setSelection,
  type EditorState,
  type SaveQueue,
} from '@cms/domain'
import { type ActionResult } from '../../../lib/action-result.ts'
import { type SitePreviewContext } from '../../../lib/preview-context.ts'
import { editorSectionRules } from './editor-section-rules.ts'
function usePageDraftState(props: PageEditorProps) {
  const [state, updateState] = useState<EditorState>(() =>
    setSelection(
      createEditorState({
        ...props.document,
        identity: { title: props.title, address: props.metadataContext.path?.replace(/^\//, '') ?? '' },
      }),
      {
        section: props.initialSettings ? null : (props.initialSection ?? null),
        slot: props.initialSettings
          ? null
          : props.initialField &&
              typeof props.initialSection === 'number' &&
              Object.hasOwn(props.document.sections[props.initialSection]?.values ?? {}, props.initialField)
            ? props.initialField
            : null,
      },
    ),
  )
  const openingSnapshot = useRef<SaveSnapshot | null>(null)
  if (!openingSnapshot.current)
    openingSnapshot.current = { document: structuredClone(state.document), sectionOrigins: [...state.sectionOrigins] }
  const setState = useCallback(
    (update: EditorState | ((current: EditorState) => EditorState)) => {
      updateState(current => {
        const next = typeof update === 'function' ? update(current) : update
        return props.lockChapterShared && !preservesSharedChapterParts(props.document.sections, next.document.sections)
          ? setSelection(current, next.selection)
          : next
      })
    },
    [props.lockChapterShared, props.document.sections],
  )
  const [revision, setRevision] = useState(props.revision)
  /**
   * One request at a time, each using the revision the previous one returned.
   * Two concurrent saves would necessarily send the same revision, and the
   * second would come back as a conflict the person did not cause.
   */
  const queue = useRef<SaveQueue<SaveSnapshot>>(undefined as never)
  if (!queue.current) queue.current = createSaveQueue<SaveSnapshot>(props.revision)
  return { state, setState, openingSnapshot, revision, setRevision, queue }
}

export function usePageEditorSession(props: PageEditorProps) {
  const router = useRouter()
  const scheduleFlight = useRef(false)
  const scheduleRequest = useRef<{ signature: string; id: string } | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleFirstReview, setScheduleFirstReview] = useState(false)
  const { state, setState, openingSnapshot, revision, setRevision, queue } = usePageDraftState(props)
  const sectionRules = editorSectionRules(props)
  const { sectionLocked } = sectionRules
  function closeSharedPanel() {
    setState(current => setSelection(current, { section: null, slot: null }))
    setPane('canvas')
  }
  const viewportState = useEditorViewportState()
  const { viewport, focusCanvas, setFocusCanvas } = viewportState
  const clipboard = useEditorSectionClipboard(props)
  const [pageDanger, setPageDanger] = useState<'unpublish' | 'archive' | null>(null)
  const siteFrame = useEditorSiteFrameState()
  const { siteWide, setSiteWide, setMenuEdit, setMenuMove, siteWideCurrent } = siteFrame
  const [listSelection, setListSelection] = useState<{
    section: number
    readerKey: string
    stableKey: string
    field: string
  } | null>(null)
  const [inlineList, setInlineList] = useState<{ readerKey: string; stableKey?: string; unit: string } | null>(null)
  const restore = useEditorLiveRestoreState()
  const { discardConfirmation, sectionConfirmation } = restore
  const [pageSettingsOpen, setPageSettingsOpen] = useState(props.initialSettings === true)
  const [showHiddenSections, setShowHiddenSections] = useState(true)
  const [sitePreview, setSitePreview] = useState<SitePreviewContext>(props.initialSitePreview ?? 'published')
  const [pane, setPane] = useState<Pane>(
    props.initialSettings || typeof props.initialSection === 'number' ? 'inspector' : 'canvas',
  )
  useEditorInitialField(props)

  const [result, setResult] = useState<ActionResult | null>(null)
  const [requiresReload, setRequiresReload] = useState(false)
  const libraryState = useSectionLibraryState()
  const { libraryOpen, setLibraryOpen, libraryPreview, libraryStage, insertAt, recipeDefinitions } = libraryState

  const panels = useEditorPanels(props.originalDesign, libraryOpen, state.selection)
  const [sectionTool, setSectionTool] = useState<{
    kind: 'link' | 'copy'
    index: number
    source: SectionToolSource | null
  } | null>(null)
  const [saving, setSaving] = useState(false)
  /** An explicit Save draft waiting for its own acknowledgement. Autosave does
   * not disable the button: a click while one runs queues behind it, rather
   * than landing on a button that turned disabled under the pointer. */
  const [checkpointing, setCheckpointing] = useState(false)
  const sectionUpdates = useSectionUpdateDialogs()
  const { upgrade, layoutChooser, replacement, fieldUpdate, replacementDefinitions } = sectionUpdates
  const reviewState = useEditorReviewState(props, state.document.sections, scheduleFlight, setScheduling)
  const { setApprovedVersionId } = reviewState.publication
  const { reviewFlight, setReview } = reviewState.review
  const { overrideOpen } = reviewState.override
  const { submitOpen } = reviewState.submission
  const { transitionPending } = reviewState.transition
  const canvasSession = useEditorCanvasSession({
    ...viewportState,
    props,
    state,
    sitePreview,
    setSitePreview,
    showHiddenSections,
  })
  const {
    frame: { canvasRef, canvasReady },
    geometry: { previewScale },
    document: { savedVersionId, needsRender, canvasRefreshBlocked },
    interaction: {
      isolated,
      isolatedCurrent,
      canvasHistoryBlocked,
      dropOnCanvas,
      setRemoteHover,
      setRemoteRichState,
      setRemoteRichUnavailable,
      remoteActions,
      richTextRequest,
      setRichTextRequest,
    },
  } = canvasSession
  const dirty = isDirty(state)
  const currentEditor = useRef(state)
  currentEditor.current = state
  const draft = {
    props,
    state,
    setState,
    currentEditor,
    openingSnapshot,
    dirty,
    queue,
    savedVersionId,
    revision,
    setRevision,
    result,
    setResult,
  }
  const {
    recovery,
    limitedHistory,
    catalog,
    canvasBridge,
    saveSession,
    withCanvasValues,
    changeHistory,
    openAfterPageAction,
  } = useEditorDraftSession({
    draft,
    lifecycle: { saving, transitionPending, upgrade, replacement, overrideOpen, submitOpen },
    navigation: {
      reviewFlight,
      scheduleFlight,
      canvasHistoryBlocked,
      pageDanger,
      siteWide,
      inlineList,
      layoutChooser,
      sectionConfirmation,
      discardConfirmation,
      fieldUpdate,
    },
    definitions: { recipeDefinitions, replacementDefinitions },
    bridge: {
      frame: { ...canvasSession.frame, ...canvasSession.document, isolated, isolatedCurrent, remoteActions },
      document: {
        ...canvasSession.document,
        currentEditor,
        setState,
        canvasHistoryBlocked,
        sectionLocked,
        state,
        libraryStage,
        libraryPreview,
        insertAt,
        richTextRequest,
        setRichTextRequest,
      },
      selection: { props, siteWideCurrent, setSiteWide, setMenuEdit, setMenuMove, setListSelection, setPane },
      editing: {
        libraryStage,
        setLibraryOpen,
        dropOnCanvas,
        setRichTextRequest,
        setRemoteHover,
        setRemoteRichState,
        setRemoteRichUnavailable,
      },
      view: { viewport, previewScale, siteWide, focusCanvas, setFocusCanvas },
    },
    protection: { props, isolated, canvasReady, canvasRef, sectionLocked, setState, setPane },
    shortcut: { libraryStage, sectionTool, siteWideCurrent },
    persistence: { setSaving, setApprovedVersionId, setReview, requiresReload, setRequiresReload, sectionTool },
    canvas: { needsRender, isolatedCurrent, canvasRefreshBlocked },
    clearRichText: () => setRichTextRequest(null),
  })
  return {
    router,
    draft,
    sectionRules,
    siteFrame,
    restore,
    libraryState,
    panels,
    sectionUpdates,
    reviewState,
    canvasSession,
    viewportState,
    clipboard,
    catalog,
    canvasBridge,
    saveSession,
    view: { sitePreview, showHiddenSections, setShowHiddenSections },
    selection: { pageSettingsOpen, setPageSettingsOpen, pane, setPane, closeSharedPanel },
    sectionTools: { sectionTool, setSectionTool },
    persistence: {
      recovery,
      limitedHistory,
      withCanvasValues,
      changeHistory,
      openAfterPageAction,
      saving,
      checkpointing,
      setCheckpointing,
      requiresReload,
    },
    scheduling: {
      scheduleFlight,
      scheduleRequest,
      scheduling,
      setScheduling,
      scheduleFirstReview,
      setScheduleFirstReview,
    },
    pageActions: { pageDanger, setPageDanger },
    list: { listSelection, setListSelection, inlineList, setInlineList },
  }
}
export type PageEditorSession = ReturnType<typeof usePageEditorSession>
