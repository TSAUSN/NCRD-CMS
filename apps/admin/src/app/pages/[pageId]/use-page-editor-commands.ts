import { canvasCollectionCommands } from './canvas-collection-commands.ts'
import { useEditorCanvasControls } from './use-editor-canvas-controls.ts'
import { liveRestore } from './editor-live-restore.tsx'
import { sectionTools } from './section-tools.ts'
import { pageCommands } from './page-commands.ts'
import { libraryCommands } from './library-commands.ts'
import { canvasRemoteActions } from './canvas-remote-actions.ts'
import { sectionReplacementCommands } from './section-replacement-commands.ts'
import { sectionUpdateCommands } from './section-update-commands.ts'
import { useEffect } from 'react'
import { setSelection } from '@cms/domain'
import type { PageEditorSession } from './use-page-editor-session.ts'
import { pageEditorPublishing } from './page-editor-publishing.ts'
export function usePageEditorCommands(session: PageEditorSession) {
  const publishing = pageEditorPublishing(session)
  const { props, state, setState, currentEditor, savedVersionId } = session.draft
  const { restore, libraryState, sectionUpdates, clipboard } = session
  const { sectionLocked, canManageSections, canInsertAt } = session.sectionRules
  const { sitePreview } = session.view
  const { pendingFieldFocus, libraryOpener, returnLibraryFocus } = session.panels
  const { setPageSettingsOpen, setPane } = session.selection
  const { sectionTool, setSectionTool } = session.sectionTools
  const { layoutTarget, setLayoutTarget, setReplacementDefinitions } = session.sectionUpdates
  const { libraryOpen, setLibraryOpen, insertAt } = session.libraryState
  const { setFocusCanvas } = session.viewportState
  const { canvasRef, setCanvasFramePending, setCanvasSource, canvasReady, setCanvasReady } = session.canvasSession.frame
  const { previewScale } = session.canvasSession.geometry
  const { shown, canvasRefreshBlocked } = session.canvasSession.document
  const {
    isolated,
    isolatedCurrent,
    canvasHistoryBlocked,
    dropOnCanvas,
    setCanvasMenuPage,
    setRemoteHover,
    setRemoteRichState,
    setRemoteRichUnavailable,
    remoteActions,
    canvasOperations,
    setRichTextRequest,
  } = session.canvasSession.interaction
  const { canvasAwaitingRender, activeRichText, toCanvas, renderCanvas } = session.canvasBridge
  const { slotsByDef, nameOf } = session.catalog
  const { flushForReview } = session.saveSession
  const { withCanvasValues, openAfterPageAction } = session.persistence
  const { publishedVersionId, recordPublication, setApprovedVersionId } = session.reviewState.publication
  const { setReview } = session.reviewState.review
  const { transitionPending, startTransition } = session.reviewState.transition
  const { pageDanger, setPageDanger } = session.pageActions
  const { listSelection, setListSelection, setInlineList } = session.list
  const { setSectionConfirmation, setLiveSourceIndex } = session.restore
  const { siteWide, setSiteWide } = session.siteFrame
  const { storedDraft } = publishing
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

  const { openLayoutChoice } = layoutActions
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

  const { openLibrary, placeLibraryEntry } = libraryActions
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
  const { canvasAction, applyCanvasAction } = sectionActions
  const { duplicateCurrentPage, saveDetails, applyPageDanger } = pageCommands({
    draft: storedDraft,
    lifecycle: {
      pageDanger,
      setPageDanger,
      transitionPending,
      startTransition,
      clearPublication: () => recordPublication(null),
      setReview,
      openAfterPageAction,
    },
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

  return {
    publishing,
    selected,
    selectedSection,
    replacingSection,
    libraryActions,
    openPageSettings,
    sectionActions,
    layoutActions,
    applyLiveReset,
    collectionActions,
    duplicateCurrentPage,
    saveDetails,
    applyPageDanger,
    reviewSectionUpgrade,
    applyReviewedUpgrade,
    reviewFieldUpdate,
    applyFieldUpdate,
  }
}
export type PageEditorCommands = ReturnType<typeof usePageEditorCommands>
