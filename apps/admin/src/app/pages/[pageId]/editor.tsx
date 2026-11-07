'use client'
import { canvasCollectionCommands } from './canvas-collection-commands.ts'
import { visitorPreview } from './visitor-preview.ts'
import { useEditorInitialField } from './use-editor-initial-field.ts'
import { useEditorCanvasControls } from './use-editor-canvas-controls.ts'
import { useSectionUpdateDialogs } from './editor-section-update-dialogs.tsx'
import { useEditorCanvasSession } from './use-editor-canvas-session.ts'
import { useEditorPanels } from './use-editor-panels.ts'
import { liveRestore, useEditorLiveRestoreState } from './editor-live-restore.tsx'
import { EditorViewTools } from './editor-view-tools.tsx'
import { EditorPaneTabs } from './editor-pane-tabs.tsx'
import { sectionTools } from './section-tools.ts'
import { pageCommands } from './page-commands.ts'
import { libraryCommands, useSectionLibraryState } from './library-commands.ts'
import { canvasRemoteActions } from './canvas-remote-actions.ts'
import { publicationCommands } from './publication-commands.ts'
import { savedReviewCommands } from './saved-review-commands.ts'
import type { SaveSnapshot } from './use-draft-save.ts'
import { useEditorDraftSession } from './use-editor-draft-session.ts'
import { useEditorReviewState } from './use-editor-review-state.ts'
import { sectionReplacementCommands } from './section-replacement-commands.ts'
import { sectionUpdateCommands } from './section-update-commands.ts'
import { EditorCanvas } from './editor-canvas.tsx'
import { EditorStructure } from './editor-structure.tsx'
import type { PageEditorProps, EditorPane as Pane } from './editor-types.ts'
import { useEditorViewportState } from './use-editor-viewport-state.ts'
import { siteFrameInspector, useEditorSiteFrameState } from './editor-site-frame-state.ts'
import { EditorToolbar } from './editor-toolbar.tsx'
import { LargeScreenEditing } from '../../../components/content-editor.tsx'
import type { SectionToolSource } from '../../../lib/section-tools-commands.ts'
import { useRouter } from 'next/navigation'
import { preservesSharedChapterParts } from '../../../lib/chapter-section-locks.ts'
import type { CSSProperties } from 'react'
import panelStyles from './editor-panels.module.css'
import foundationStyles from './editor-foundation.module.css'
import { EditorDialogs } from './editor-dialogs.tsx'
import { EditorInspectorPanel } from './editor-inspector-panel.tsx'
import { useEditorSectionClipboard } from './use-editor-section-clipboard.ts'
import { PageRecoveryPanel } from './page-recovery-panel.tsx'
// Structure, live page preview, and field inspector share one editor state.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  carriesTrustedCode,
  createEditorState,
  createSaveQueue,
  isDirty,
  redo,
  setSelection,
  undo,
  type EditorState,
  type SaveQueue,
} from '@cms/domain'
import { approveTrustedCode } from '../../actions/section-definitions.ts'
import { type ActionResult } from '../../../lib/action-result.ts'
import { Button } from '../../../components/ui/index.ts'

import { hasTrustedSectionTemplate } from '../../../lib/section-version.ts'

/**
 * A library card, as the editor needs it.
 *
 * Re-exported from the query rather than re-declared, and as a *type* export so
 * nothing from a `server-only` module is pulled into the browser bundle. The
 * two used to be separate declarations of the same row and drifted the moment
 * the query learned about thumbnails.
 */
export type { LibraryEntry } from '../../../lib/queries.ts'
import { type SitePreviewContext } from '../../../lib/preview-context.ts'
import { EditorNotices } from './editor-notices.tsx'
import { editorSectionRules } from './editor-section-rules.ts'

export function PageEditor(props: PageEditorProps) {
  const router = useRouter(),
    scheduleFlight = useRef(false),
    scheduleRequest = useRef<{ signature: string; id: string } | null>(null),
    [scheduling, setScheduling] = useState(false),
    [scheduleFirstReview, setScheduleFirstReview] = useState(false)
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
  const sectionRules = editorSectionRules(props)
  const { sectionLocked, canManageSections, canInsertAt } = sectionRules
  function closeSharedPanel() {
    setState(current => setSelection(current, { section: null, slot: null }))
    setPane('canvas')
  }
  const [revision, setRevision] = useState(props.revision)
  /**
   * One request at a time, each using the revision the previous one returned.
   * Two concurrent saves would necessarily send the same revision, and the
   * second would come back as a conflict the person did not cause.
   */
  const queue = useRef<SaveQueue<SaveSnapshot>>(undefined as never)
  if (!queue.current) queue.current = createSaveQueue<SaveSnapshot>(props.revision)
  const viewportState = useEditorViewportState()
  const { viewport, setViewport, setZoom, previewHidden, setPreviewHidden, focusCanvas, setFocusCanvas } = viewportState
  const clipboard = useEditorSectionClipboard(props)
  const pageIdentity = state.document.identity ?? {
    title: props.title,
    address: props.metadataContext.path?.replace(/^\//, '') ?? '',
  }
  const [pageDanger, setPageDanger] = useState<'unpublish' | 'archive' | null>(null)
  const siteFrame = useEditorSiteFrameState()
  const { siteWide, setSiteWide, setMenuEdit, setMenuMove, finishSiteWide, siteWideCurrent } = siteFrame
  const [listSelection, setListSelection] = useState<{
    section: number
    readerKey: string
    stableKey: string
    field: string
  } | null>(null)
  const [inlineList, setInlineList] = useState<{ readerKey: string; stableKey?: string; unit: string } | null>(null)
  const restore = useEditorLiveRestoreState()
  const {
    discardConfirmation,
    setDiscardConfirmation,
    sectionConfirmation,
    setSectionConfirmation,
    setLiveSourceIndex,
  } = restore
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
  const { libraryOpen, setLibraryOpen, libraryPreview, libraryPreparing, libraryStage, insertAt, recipeDefinitions } =
    libraryState

  const panels = useEditorPanels(props.originalDesign, libraryOpen, state.selection)
  const {
    rightWidth,
    structureWidth,
    pendingFieldFocus,
    structureCollapsed,
    rightOverlay,
    libraryOpener,
    returnLibraryFocus,
  } = panels
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
  const {
    upgrade,
    layoutChooser,
    layoutTarget,
    setLayoutTarget,
    replacement,
    fieldUpdate,
    replacementDefinitions,
    setReplacementDefinitions,
  } = sectionUpdates
  const reviewState = useEditorReviewState(props, state.document.sections, scheduleFlight, setScheduling)
  const { publishedVersionId, setPublishedVersionId, approvedVersionId, setApprovedVersionId } = reviewState.publication
  const { reviewFlight, reviewBusy, review, setReview, reviewFeedback } = reviewState.review
  const { overrideOpen, setOverrideOpen } = reviewState.override
  const { submitOpen, setSubmitOpen } = reviewState.submission
  const { transitionPending, startTransition } = reviewState.transition
  const canvasSession = useEditorCanvasSession({
    ...viewportState,
    props,
    state,
    sitePreview,
    setSitePreview,
    showHiddenSections,
  })
  const {
    frame: { canvasRef, setCanvasFramePending, setCanvasSource, canvasReady, setCanvasReady },
    geometry: { previewWidth, previewScale },
    document: { savedVersionId, shown, needsRender, canvasRefreshBlocked },
    interaction: {
      isolated,
      isolatedCurrent,
      canvasHistoryBlocked,
      dropOnCanvas,
      canvasMenuPage,
      setCanvasMenuPage,
      setRemoteHover,
      setRemoteRichState,
      setRemoteRichUnavailable,
      remoteActions,
      canvasOperations,
      changeSitePreview,
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
  const { recovery, limitedHistory, catalog, canvasBridge, saveSession, withCanvasValues, changeHistory } =
    useEditorDraftSession({
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
  const { slotsByDef, slotKind, richTextConstraints, nameOf } = catalog
  const { canvasAwaitingRender, activeRichText, toCanvas, sendCanvasMenu, renderCanvas } = canvasBridge
  const { save, latestSave, flushForReview } = saveSession

  const storedDraft = { ...draft, flushForReview, renderCanvas, latestSave }
  const { openPagePublishReview, confirmPagePublishReview, schedulePageReview } = savedReviewCommands({
    draft: { ...draft, startTransition },
    review: { ...reviewState.review, transitionPending, flushForReview, publish: () => publish() },
    schedule: { scheduleFlight, setScheduling, setScheduleFirstReview, scheduleRequest, router },
  })

  const sectionDraft = {
    ...storedDraft,
    sitePreview,
    setApprovedVersionId,
    setPane,
    setReplacementDefinitions,
    setReview,
  }

  const { reviewSectionUpgrade, applyReviewedUpgrade, reviewFieldUpdate, applyFieldUpdate } = sectionUpdateCommands({
    ...sectionDraft,
    ...sectionUpdates,
  })

  const layoutActions = sectionReplacementCommands({
    ...sectionDraft,
    ...sectionUpdates,
    setFocusCanvas,
    setLibraryOpen,
  })

  const { openLayoutChoice, reviewLayoutChange, remapReplacement, applyLayoutChange } = layoutActions
  const { publish, submitForReview } = publicationCommands({
    draft: { ...draft, startTransition },
    publishState: { ...storedDraft, ...reviewState.publication, ...reviewState.review },
    canvas: { isolatedCurrent, canvasRefreshBlocked, needsRender, renderCanvas, changeSitePreview },
  })

  // ------------------------------------------------------------- rendering

  const selected = state.selection.section
  const selectedSection = selected === null ? null : (state.document.sections[selected] ?? null)
  /** The section whose layout the open library is choosing, if it still exists. */
  const replacingIndex = layoutTarget === null ? -1 : state.sectionOrigins.indexOf(layoutTarget)
  const replacingSection = replacingIndex === -1 ? null : (state.document.sections[replacingIndex] ?? null)
  // A section deleted (or undone away) while the library chooses its layout
  // closes that choice rather than quietly turning it into an insertion.
  useEffect(() => {
    if (layoutTarget !== null && replacingIndex === -1) {
      setLayoutTarget(null)
      setLibraryOpen(false)
    }
  }, [layoutTarget, replacingIndex])
  const readiness = result?.ok === false && result.kind === 'blocked' ? result.report : props.initialReadiness

  // The warning follows the document on screen. Save and publish verify
  // trusted code again on the server.
  const needsReview =
    carriesTrustedCode(state.document) || hasTrustedSectionTemplate(state.document.sections, slotsByDef)
  const approved = !dirty && approvedVersionId !== null && approvedVersionId === savedVersionId.current
  const hasWorkNotLive = dirty || savedVersionId.current !== publishedVersionId
  const submittedCurrent = review !== null && review.versionId === savedVersionId.current && !dirty

  const libraryActions = libraryCommands({
    editor: { props, state, setState, currentEditor, canInsertAt, pendingFieldFocus, setPane },
    library: { ...libraryState, layoutTarget, setLayoutTarget, setFocusCanvas, libraryOpener, returnLibraryFocus },
    preview: {
      isolatedCurrent,
      flushForReview,
      renderCanvas,
      savedVersionId,
      setCanvasSource,
      setCanvasReady,
      setCanvasFramePending,
      setRichTextRequest,
    },
    recipe: libraryState,
  })

  const { openLibrary, placeLibraryEntry, insertPreparedRecipe } = libraryActions
  /** The page's search and sharing settings: nothing selected, settings open. */
  function openPageSettings() {
    setSiteWide(null)
    setState(current => setSelection(current, { section: null, slot: null }))
    setLibraryOpen(false)
    setLayoutTarget(null)
    setFocusCanvas(false)
    setPageSettingsOpen(true)
    setPane('inspector')
  }

  dropOnCanvas.current = placeLibraryEntry

  const openVisitorPreview = visitorPreview({
    props,
    draft: storedDraft,
    canvas: { isolatedCurrent, canvasRefreshBlocked },
    view: { sitePreview, previewHidden },
  })

  const sectionActions = sectionTools({
    draft: { ...storedDraft, setApprovedVersionId },
    sections: {
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
    },
    clipboard: { ...clipboard, insertAt, setReplacementDefinitions, setLibraryOpen },
  })
  const { canvasAction, applyCanvasAction, pasteSection } = sectionActions
  const { duplicateCurrentPage, saveDetails, applyPageDanger } = pageCommands({
    draft: storedDraft,
    lifecycle: { pageDanger, setPageDanger, transitionPending, startTransition, setPublishedVersionId, setReview },
  })
  const applyLiveReset = liveRestore({
    page: { ...storedDraft, publishedVersionId },
    acknowledge: { ...storedDraft, setReplacementDefinitions, setApprovedVersionId, setReview },
    restore,
  })
  const collectionActions = canvasCollectionCommands({
    draft: { setState, slotsByDef },
    frame: { isolated, canvasRef, toCanvas, canvasOperations, withCanvasValues },
    selection: { listSelection, setListSelection, setInlineList },
  })

  const { listAction, canvasRepeat, applyCanvasRepeat } = collectionActions
  useEditorCanvasControls({
    isolated,
    canvasReady,
    state,
    listSelection,
    previewScale,
    slotsByDef,
    nameOf,
    libraryOpen,
    siteWide,
    sectionTool,
    canvasAwaitingRender,
    publishedVersionId,
    props,
    toCanvas,
  })
  canvasOperations.current = { section: applyCanvasAction, repeat: applyCanvasRepeat }
  remoteActions.current = canvasRemoteActions({
    document: { state, setState, shown, slotsByDef, canvasHistoryBlocked, canvasRefreshBlocked },
    frame: { siteWide, setCanvasMenuPage, setCanvasFramePending, setFocusCanvas },
    editing: {
      activeRichText,
      setRemoteRichState,
      setRemoteRichUnavailable,
      setRemoteHover,
      openLibrary,
      canvasAction,
      canvasRepeat,
      setInlineList,
      listAction,
    },
  })

  const previewBreakpoint = previewWidth < 768 ? 'sm' : previewWidth < 1024 ? 'md' : 'lg'
  const visibilityView = { sm: 'phone', md: 'tablet', lg: 'desktop' }[previewBreakpoint]
  const hiddenSectionCount = state.document.sections.filter(
    section => section.hidden || section.hidden_at?.includes(previewBreakpoint),
  ).length

  const viewTools = (
    <EditorViewTools
      state={state}
      editingFrame={siteWide?.editing}
      viewport={viewport}
      changeHistory={changeHistory}
      setViewport={setViewport}
      setZoom={setZoom}
      setPane={setPane}
    />
  )

  function checkpoint() {
    // Like Publish, clear the last notice so the one that follows
    // is this save's, not an earlier one still on screen.
    setResult(null)
    setCheckpointing(true)
    void withCanvasValues(async () => {
      await latestSave.current('checkpoint')
    }).finally(() => setCheckpointing(false))
  }

  return (
    <div
      className={'editor' + (!props.originalDesign ? ' ' + foundationStyles.nativeEditor : '')}
      data-focus-canvas={focusCanvas ? 'true' : undefined}
    >
      <EditorToolbar
        page={props}
        pageTitle={pageIdentity.title}
        viewTools={viewTools}
        publication={{
          submittedCurrent,
          publishedVersionId,
          hasWorkNotLive,
          reviewId: review?.id,
          scheduling,
          reviewBusy,
        }}
        draft={{ saving, dirty, recovery, limitedHistory, requiresReload, checkpointing, transitionPending }}
        preview={{
          editingFrame: siteWide?.editing,
          previewBlocked: Boolean(sectionTool) || Boolean(libraryPreview) || libraryPreparing,
          canManageSections,
          sitePreview,
          previewHidden,
          changeSitePreview,
          setPreviewHidden,
          openVisitorPreview,
        }}
        commands={{
          checkpoint,
          duplicateCurrentPage,
          discardUnpublished: () => setDiscardConfirmation(true),
          openPageSettings,
          schedulePageReview,
          openPagePublishReview,
          submitForReview: () => setSubmitOpen(true),
        }}
      />

      <LargeScreenEditing>
        <PageRecoveryPanel recovery={recovery} />
      </LargeScreenEditing>

      <EditorNotices
        result={result}
        needsReview={needsReview}
        approved={approved}
        reviewFeedback={reviewFeedback}
        scheduleFirstReview={scheduleFirstReview}
        siteId={props.siteId}
        pageId={props.pageId}
        canPublish={props.canPublish}
        canApproveTrustedCode={props.canApproveTrustedCode}
        dismissResult={() => setResult(null)}
        confirmOverride={() => setOverrideOpen(true)}
        approveCode={() => {
          // Approval is of a *stored* version, so anything unsaved is
          // saved first — approving a version that does not yet
          // contain the code somebody is looking at is exactly the
          // review that means nothing.
          startTransition(async () => {
            if (isDirty(state)) {
              if (!(await save('checkpoint'))) return
            }
            const id = savedVersionId.current
            if (!id) return
            const outcome = await approveTrustedCode(id)
            setResult(outcome)
            if (outcome.ok) setApprovedVersionId(id)
          })
        }}
      />

      <LargeScreenEditing notice>
        {siteWide?.editing && (
          <div className={foundationStyles.siteWideBanner} role="status">
            <strong>Editing site-wide: {siteWide.part === 'header' ? 'Header' : 'Footer'}</strong>
            <Button variant="secondary" size="s" onClick={() => finishSiteWide.current()}>
              Done
            </Button>
          </div>
        )}
        <EditorPaneTabs originalDesign={props.originalDesign} libraryOpen={libraryOpen} pane={pane} setPane={setPane} />

        <div
          id="editor-panes"
          className={`panes ${panelStyles.panes}`}
          data-shown={pane}
          data-library={libraryOpen}
          data-library-left={libraryOpen && !props.originalDesign && layoutTarget === null}
          data-collapsed={structureCollapsed}
          data-right-overlay={rightOverlay}
          data-native={!props.originalDesign}
          style={{ '--right-width': `${rightWidth}px`, '--structure-width': `${structureWidth}px` } as CSSProperties}
        >
          <EditorStructure
            layout={{ ...panels, ...libraryState, sectionTool, pane, setPane }}
            sections={{
              ...draft,
              ...sectionRules,
              ...libraryActions,
              slotsByDef,
              siteWide,
              setSiteWide,
              openPageSettings,
            }}
          />

          <EditorCanvas
            view={{
              ...canvasSession.frame,
              ...canvasSession.geometry,
              ...viewportState,
              props,
              viewTools,
              hiddenSectionCount,
              visibilityView,
              showHiddenSections,
              setShowHiddenSections,
              previewBreakpoint,
            }}
            frame={{
              ...canvasSession.frame,
              ...canvasSession.document,
              ...canvasBridge,
              isolated,
              isolatedCurrent,
              sitePreview,
              publishedVersionId,
            }}
            fields={{
              ...draft,
              ...canvasSession.interaction,
              ...canvasBridge,
              ...catalog,
              ...sectionRules,
              ...sectionActions,
              ...collectionActions,
              setPane,
              selected,
              listSelection,
              setInlineList,
            }}
            overlays={{
              ...sectionUpdates,
              ...reviewState.override,
              ...reviewState.submission,
              ...libraryState,
              ...sectionRules,
              ...libraryActions,
              recovery,
              sectionTool,
              siteWide,
            }}
          />

          <EditorInspectorPanel
            props={props}
            layout={{ ...libraryState, ...sectionUpdates, ...panels }}
            library={{
              page: { ...draft, nameOf, sitePreview },
              placement: {
                ...libraryState,
                ...sectionUpdates,
                ...sectionRules,
                ...layoutActions,
                replacingSection,
                setPane,
              },
              preview: { ...libraryState, ...canvasSession.frame, ...libraryActions },
              recipes: { ...clipboard, pasteSection, recipeGap: libraryState.recipeGap, insertPreparedRecipe },
            }}
            fields={{
              selection: { ...draft, ...catalog, ...sectionRules, ...collectionActions, selected, selectedSection },
              page: {
                ...draft,
                ...reviewState.publication,
                saveDetails,
                pageIdentity,
                sitePreview,
                readiness,
                approved,
              },
              navigation: {
                ...libraryState,
                ...libraryActions,
                ...sectionActions,
                ...layoutActions,
                setSiteWide,
                setPane,
                closeSharedPanel,
                reviewSectionUpgrade,
                setPageSettingsOpen,
                setPageDanger,
                setInlineList,
                reviewFieldUpdate,
                pageSettingsOpen,
              },
            }}
            structure={{
              ...sectionRules,
              ...libraryActions,
              ...sectionActions,
              sections: state.document.sections,
              selected,
              nameOf,
              closeSharedPanel,
              sectionTool,
            }}
            siteFrame={siteFrameInspector(siteFrame, {
              ...canvasSession.frame,
              ...canvasSession.geometry,
              ...canvasSession.interaction,
              ...canvasBridge,
              currentEditor,
            })}
          />
        </div>

        <EditorDialogs
          props={props}
          transitionPending={transitionPending}
          danger={{ pageDanger, setPageDanger, setPageSettingsOpen, applyPageDanger }}
          publication={{
            ...reviewState.publication,
            ...reviewState.review,
            ...reviewState.override,
            props,
            schedulePageReview,
            confirmPagePublishReview,
            setState,
            setPane,
            publish,
            transitionPending,
          }}
          restoration={{ props, restore, applyLiveReset, setLiveSourceIndex, setState, nameOf }}
          lists={{ ...storedDraft, inlineList, setInlineList }}
          sectionChanges={{
            state: sectionUpdates,
            actions: { applyReviewedUpgrade, applyFieldUpdate },
            layout: { reviewLayoutChange, applyLayoutChange, remapReplacement },
          }}
          submission={{ ...reviewState.submission, submitForReview }}
        />
      </LargeScreenEditing>
    </div>
  )
}
