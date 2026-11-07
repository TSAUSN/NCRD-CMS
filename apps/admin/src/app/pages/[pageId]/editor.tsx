'use client'
import { draftSaveFailure } from '../../../lib/draft-save-failure.ts'
import { LargeScreenEditing } from '../../../components/content-editor.tsx'
import { sectionLibraryName } from '../../../lib/section-library-search.ts'
import { PageSectionLibrary } from './page-section-library.tsx'
import { installNativeFieldFeedback } from './canvas-field-feedback.ts'
import { SectionToolsPanel } from './section-tools-panel.tsx'
import { saveSectionLink } from './section-tools-actions.ts'
import type { SectionToolSource } from '../../../lib/section-tools-commands.ts'
import { pageLeaveSnapshot } from '../../../lib/page-leave.ts'
import { loadPageSavedReview } from './page-review-actions.ts'
import type { ReleasePresentation } from '../../../lib/release-copy.ts'
import { useRouter } from 'next/navigation'
import { preparePageSchedule } from './page-schedule-actions.ts'
import { COMMAND_SEARCH_EVENT, isCommandSearchKey } from '../../../lib/command-search-model.ts'
import { addEditorRepeatItem, discardNewRepeatItem, repeatItemHasContent } from '../../../lib/editor-repeat-item.ts'
import { isSharedChapterPart, preservesSharedChapterParts } from '../../../lib/chapter-section-locks.ts'
import { preserveNationalTileLayout } from '@cms/schema'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import { ResizablePanel } from '../../../components/ui/resizable-panel.tsx'
import type { CSSProperties } from 'react'
import panelStyles from './editor-panels.module.css'
import foundationStyles from './editor-foundation.module.css'
import { StatusPill } from '../../../components/ui/status-pill.tsx'
import { BackLink } from '../../../components/ui/back-link.tsx'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { useHistoryTraversalGuard } from '../../../components/use-history-traversal-guard.ts'
import { clipboardKey, readSectionClipboard, type SectionClipboard } from '../../../lib/section-clipboard.ts'
import { copiedSectionLayout, duplicatePageAction } from './page-copy-actions.ts'
import { savePageDetailsAction } from './page-details-actions.ts'
import type { PageDetailsInput } from '../../../lib/page-details.ts'
import { resetPageFromLive } from './live-reset-actions.ts'
import { recoverDocument } from '../../../lib/page-recovery.ts'
import { usePageRecovery } from './use-page-recovery.ts'
import { PageRecoveryPanel, RecoveryStatus } from './page-recovery-panel.tsx'
import {
  validSectionAnchor,
  isDrawingSlot,
  isIconSlot,
  slotForId,
  sectionStartingValues,
  markSampleValues,
  sampleFieldNames,
} from '@cms/schema'
// Structure, live page preview, and field inspector share one editor state.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  apply,
  addSection,
  addSections,
  captureSectionInsertionPoint,
  resolveSectionInsertionPoint,
  canRedo,
  canUndo,
  carriesTrustedCode,
  commitBaseline,
  commitSaved,
  createEditorState,
  createSaveQueue,
  deepEqual,
  duplicateSection,
  isDirty,
  moveSection,
  redo,
  removeSection,
  replaceSection,
  revertSlot,
  setCustomCss,
  setMeta,
  setRawHtml,
  setSelection,
  setSectionAppearance,
  setSectionLabel,
  setSectionValues,
  setValue,
  toggleHidden,
  toggleHiddenAt,
  undo,
  type EditorDocument,
  type EditorSection,
  type EditorState,
  type ReadinessReport,
  type SaveQueue,
} from '@cms/domain'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import { archivePage, unpublishPage } from '../../actions/page-lifecycle.ts'
import { approveTrustedCode } from '../../actions/section-definitions.ts'
import { publishPage, publishPageTogether } from '../../actions/page-publish.ts'
import { savePageDraft } from '../../actions/page-draft.ts'
import { submitPageForReview } from '../../actions/reviews.ts'
import { type ActionResult } from '../../../lib/action-result.ts'
import { ButtonLink, Dialog, Button, IconButton, Menu } from '../../../components/ui/index.ts'
import { ConfirmDialog, ReasonDialog } from '../../../components/confirm.tsx'
import {
  IconChevronLeft,
  IconClock,
  IconExternal,
  IconPlus,
  IconMore,
  IconRedo,
  IconSettings,
  IconUndo,
} from '../../../components/icons.tsx'

import { planCanvasUpdate, withCanvasValue } from './canvas-sync.ts'
import { CanvasRichText, patchCanvasRichText, type CanvasRichTextRequest } from './canvas-rich-text.tsx'
import type { CanvasMenuAddState } from '../../../components/canvas-menu-add.tsx'
import { SiteLookPanel } from '../../../components/site-look-panel.tsx'
import { SiteFrameNote } from './site-frame-note.tsx'
import { InlineListDrawer } from './inline-list-drawer.tsx'
import { flushSync } from 'react-dom'
import { useIsolatedCanvas, readCanvasTicket } from './use-isolated-canvas.ts'
import { IsolatedRichTextToolbar } from './isolated-rich-text-toolbar.tsx'
import { isRichTextToolbarState, type RichTextToolbarState } from './rich-text-commands.ts'
import { CanvasChrome, type CanvasHover, type CanvasAction } from './canvas-chrome.tsx'
import { sectionDisplayName } from '../../../lib/section-display-name.ts'
import {
  moveRepeatItem,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSpec,
  repeatItemSlotId,
  type FieldLike,
} from '@cms/schema'
import { StructureTree } from './structure-tree.tsx'
import { cancelFieldEdit } from '@cms/domain'
import { Inspector } from './inspector.tsx'
import { LibraryOverlay } from './library-overlay.tsx'
import { RecipePicker, type PreparedRecipeInsertion } from '../../../components/recipe-picker.tsx'
import { hasTrustedSectionTemplate, pinnedSectionCatalog, sectionVersionKey } from '../../../lib/section-version.ts'
import {
  applySectionUpgrade,
  previewSectionUpgrade,
  type UpgradePreview,
  type UpgradeRequest,
} from './section-upgrade-actions.ts'
import { SectionUpgradeDialog } from './section-upgrade-dialog.tsx'
import {
  applySectionReplacement,
  previewSectionReplacement,
  type ReplacementPreview,
  type ReplacementRequest,
  type ReplacementResult,
} from './section-replacement-actions.ts'
import { LayoutChooser } from './layout-chooser.tsx'
import { listCompatibleSectionLayouts, type ReplacementOption } from './section-replacement-actions.ts'
import { SectionReplacementDialog } from './section-replacement-dialog.tsx'
import {
  applyImportedFieldUpdate,
  previewImportedFieldUpdate,
  type ImportedUpdatePreview,
  type ImportedUpdateRequest,
  type ImportedUpdateResult,
} from './imported-update-actions.ts'
import { ImportedUpdateDialog } from './imported-update-dialog.tsx'

/**
 * A library card, as the editor needs it.
 *
 * Re-exported from the query rather than re-declared, and as a *type* export so
 * nothing from a `server-only` module is pulled into the browser bundle. The
 * two used to be separate declarations of the same row and drifted the moment
 * the query learned about thumbnails.
 */
export type { LibraryEntry } from '../../../lib/queries.ts'
import type { LibraryEntry, LinkTarget } from '../../../lib/queries.ts'
import type { MediaAsset } from '../../../lib/media-library.ts'
import { sitePreviewContext, type SitePreviewContext } from '../../../lib/preview-context.ts'
import { EditorNotices } from './editor-notices.tsx'
import { EditorToolbar } from './editor-toolbar.tsx'
import type { PageEditorProps, EditorPane as Pane } from './editor-types.ts'
import { VIEWPORTS, type Viewport } from './editor-viewports.ts'
import { EditorStructure } from './editor-structure.tsx'

const PANES: readonly { id: Pane; label: string }[] = [
  { id: 'tree', label: 'Structure' },
  { id: 'canvas', label: 'Page' },
  { id: 'inspector', label: 'Edit' },
] as const

// A pause this long saves, as it ends an undo step (TYPING_PAUSE_MS). It keeps
// an acknowledged save within SPEC §9.3's two seconds with room to spare,
// while continuous typing still avoids a write per key.
const AUTOSAVE_MS = 1000
// Reorder, visibility, rich text, links and images need the canonical server
// renderer before the canvas can show them. Waiting the full typing debounce
// made V2 feel unlike V1 precisely on direct-manipulation actions, so those
// changes settle quickly while ordinary text still avoids a write per key.
const CANVAS_RENDER_MS = 350
type SaveSnapshot = { document: EditorDocument; sectionOrigins: string[] }

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
  const sectionLocked = (index: number | null) =>
    Boolean(
      index !== null &&
      ((props.lockChapterShared && isSharedChapterPart(props.document.sections[index])) ||
        (props.chapterPage &&
          props.pinnedSections.some(
            def =>
              def.section_def_id === props.document.sections[index]?.section_def_id &&
              def.slug === 'core-echelon-jump-links',
          ))),
    )
  function closeSharedPanel() {
    setState(current => setSelection(current, { section: null, slot: null }))
    setPane('canvas')
  }
  const lastShared = props.lockChapterShared
    ? props.document.sections.reduce((last, section, index) => (isSharedChapterPart(section) ? index : last), -1)
    : -1
  const canManageSections = props.originalDesign || props.canAdvanced
  const canInsertAt = (index: number) => canManageSections && index > lastShared
  const canMoveSection = (from: number, to: number) =>
    canManageSections &&
    !Array.from({ length: Math.abs(to - from) + 1 }, (_, index) => Math.min(from, to) + index).some(sectionLocked)
  const [revision, setRevision] = useState(props.revision)
  /**
   * One request at a time, each using the revision the previous one returned.
   * Two concurrent saves would necessarily send the same revision, and the
   * second would come back as a conflict the person did not cause.
   */
  const queue = useRef<SaveQueue<SaveSnapshot>>(undefined as never)
  if (!queue.current) queue.current = createSaveQueue<SaveSnapshot>(props.revision)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  // SPEC §6.4: open on the visitor's desktop viewport scaled to fit, as V1
  // did, rather than reflowing desktop content to the column's width.
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [manualScale, setManualScale] = useState(1)
  const [previewHidden, setPreviewHidden] = useState(false)
  const [focusCanvas, setFocusCanvas] = useState(false)
  const [copiedSection, setCopiedSection] = useState<SectionClipboard | null>(null)
  const [pasting, setPasting] = useState(false)
  useEffect(() => {
    try {
      setCopiedSection(
        readSectionClipboard(
          localStorage.getItem(clipboardKey(props.userId, props.siteId)),
          props.userId,
          props.siteId,
        ),
      )
    } catch {
      /* Session copy remains available when storage is disabled. */
    }
  }, [props.userId, props.siteId])
  const pageIdentity = state.document.identity ?? {
    title: props.title,
    address: props.metadataContext.path?.replace(/^\//, '') ?? '',
  }
  const [pageDanger, setPageDanger] = useState<'unpublish' | 'archive' | null>(null)
  const [siteWide, setSiteWide] = useState<{ part: 'header' | 'footer'; editing: boolean } | null>(null)
  const [menuMove, setMenuMove] = useState<{ from: string; to: string; sequence: number } | null>(null)
  const [menuEdit, setMenuEdit] = useState<{ path: string; label: string; sequence: number } | null>(null)
  const finishSiteWide = useRef<() => void>(() => {})
  const siteWideCurrent = useRef(siteWide)
  siteWideCurrent.current = siteWide
  const [listSelection, setListSelection] = useState<{
    section: number
    readerKey: string
    stableKey: string
    field: string
  } | null>(null)
  const [inlineList, setInlineList] = useState<{ readerKey: string; stableKey?: string; unit: string } | null>(null)
  const [discardConfirmation, setDiscardConfirmation] = useState(false)
  const [liveSourceIndex, setLiveSourceIndex] = useState(0)
  const [resetting, setResetting] = useState(false)
  const [sectionConfirmation, setSectionConfirmation] = useState<{ origin: string; action: 'delete' | 'reset' } | null>(
    null,
  )
  const [pageSettingsOpen, setPageSettingsOpen] = useState(props.initialSettings === true)
  const [showHiddenSections, setShowHiddenSections] = useState(true)
  const [sitePreview, setSitePreview] = useState<SitePreviewContext>(props.initialSitePreview ?? 'published')
  const [pane, setPane] = useState<Pane>(
    props.initialSettings || typeof props.initialSection === 'number' ? 'inspector' : 'canvas',
  )
  useEffect(() => {
    const field = props.initialFocus
    if (!field) return
    const target =
      field === 'picture-description' && typeof props.initialSection === 'number' && props.initialField
        ? `slot-${props.initialSection}-${props.initialField}-alt`
        : ['title', 'description', 'canonical'].includes(field)
          ? `meta-${field}`
          : null
    if (!target) return
    let observer: ResizeObserver | undefined, settle: ReturnType<typeof setTimeout> | undefined
    const focus = () => {
      const element = document.getElementById(target)
      if (!element) return
      for (let parent = element.parentElement; parent; parent = parent.parentElement)
        if (parent instanceof HTMLDetailsElement) parent.open = true
      const reveal = () => element.scrollIntoView({ block: 'center' })
      element.focus({ preventScroll: true })
      reveal()
      // Page details load after the search fields. Keep the requested field
      // visible while that form settles, then return scrolling to the author.
      const container = element.closest('dialog') ?? element.closest('aside')
      if (container) {
        observer = new ResizeObserver(reveal)
        for (const section of container.querySelectorAll('section,details')) observer.observe(section)
        settle = setTimeout(() => observer?.disconnect(), 2000)
      }
    }
    const timer = setTimeout(focus, 0)
    return () => {
      clearTimeout(timer)
      if (settle) clearTimeout(settle)
      observer?.disconnect()
    }
  }, [props.initialField, props.initialFocus, props.initialSection])

  const [result, setResult] = useState<ActionResult | null>(null)
  const [requiresReload, setRequiresReload] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [choosingSectionSpot, setChoosingSectionSpot] = useState(false)
  const [libraryPreview, setLibraryPreview] = useState<LibraryEntry | null>(null)
  const [libraryPreparing, setLibraryPreparing] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const libraryStage = useRef(false)
  libraryStage.current = libraryPreview !== null

  const [rightWidth, setRightWidth] = useState(360)
  const [structureWidth, setStructureWidth] = useState(240)
  const [workspaceWidth, setWorkspaceWidth] = useState(1440)
  const [structureOpen, setStructureOpen] = useState(false)
  const pendingFieldFocus = useRef<string | null>(null)
  const structureCollapsed = workspaceWidth - rightWidth - structureWidth < 480
  const rightOverlay = props.originalDesign && workspaceWidth - rightWidth - 48 < 480
  useEffect(() => {
    const panes = document.getElementById('editor-panes')
    if (!panes) return
    const observer = new ResizeObserver(() => setWorkspaceWidth(panes.clientWidth))
    observer.observe(panes)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (libraryOpen || !pendingFieldFocus.current) return
    const slot = pendingFieldFocus.current
    const frame = requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(`[data-inspector-slot="${CSS.escape(slot)}"]`)
      field?.querySelector<HTMLElement>('input,textarea,select,[contenteditable="true"],button')?.focus()
      pendingFieldFocus.current = null
    })
    return () => cancelAnimationFrame(frame)
  }, [libraryOpen, state.selection])
  const libraryOpener = useRef<HTMLElement | null>(null)
  const returnLibraryFocus = useRef(false)
  useEffect(() => {
    if (libraryOpen || !returnLibraryFocus.current) return
    returnLibraryFocus.current = false
    const opener = libraryOpener.current
    const target = opener?.isConnected
      ? opener
      : ((opener?.id ? document.getElementById(opener.id) : null) ?? document.getElementById('editor-add-section-end'))
    target?.focus({ preventScroll: true })
  }, [libraryOpen])
  const [libraryFavourites, setLibraryFavourites] = useState<Record<string, boolean>>({})
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [sectionTool, setSectionTool] = useState<{
    kind: 'link' | 'copy'
    index: number
    source: SectionToolSource | null
  } | null>(null)
  const [recipeDefinitions, setRecipeDefinitions] = useState<LibraryEntry[]>([])
  const recipeGap = useRef<ReturnType<typeof captureSectionInsertionPoint> | null>(null)
  const [saving, setSaving] = useState(false)
  /** An explicit Save draft waiting for its own acknowledgement. Autosave does
   * not disable the button: a click while one runs queues behind it, rather
   * than landing on a button that turned disabled under the pointer. */
  const [checkpointing, setCheckpointing] = useState(false)
  const [upgrade, setUpgrade] = useState<{
    request: UpgradeRequest | null
    preview: UpgradePreview | null
    busy: boolean
  } | null>(null)
  const upgradeGeneration = useRef(0)
  /** The section (by stable origin) whose layout the library is choosing. */
  const [layoutChooser, setLayoutChooser] = useState<{
    origin: string
    options: ReplacementOption[] | null
    error: string | null
  } | null>(null)
  const [layoutTarget, setLayoutTarget] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<{
    request: ReplacementRequest | null
    preview: ReplacementPreview | null
    busy: boolean
    refreshing: boolean
  } | null>(null)
  const replacementGeneration = useRef(0)
  const [fieldUpdate, setFieldUpdate] = useState<{
    request: ImportedUpdateRequest | null
    preview: ImportedUpdatePreview | null
    busy: boolean
  } | null>(null)
  const fieldUpdateGeneration = useRef(0)
  const [replacementDefinitions, setReplacementDefinitions] = useState<LibraryEntry[]>([])
  const [publishedVersionId, setPublishedVersionId] = useState(props.publishedVersionId)
  const [approvedVersionId, setApprovedVersionId] = useState(props.trustedCodeApproved ? props.previewVersionId : null)
  const [publishReviewOpen, setPublishReviewOpen] = useState(false)
  const reviewFlight = useRef(false),
    [reviewBusy, setReviewBusy] = useState(false),
    [pageReview, setPageReview] = useState<{
      title: string
      revision: string
      versionId: string
      presentation: ReleasePresentation
    } | null>(null)
  const [sampleConfirmation, setSampleConfirmation] = useState<{
    overrideReason?: string
    together: boolean
    siteWide: boolean
  } | null>(null)
  const remainingSamples = state.document.sections
    .flatMap((section, index) =>
      section.hidden
        ? []
        : [{ section: section.label || `Section ${index + 1}`, fields: sampleFieldNames(section.values) }],
    )
    .filter(sample => sample.fields.length)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitNote, setSubmitNote] = useState('')
  const [review, setReview] = useState(props.openReview)
  const [reviewFeedback, setReviewFeedback] = useState(props.latestReviewFeedback)
  const [transitionPending, startTransition] = useTransition()
  useEffect(() => {
    if (!transitionPending) {
      if (!reviewFlight.current) setReviewBusy(false)
      if (!scheduleFlight.current) setScheduling(false)
    }
  }, [transitionPending])
  const canvasHistoryBlocked = useRef(false)
  const dropOnCanvas = useRef<((sectionDefId: string, at: number) => void) | null>(null)

  const canvasItemToolbarRef = useRef<HTMLDivElement>(null)
  const canvasZoomRef = useRef<HTMLDivElement>(null)
  const canvasRefreshBlocked = useRef(false)
  const [canvasFramePending, setCanvasFramePending] = useState(false)
  const canvasRef = useRef<HTMLIFrameElement>(null)
  const canvasViewportRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const deviceWidth = VIEWPORTS[viewport].width
  const previewWidth = deviceWidth
  const previewScale =
    zoom === 'fit' && canvasSize.width > 0
      ? Math.min(1, canvasSize.width / previewWidth)
      : zoom === 'actual'
        ? manualScale
        : 1
  useEffect(() => {
    const node = canvasViewportRef.current
    if (!node) return
    const measure = () =>
      setCanvasSize({
        width: node.clientWidth - Number.parseFloat(getComputedStyle(node).paddingInlineStart || '0'),
        height: node.clientHeight,
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const dirty = isDirty(state)

  /**
   * What the canvas is showing, and what it is owed.
   *
   * The first four are refs rather than state because none of them decides what
   * the *editor* renders — they decide what the canvas is told. Holding them as
   * state would rebuild the save callback and restart the debounced autosave on
   * every keystroke, which is the one thing that timer must not do.
   */
  /** The draft version the server most recently stored. */
  const savedVersionId = useRef(props.previewVersionId)
  /** The document the canvas in front of us was rendered from. */
  const rendered = useRef<EditorDocument>(state.document)
  /** That document, plus every value patched into it since it loaded. */
  const shown = useRef<EditorDocument>(state.document)
  /** Set once the canvas is showing something a patch cannot correct. */
  const needsRender = useRef(false)
  /** Which version the canvas is pointed at; a new epoch reloads it. */
  const [canvasSource, setCanvasSource] = useState({ versionId: props.previewVersionId, epoch: 0 })
  /** Bumped each time the canvas announces a document, so the sync effect re-runs. */
  const [canvasReady, setCanvasReady] = useState(0)
  const isolated = useIsolatedCanvas({
    origin: props.isolatedCanvasOrigin ?? null,
    pageId: props.pageId,
    version: canvasSource.versionId,
    epoch: canvasSource.epoch,
    site: sitePreview,
    hidden: showHiddenSections,
    frame: canvasRef,
  })
  const isolatedCurrent = useRef(isolated)
  isolatedCurrent.current = isolated
  const [canvasMenuPage, setCanvasMenuPage] = useState<{ id: string; sequence: number } | null>(null)
  const [remoteHover, setRemoteHover] = useState<CanvasHover | null>(null)
  const [remoteRichState, setRemoteRichState] = useState<RichTextToolbarState | null>(null)
  const [remoteRichUnavailable, setRemoteRichUnavailable] = useState(false)
  const remoteActions = useRef<(data: Record<string, unknown>) => boolean>(() => false)
  const canvasOperations = useRef<{
    section: (action: CanvasAction, index: number) => void
    repeat: (
      index: number,
      slot: FieldLike,
      action: 'add' | 'up' | 'down' | 'duplicate' | 'delete',
      key?: string,
    ) => void
  } | null>(null)
  const sitePreviewCurrent = useRef(sitePreview)
  sitePreviewCurrent.current = sitePreview
  const changeSitePreview = useCallback((next: SitePreviewContext) => {
    if (sitePreviewCurrent.current === next) return
    sitePreviewCurrent.current = next
    setCanvasFramePending(true)
    setCanvasReady(0)
    setSitePreview(next)
  }, [])
  const [canvasAttached, setCanvasAttached] = useState(false)
  const [canvasSlow, setCanvasSlow] = useState(false)
  const readyDocumentId = useRef<string | null>(null)
  const [richTextRequest, setRichTextRequest] = useState<CanvasRichTextRequest | null>(null)
  const currentEditor = useRef(state)
  currentEditor.current = state
  const [recoveryDefinitions, setRecoveryDefinitions] = useState<LibraryEntry[]>([])
  const recovery = usePageRecovery({
    scope: { userId: props.userId, siteId: props.siteId, pageId: props.pageId },
    document: state.document,
    base: { versionId: savedVersionId.current, revision, document: state.saved },
    canApply: () =>
      !isDirty(currentEditor.current) &&
      !saving &&
      !queue.current.busy() &&
      !transitionPending &&
      upgrade === null &&
      replacement === null &&
      !overrideOpen &&
      !submitOpen &&
      !(result?.ok === false && result.kind === 'conflict'),
    onRecover: (document, definitions) => {
      setRecoveryDefinitions(current => [...current, ...definitions])
      setRichTextRequest(null)
      setState(current => recoverDocument(current, document))
    },
  })
  useNavigationGuard(() => ({
    dirty: dirty || !deepEqual(state.document, openingSnapshot.current!.document),
    nativeDirty: dirty,
    draft: {
      label: state.document.identity?.title || props.title,
      saved: !dirty,
      discardLabel: 'Discard my edits',
      saveDraft: savePageBeforeLeaving,
      discard: discardPageBeforeLeaving,
    },
    pending:
      reviewFlight.current ||
      scheduleFlight.current ||
      transitionPending ||
      saving ||
      queue.current.busy() ||
      upgrade?.busy === true ||
      replacement?.busy === true ||
      recovery.pending(),
  }))
  const limitedHistory = useHistoryTraversalGuard()
  useLayoutEffect(() => {
    canvasHistoryBlocked.current =
      pageDanger !== null ||
      siteWide?.editing === true ||
      inlineList !== null ||
      layoutChooser !== null ||
      sectionConfirmation !== null ||
      discardConfirmation ||
      upgrade !== null ||
      replacement !== null ||
      fieldUpdate !== null ||
      overrideOpen ||
      submitOpen ||
      recovery.review !== null ||
      recovery.busy
  }, [
    pageDanger,
    siteWide,
    inlineList,
    layoutChooser,
    sectionConfirmation,
    discardConfirmation,
    upgrade,
    replacement,
    fieldUpdate,
    overrideOpen,
    submitOpen,
    recovery.review,
    recovery.busy,
  ])

  const knownDefinitions = useRef<ReadonlyMap<string, LibraryEntry>>(new Map())
  const slotsByDef = useMemo(
    () =>
      pinnedSectionCatalog(
        props.library,
        [...props.pinnedSections, ...recipeDefinitions, ...recoveryDefinitions, ...replacementDefinitions],
        knownDefinitions.current,
      ),
    [props.library, props.pinnedSections, recipeDefinitions, recoveryDefinitions, replacementDefinitions],
  )
  const hasEditableFields = state.document.sections.some(
    section =>
      (slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots.length ?? 0) > 0,
  )
  // Undo can bring back a version no longer present in the current draft.
  useEffect(() => {
    knownDefinitions.current = slotsByDef
  }, [slotsByDef])
  const slotKind = useCallback(
    (section: EditorSection, slot: string) => {
      // A repeated item's field is named by its composed id (LIB-02).
      const declared =
        slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []
      const field = slotForId(declared, section.values, slot)
      if (
        field?.kind === 'text' &&
        ['cms-date-long-v1', 'cms-date-calendar-v1'].includes(String(field.constraints?.presentation))
      )
        return 'date'
      return field && (isIconSlot(field) || isDrawingSlot(field)) ? 'icon' : field?.kind
    },
    [slotsByDef],
  )

  // A rich-text field's definition constraints (inline or block, and its
  // blocks' and marks' presentation), so live canvas updates and on-page
  // editing show what the page itself renders.
  const richTextConstraints = useCallback(
    (section: EditorSection | undefined, slot: string): unknown =>
      section
        ? slotForId(
            slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? [],
            section.values,
            slot,
          )?.constraints
        : undefined,
    [slotsByDef],
  )

  const canvasAwaitingRender = canvasFramePending || planCanvasUpdate(rendered.current, state.document, slotKind).render
  useLayoutEffect(() => {
    canvasRefreshBlocked.current = canvasAwaitingRender
  }, [canvasAwaitingRender])
  const activeRichText =
    richTextRequest &&
    state.selection.section === richTextRequest.section &&
    state.selection.slot === richTextRequest.slot &&
    state.sectionOrigins[richTextRequest.section] === richTextRequest.origin
      ? richTextRequest
      : null
  const currentSlotKind = useRef(slotKind)
  currentSlotKind.current = slotKind

  // ------------------------------------------------------------- canvas link

  const toCanvas = useCallback((message: Record<string, unknown>) => {
    if (isolatedCurrent.current.enabled) isolatedCurrent.current.post(message)
    else canvasRef.current?.contentWindow?.postMessage(message, window.location.origin)
  }, [])

  const sendCanvasMenu = useCallback(
    (menu: CanvasMenuAddState | null) => toCanvas({ type: 'cms:menu-add', menu }),
    [toCanvas, canvasReady],
  )

  useEffect(() => {
    // Native dragend goes to the card's document, even when Escape cancels
    // with the pointer inside the iframe. Clear that frame's insertion marker.
    const cancelDrop = () => toCanvas({ type: PREVIEW_MESSAGE.cancelDrop })
    document.addEventListener('dragend', cancelDrop, true)
    return () => document.removeEventListener('dragend', cancelDrop, true)
  }, [toCanvas])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Same-origin only: the canvas is our own route, and anything else
      // talking to this window is not the canvas.
      if (
        isolatedCurrent.current.enabled
          ? !isolatedCurrent.current.accept(event)
          : event.origin !== window.location.origin ||
            event.source !== canvasRef.current?.contentWindow ||
            !event.data?.type
      )
        return
      if (
        canvasRefreshBlocked.current &&
        event.data.type !== PREVIEW_MESSAGE.ready &&
        event.data.type !== 'cms:frame-editing'
      )
        return
      if (isolatedCurrent.current.enabled && remoteActions.current(event.data as Record<string, unknown>)) return
      const data = event.data as {
        type: string
        documentId?: unknown
        section: number | null
        slot: string | null
        value?: unknown
        x?: unknown
        y?: unknown
        occurrence?: unknown
        editing?: unknown
        burst?: unknown
        readerKey?: unknown
        stableKey?: unknown
        field?: unknown
        part?: unknown
        path?: unknown
        label?: unknown
        from?: unknown
        to?: unknown
      }
      if (libraryStage.current && event.data.type !== PREVIEW_MESSAGE.ready) return
      const section =
        Number.isSafeInteger(data.section) && data.section !== null
          ? currentEditor.current.document.sections[data.section]
          : undefined
      const kind = section && typeof data.slot === 'string' ? currentSlotKind.current(section, data.slot) : undefined

      if (data.type === PREVIEW_MESSAGE.ready) {
        if (typeof data.documentId === 'string') {
          if (readyDocumentId.current === data.documentId) return
          readyDocumentId.current = data.documentId
        }
        // A canvas that has just loaded is a different document: it shows what
        // the server rendered and nothing that was patched into the one before
        // it, and it has lost the selection outline and the emulated width
        // along with the window that held them.
        setRichTextRequest(null)
        setRemoteHover(null)
        setRemoteRichState(null)
        setRemoteRichUnavailable(false)
        shown.current = rendered.current
        setCanvasFramePending(false)
        setCanvasReady(n => n + 1)
      } else if (
        !props.pageScoped &&
        data.type === PREVIEW_MESSAGE.selectFrame &&
        (data.part === 'header' || data.part === 'footer')
      ) {
        if (!siteWideCurrent.current?.editing) {
          setState(current => setSelection(current, { section: null, slot: null }))
          setMenuEdit(null)
          setMenuMove(null)
          setSiteWide({ part: data.part, editing: false })
          setLibraryOpen(false)
          setPane('inspector')
        }
      } else if (
        data.type === PREVIEW_MESSAGE.moveFrameMenu &&
        siteWideCurrent.current?.editing &&
        typeof data.from === 'string' &&
        typeof data.to === 'string' &&
        /^\d+(?:\.\d+)?$/.test(data.from) &&
        /^\d+(?:\.\d+)?$/.test(data.to)
      ) {
        setMenuMove(previous => ({
          from: data.from as string,
          to: data.to as string,
          sequence: (previous?.sequence ?? 0) + 1,
        }))
      } else if (
        data.type === PREVIEW_MESSAGE.editFrameMenu &&
        siteWideCurrent.current?.editing &&
        typeof data.path === 'string' &&
        /^[0-9]+(?:\.[0-9]+)?$/.test(data.path) &&
        typeof data.label === 'string'
      ) {
        setMenuEdit(previous => ({
          path: data.path as string,
          label: data.label as string,
          sequence: (previous?.sequence ?? 0) + 1,
        }))
      } else if (
        data.type === PREVIEW_MESSAGE.selectListItem &&
        Number.isSafeInteger(data.section) &&
        typeof data.readerKey === 'string' &&
        /^[a-z][a-z0-9_]{0,63}$/.test(data.readerKey) &&
        data.section !== null &&
        data.section >= 0 &&
        data.section < currentEditor.current.document.sections.length &&
        typeof data.stableKey === 'string' &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.stableKey) &&
        typeof data.field === 'string'
      ) {
        setState(current => setSelection(current, { section: data.section, slot: null }))
        setListSelection({
          section: data.section,
          readerKey: data.readerKey,
          stableKey: data.stableKey,
          field: data.field,
        })
      } else if (data.type === PREVIEW_MESSAGE.select) {
        if (siteWideCurrent.current?.editing) return
        setSiteWide(null)
        setListSelection(null)
        setState(current => setSelection(current, { section: data.section, slot: data.slot }))
        setPane(data.editing === true ? 'canvas' : 'inspector')
      } else if (data.type === PREVIEW_MESSAGE.undo || data.type === PREVIEW_MESSAGE.redo) {
        // The same origin/source check above applies to history requests.
        // The canvas has no independent page-history stack.
        if (!canvasHistoryBlocked.current) {
          setState(current => (data.type === PREVIEW_MESSAGE.redo ? redo(current) : undo(current)))
        }
      } else if (
        data.type === PREVIEW_MESSAGE.editRichText &&
        section &&
        kind === 'richtext' &&
        data.section !== null &&
        typeof data.slot === 'string' &&
        !canvasHistoryBlocked.current &&
        !sectionLocked(data.section)
      ) {
        if (isolatedCurrent.current.enabled) {
          setRemoteRichState(null)
          setRemoteRichUnavailable(false)
        }
        setState(current => setSelection(current, { section: data.section, slot: data.slot }))
        setRichTextRequest({
          section: data.section,
          slot: data.slot,
          origin: currentEditor.current.sectionOrigins[data.section]!,
          occurrence:
            typeof data.occurrence === 'number' && Number.isSafeInteger(data.occurrence) && data.occurrence >= 0
              ? data.occurrence
              : 0,
          x: typeof data.x === 'number' && Number.isFinite(data.x) ? data.x : null,
          y: typeof data.y === 'number' && Number.isFinite(data.y) ? data.y : null,
        })
      } else if (
        data.type === PREVIEW_MESSAGE.edit &&
        section &&
        kind === 'text' &&
        data.section !== null &&
        typeof data.slot === 'string' &&
        typeof data.value === 'string' &&
        !canvasHistoryBlocked.current
      ) {
        // Typing directly on the canvas is the same edit as typing in the
        // inspector, so it goes through the same state transition — but the
        // canvas is already showing it, and recording that is what stops the
        // sync below from posting the character back into the node the caret
        // is sitting in.
        shown.current = withCanvasValue(shown.current, data.section, data.slot, data.value as string)
        // A burst of typing on the canvas is one undo step; the canvas says
        // where each burst begins (a click or a caret move ends it).
        const burst =
          typeof data.burst === 'number' && Number.isSafeInteger(data.burst)
            ? `canvas-${data.burst}`
            : `canvas-${Date.now()}`
        const edit = () =>
          setState(current =>
            setValue(current, data.section!, data.slot!, data.value as string, { at: Date.now(), burst }),
          )
        if (isolatedCurrent.current.enabled) flushSync(edit)
        else edit()
      } else if (data.type === PREVIEW_MESSAGE.dropSection) {
        // A card dragged from the docked library onto the page. The canvas
        // names a gap; whether that definition is offered here, and whether the
        // gap exists, is decided against the editor's own state.
        const drop = event.data as { sectionDefId?: unknown; at?: unknown }
        const at = drop.at
        if (
          typeof drop.sectionDefId === 'string' &&
          typeof at === 'number' &&
          Number.isSafeInteger(at) &&
          at >= 0 &&
          at <= currentEditor.current.document.sections.length &&
          !canvasHistoryBlocked.current
        ) {
          dropOnCanvas.current?.(drop.sectionDefId, at)
        }
      } else if (data.type === PREVIEW_MESSAGE.unpatched) {
        // The canvas could not write that value where the editor believed it
        // was — an attribute-position slot has no node of its own, and a
        // hidden section has no nodes at all. Only a render can show it, and a
        // value that quietly never lands is precisely how the page and the
        // document came to disagree with nobody able to see that they had.
        needsRender.current = true
      }
    }
    window.addEventListener('message', onMessage)
    // Start the frame after hydration installs its listener, so the first
    // navigation and readiness exchange cannot race that setup. The public
    // page itself remains server rendered.
    setCanvasAttached(true)
    toCanvas({ type: PREVIEW_MESSAGE.requestReady })
    return () => window.removeEventListener('message', onMessage)
  }, [toCanvas])

  useEffect(() => {
    setCanvasSlow(false)
    if (!state.document.sections.length || !canvasSource.versionId || canvasReady > 0) return
    const timer = window.setTimeout(() => setCanvasSlow(true), 20_000)
    return () => window.clearTimeout(timer)
  }, [canvasReady, canvasSource.versionId, canvasSource.epoch, state.document.sections.length])

  useEffect(() => {
    if (!focusCanvas) return
    const leave = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFocusCanvas(false)
    }
    const canvasDocument = isolated.enabled ? null : canvasRef.current?.contentDocument
    window.addEventListener('keydown', leave)
    canvasDocument?.addEventListener('keydown', leave, true)
    return () => {
      window.removeEventListener('keydown', leave)
      canvasDocument?.removeEventListener('keydown', leave, true)
    }
  }, [focusCanvas, canvasReady, isolated.enabled])

  useEffect(() => {
    if (isolated.enabled || !canvasReady) return
    const doc = canvasRef.current?.contentDocument
    const search = (event: KeyboardEvent) => {
      if (!isCommandSearchKey(event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event(COMMAND_SEARCH_EVENT))
    }
    doc?.addEventListener('keydown', search, true)
    return () => doc?.removeEventListener('keydown', search, true)
  }, [canvasReady, isolated.enabled])

  /**
   * Keep the canvas showing the document, whatever changed it.
   *
   * Deriving this from the document rather than from each handler is the whole
   * point: typing, reverting, undoing and redoing all end here, so none of them
   * can be the one transition that forgot to tell the canvas.
   */
  useEffect(() => {
    if (libraryStage.current) return
    const plan = planCanvasUpdate(shown.current, state.document, slotKind)
    for (const patch of plan.patches) {
      if (patch.kind === 'richtext') {
        if (isolated.enabled)
          toCanvas({
            type: 'cms:rich-patch',
            field: {
              section: patch.section,
              slot: patch.slot,
              value: patch.value,
              occurrence: 0,
              label: 'Rich text',
              disabled: false,
              x: null,
              y: null,
              constraints: richTextConstraints(state.document.sections[patch.section], patch.slot),
            },
          })
        else if (
          !patchCanvasRichText(
            canvasRef.current,
            patch.section,
            patch.slot,
            patch.value,
            richTextConstraints(state.document.sections[patch.section], patch.slot),
          )
        )
          needsRender.current = true
      } else toCanvas({ type: PREVIEW_MESSAGE.setValue, ...patch })
    }
    shown.current = state.document
    if (plan.render) needsRender.current = true
    // A canvas input followed immediately by Undo can be batched into a state
    // whose document is the same object as the preceding render. The iframe
    // still contains the input: run for the complete history transition, not
    // only when React observes a different document reference.
  }, [state, canvasReady, slotKind, richTextConstraints, toCanvas, isolated.enabled])

  useEffect(() => {
    if (
      richTextRequest &&
      (state.selection.section !== richTextRequest.section ||
        state.selection.slot !== richTextRequest.slot ||
        state.sectionOrigins[richTextRequest.section] !== richTextRequest.origin)
    )
      setRichTextRequest(null)
  }, [richTextRequest, state.selection, state.sectionOrigins])

  // Both re-applied on every canvas load, not only when they change: the
  // reloaded document has never been told either of them.
  useEffect(() => {
    toCanvas({
      type: PREVIEW_MESSAGE.setSelection,
      ...(libraryPreview ? { section: insertAt, slot: null } : state.selection),
    })
    const palette = getComputedStyle(document.documentElement)
    const tokens = Object.fromEntries(
      [
        'editor-select',
        'status-review',
        'surface',
        'text',
        'status-pending',
        'status-pending-bg',
        'space-1',
        'space-2',
        'space-3',
        'space-4',
        'target-small',
        'text-meta',
        'line-thin',
        'line-focus',
        'radius-control',
      ].map(key => [key, palette.getPropertyValue('--' + key).trim()]),
    )
    toCanvas({ type: PREVIEW_MESSAGE.setViewport, viewport, scale: previewScale, tokens })
  }, [state.selection, viewport, previewScale, canvasReady, toCanvas, libraryPreview, insertAt])

  useLayoutEffect(() => {
    if (!canvasReady) return
    if (!siteWide?.editing) {
      setCanvasFramePending(false)
      return
    }
    if (isolated.enabled) {
      setCanvasFramePending(true)
      return
    }
    const doc = canvasRef.current?.contentDocument
    if (!doc) return
    const selector = '[data-cms-frame="' + siteWide.part + '"][data-cms-sitewide]'
    if (doc.querySelector(selector)) return
    setCanvasFramePending(true)
    const observer = new MutationObserver(() => {
      if (canvasRef.current?.contentDocument === doc && doc.querySelector(selector)) {
        observer.disconnect()
        setCanvasFramePending(false)
      }
    })
    observer.observe(doc.documentElement, { attributes: true, subtree: true })
    return () => observer.disconnect()
  }, [siteWide?.editing, siteWide?.part, canvasReady, isolated.enabled])
  useEffect(() => {
    toCanvas({ type: PREVIEW_MESSAGE.setFrameEditing, part: siteWide?.editing ? siteWide.part : null })
  }, [siteWide, canvasReady, toCanvas])

  // The name each section shows on the canvas: its private label, or its
  // layout's name. Sent on every load and edit, so a label typed in the
  // inspector appears on the canvas at once without a render.
  const canvasLabels = state.document.sections
    .map((section, index) => {
      const layout = slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))
      const field =
        index === state.selection.section && state.selection.slot
          ? slotForId(layout?.slots ?? [], section.values, state.selection.slot)
          : null
      return sectionDisplayName(section, layout) + (field ? ' · ' + field.label : '')
    })
    .join('\u0000')
  useEffect(() => {
    toCanvas({ type: PREVIEW_MESSAGE.setLabels, labels: canvasLabels.split('\u0000') })
  }, [canvasLabels, canvasReady, toCanvas])

  /**
   * Render the canvas again, from what the server has just stored.
   *
   * Only ever called with an acknowledged snapshot and the version id that
   * write returned. Pointing it at the id this page was loaded with would
   * re-fetch the draft as it stood when the editor opened, which is a render of
   * the work rather than of the work as it is now.
   */
  const renderCanvas = useCallback((snapshot: EditorDocument) => {
    setRichTextRequest(null)
    setCanvasFramePending(true)
    setCanvasReady(0)
    rendered.current = snapshot
    needsRender.current = false
    setCanvasSource(current => ({ versionId: savedVersionId.current, epoch: current.epoch + 1 }))
  }, [])

  async function withCanvasValues(action: () => void | Promise<void>): Promise<void> {
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush())) {
      setResult({
        ok: false,
        kind: 'error',
        message: 'The page preview did not answer. Your draft is still here. Reload the preview before trying again.',
      })
      return
    }
    await action()
  }
  function changeHistory(forward: boolean) {
    void withCanvasValues(() => {
      setState(current => (forward ? redo(current) : undo(current)))
    })
  }

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

  // ------------------------------------------------------------- keyboard

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        libraryStage.current ||
        sectionTool !== null ||
        upgrade !== null ||
        replacement !== null ||
        siteWideCurrent.current?.editing
      )
        return
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"]')) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      // ⌘Z / ⌘⇧Z across every edit operation, not only typing (SPEC §6.4).
      changeHistory(event.shiftKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [upgrade, replacement, sectionTool])

  /**
   * The browser's own "are you sure" for work the server has not acknowledged.
   *
   * Autosave means this almost never fires, and "almost never" is the reason it
   * has to exist: the case it covers is the one where autosave could not run —
   * a conflict has stopped the loop, or the last request failed — which is
   * exactly when the work on screen is the only copy of it.
   */
  useEffect(() => {
    function onLeave(event: BeforeUnloadEvent) {
      if (
        dirty ||
        saving ||
        queue.current.busy() ||
        transitionPending ||
        upgrade?.busy ||
        replacement?.busy ||
        recovery.pending()
      )
        event.preventDefault()
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [dirty, saving, transitionPending, upgrade?.busy, replacement?.busy, recovery.writePending, recovery.busy])

  // -------------------------------------------------------------- saving

  const save = useCallback(
    async (kind: 'autosave' | 'checkpoint', override?: SaveSnapshot): Promise<ActionResult | null> => {
      if (requiresReload) return null
      // Capture exactly what is being sent. Everything below commits *this*,
      // never "whatever the document is when the response arrives" — text typed
      // during the request has not been saved and must stay dirty.
      const snapshot: SaveSnapshot = override ?? {
        document: state.document,
        sectionOrigins: state.sectionOrigins,
      }
      setSaving(true)

      let queued
      try {
        queued = await queue.current.enqueue({
          snapshot,
          run: async (currentRevision, sending) => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('content', JSON.stringify(sending.document.sections))
            data.set('meta', JSON.stringify(sending.document.meta))
            data.set('kind', kind)
            if (sending.document.identity) data.set('identity', JSON.stringify(sending.document.identity))

            const outcome = await savePageDraft(data)
            // An autosave that worked says so in the indicator and nowhere else.
            //
            // Raising the banner for every autosave meant a green "All changes
            // saved" bar appeared a second and a half after every keystroke and
            // stayed until something else replaced it — permanent chrome
            // announcing the thing the saved-state indicator is already there to
            // announce, and pushing the page down to do it. A *failed* autosave
            // still raises it, because that is news.
            if (kind === 'checkpoint' || !outcome.ok) setResult(outcome)
            // Recorded here rather than after the queue resolves, because this
            // is the response that knows which version it wrote.
            if (outcome.ok && outcome.versionId) {
              savedVersionId.current = outcome.versionId
              // Approval belongs to the exact immutable version that was
              // reviewed. Every successful save creates another one.
              setApprovedVersionId(null)
              // Moving the draft head supersedes an open submission in the
              // database trigger. Mirror that fact immediately in the toolbar.
              setReview(current => (current?.versionId === outcome.versionId ? current : null))
            }
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })
      } catch (error) {
        // A rejected request used to leave `saving` true forever, which
        // disabled autosave and the Save button and left the indicator on
        // "Saving…" while the work was unsaved — the worst shape a failure
        // could take.
        const failure = draftSaveFailure(error)
        if (failure.requiresReload) setRequiresReload(true)
        setResult({ ok: false, kind: 'error', message: failure.message })
        return null
      } finally {
        setSaving(queue.current.busy())
      }

      if (queued.status !== 'acknowledged') return null

      setRevision(queued.revision)
      setState(current => commitSaved(current, queued.snapshot.document))

      // The moment the canvas can be brought up to date: the values it could
      // not be given are now in a stored version the renderer can read.
      if (needsRender.current) renderCanvas(queued.snapshot.document)
      return { ok: true, revision: queued.revision, versionId: null, message: 'saved' }
    },
    [props.pageId, state.document, state.sectionOrigins, renderCanvas, requiresReload],
  )

  const latestSave = useRef(save)
  latestSave.current = save

  async function savePageBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    let result: { ok: boolean; message?: string } = {
      ok: false,
      message: 'The page preview did not answer. Keep editing and reload its preview before leaving.',
    }
    await withCanvasValues(async () => {
      const current = currentEditor.current,
        captured = structuredClone(current.document),
        snapshot = pageLeaveSnapshot(
          { document: current.document, sectionOrigins: current.sectionOrigins },
          openingSnapshot.current!,
          slotsByDef,
        )
      if (!deepEqual(snapshot.document, current.document))
        setState(state => (deepEqual(state.document, captured) ? { ...state, document: snapshot.document } : state))
      if (deepEqual(snapshot.document, current.saved)) {
        result = { ok: true }
        return
      }
      const outcome = await latestSave.current('checkpoint', snapshot)
      if (!outcome?.ok) {
        result = {
          ok: false,
          message:
            'The draft could not be saved. Keep editing to check the message and your saved history before trying again.',
        }
        return
      }
      const now = currentEditor.current.document
      if (!deepEqual(now, captured) && !deepEqual(now, snapshot.document)) {
        result = {
          ok: false,
          message: 'More edits arrived while saving. Keep editing and check the latest draft before leaving.',
        }
        return
      }
      result = { ok: true }
    })
    return result
  }
  async function discardPageBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    const snapshot = structuredClone(openingSnapshot.current!)
    const outcome = await latestSave.current('checkpoint', snapshot)
    if (!outcome?.ok)
      return {
        ok: false,
        message: 'Your edits could not be discarded. Keep editing and check the saved history before trying again.',
      }
    setState(() => ({
      ...createEditorState(snapshot.document),
      sectionOrigins: [...snapshot.sectionOrigins],
      baselineOrigins: [...snapshot.sectionOrigins],
    }))
    renderCanvas(snapshot.document)
    return { ok: true }
  }

  // Debounced autosave. A conflict stops the loop rather than retrying into it.
  const blocked = requiresReload || (result?.ok === false && result.kind === 'conflict')
  useEffect(() => {
    if (!dirty || saving || blocked || upgrade !== null || replacement !== null || sectionTool !== null) return
    const timer = setTimeout(() => void save('autosave'), needsRender.current ? CANVAS_RENDER_MS : AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [dirty, saving, blocked, save, upgrade, replacement, sectionTool])

  /** Section reviews compare against an acknowledged version. A clean preview
   * is read-only: making an identical checkpoint here would unnecessarily
   * supersede a submission waiting for review. The apply commands guarantee
   * the recovery checkpoint when a change is accepted. */
  async function flushForReview(): Promise<boolean> {
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush()))
      return false
    if (isDirty(currentEditor.current)) return (await latestSave.current('checkpoint')) !== null
    return queue.current
      .enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async currentRevision => ({ ok: true, revision: currentRevision }),
      })
      .then(result => result.status === 'acknowledged')
      .finally(() => setSaving(queue.current.busy()))
  }

  const openPagePublishReview = () => {
    if (reviewFlight.current || transitionPending) return
    reviewFlight.current = true
    setReviewBusy(true)
    setResult(null)
    setPageReview(null)
    startTransition(async () => {
      try {
        if (!(await flushForReview())) return
        const versionId = savedVersionId.current,
          currentRevision = String(queue.current.revision())
        if (!versionId) {
          setResult({ ok: false, kind: 'error', message: 'Save a draft before reviewing this page.' })
          return
        }
        const outcome = await loadPageSavedReview(props.pageId, currentRevision, versionId)
        if (!outcome.ok) {
          setResult({ ok: false, kind: 'error', message: outcome.message })
          return
        }
        if (
          isDirty(currentEditor.current) ||
          queue.current.busy() ||
          versionId !== savedVersionId.current ||
          currentRevision !== String(queue.current.revision())
        ) {
          setResult({
            ok: false,
            kind: 'error',
            message: 'You made more edits while changes were checked. Save the latest draft and choose Publish again.',
          })
          return
        }
        setResult(null)
        setPageReview(outcome)
        setPublishReviewOpen(true)
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The saved changes could not be checked. Your draft is still here. Try again before publishing.',
        })
      } finally {
        reviewFlight.current = false
      }
    })
  }
  const confirmPagePublishReview = () => {
    setPublishReviewOpen(false)
    if (
      !pageReview ||
      isDirty(currentEditor.current) ||
      queue.current.busy() ||
      pageReview.versionId !== savedVersionId.current ||
      pageReview.revision !== String(queue.current.revision())
    ) {
      setResult({
        ok: false,
        kind: 'error',
        message: 'The page changed after review. Save the latest draft and choose Publish again.',
      })
      return
    }
    publish()
  }

  const schedulePageReview = () => {
    if (scheduleFlight.current || transitionPending) return
    scheduleFlight.current = true
    setScheduling(true)
    setScheduleFirstReview(false)
    setResult(null)
    startTransition(async () => {
      try {
        if (!(await flushForReview())) return
        const versionId = savedVersionId.current
        if (!versionId) {
          setResult({ ok: false, kind: 'error', message: 'Save a draft before scheduling this page.' })
          return
        }
        const currentRevision = String(queue.current.revision()),
          signature = versionId + ':' + currentRevision
        if (scheduleRequest.current?.signature !== signature)
          scheduleRequest.current = { signature, id: crypto.randomUUID() }
        setResult({
          ok: true,
          revision: Number(currentRevision),
          versionId,
          message: 'Preparing the saved page review. Nothing is scheduled yet. This can take up to a minute…',
        })
        const outcome = await preparePageSchedule(props.pageId, currentRevision, versionId, scheduleRequest.current.id)
        if (!outcome.ok) {
          setScheduleFirstReview('firstSiteReview' in outcome && outcome.firstSiteReview === true)
          setResult({ ok: false, kind: 'error', message: outcome.message })
          return
        }
        if (
          isDirty(currentEditor.current) ||
          queue.current.busy() ||
          savedVersionId.current !== versionId ||
          String(queue.current.revision()) !== currentRevision
        ) {
          setResult({
            ok: false,
            kind: 'error',
            message:
              'You made more edits while the review was prepared. Save the latest draft and choose Schedule again. Nothing is scheduled.',
          })
          return
        }
        router.push('/sites/' + outcome.siteId + '/publishing?release=' + outcome.releaseId + '&intent=schedule')
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The review could not be confirmed. Your saved draft is private. Check Publish before retrying.',
        })
      } finally {
        scheduleFlight.current = false
      }
    })
  }

  async function reviewSectionUpgrade(index: number, targetVersion: number) {
    const generation = ++upgradeGeneration.current
    setUpgrade({ request: null, preview: null, busy: false })
    const saved = await flushForReview()
    if (generation !== upgradeGeneration.current) return
    if (!saved || !savedVersionId.current) {
      setUpgrade({
        request: null,
        preview: { ok: false, message: 'Save the current page successfully before reviewing a section update.' },
        busy: false,
      })
      return
    }
    const request = {
      pageId: props.pageId,
      sourceVersionId: savedVersionId.current,
      index,
      targetVersion,
      previewContext: sitePreview,
    }
    try {
      const preview = await previewSectionUpgrade(request)
      if (generation === upgradeGeneration.current) setUpgrade({ request, preview, busy: false })
    } catch {
      if (generation === upgradeGeneration.current)
        setUpgrade({
          request,
          preview: { ok: false, message: 'The preview could not be loaded. Your current page is unchanged.' },
          busy: false,
        })
    }
  }
  async function applyReviewedUpgrade() {
    if (!upgrade?.request || !upgrade.preview?.ok || upgrade.busy) return
    const request = upgrade.request
    setUpgrade({ ...upgrade, busy: true })
    try {
      const outcome = await queue.current.enqueue({
        snapshot: { document: state.document, sectionOrigins: state.sectionOrigins },
        run: async currentRevision => {
          const saved = await applySectionUpgrade(request, currentRevision)
          setResult(saved)
          if (!saved.ok) setUpgrade({ request, preview: { ok: false, message: saved.message }, busy: false })
          return saved.ok ? { ok: true, revision: saved.revision } : { ok: false, conflict: saved.kind === 'conflict' }
        },
      })
      if (outcome.status === 'acknowledged')
        window.location.assign(
          `/pages/${props.pageId}?section=${request.index}&site=${sitePreviewContext(request.previewContext)}`,
        )
      else setUpgrade(current => (current ? { ...current, busy: false } : null))
    } catch {
      setUpgrade({
        request,
        preview: { ok: false, message: 'The result could not be confirmed. Reload the page before trying again.' },
        busy: false,
      })
    }
  }

  // ------------------------------------------------ update imported fields

  /** EDIT-02: move an imported section to the current field mapping. The
   * server recomputes and checks everything; this saves first so the review is
   * of an acknowledged version, then applies the saved section as an edit. */
  async function reviewFieldUpdate(index: number) {
    const generation = ++fieldUpdateGeneration.current
    setFieldUpdate({ request: null, preview: null, busy: false })
    const saved = await flushForReview()
    if (generation !== fieldUpdateGeneration.current) return
    if (!saved || !savedVersionId.current) {
      setFieldUpdate({
        request: null,
        preview: { ok: false, message: 'Save the current page successfully before updating these fields.' },
        busy: false,
      })
      return
    }
    const request = {
      pageId: props.pageId,
      sourceVersionId: savedVersionId.current,
      index,
      previewContext: sitePreview,
    }
    try {
      const preview = await previewImportedFieldUpdate(request)
      if (generation === fieldUpdateGeneration.current) setFieldUpdate({ request, preview, busy: false })
    } catch {
      if (generation === fieldUpdateGeneration.current)
        setFieldUpdate({
          request,
          preview: { ok: false, message: 'The update could not be reviewed. Your page is unchanged.' },
          busy: false,
        })
    }
  }
  async function applyFieldUpdate() {
    const current = fieldUpdate
    if (!current?.request || !current.preview?.ok || current.busy) return
    const request = current.request
    if (isDirty(currentEditor.current) || savedVersionId.current !== request.sourceVersionId) {
      setFieldUpdate({
        ...current,
        preview: {
          ok: false,
          message: 'The page changed after this review. Close this window and review the update again.',
        },
      })
      return
    }
    setFieldUpdate({ ...current, busy: true })
    const applied: { result?: Extract<ImportedUpdateResult, { ok: true }> } = {}
    try {
      const outcome = await queue.current.enqueue({
        snapshot: { document: state.document, sectionOrigins: state.sectionOrigins },
        run: async currentRevision => {
          const result = await applyImportedFieldUpdate(request, currentRevision)
          if (!result.ok) {
            setFieldUpdate({ request, preview: { ok: false, message: result.message }, busy: false })
            return { ok: false, conflict: result.kind === 'conflict' }
          }
          applied.result = result
          savedVersionId.current = result.versionId
          setApprovedVersionId(null)
          setReview(existing => (existing?.versionId === result.versionId ? existing : null))
          return { ok: true, revision: result.revision }
        },
      })
      const done = applied.result
      if (outcome.status !== 'acknowledged' || !done) {
        setFieldUpdate(existing => (existing ? { ...existing, busy: false } : null))
        return
      }
      // As with a layout change: the saved section becomes an ordinary edit on
      // the acknowledged document, so Undo restores the earlier fields.
      setReplacementDefinitions(previous => [...previous, done.definition])
      const next = setSelection(replaceSection(currentEditor.current, request.index, done.section), {
        section: request.index,
        slot: null,
      })
      setState(commitSaved(next, next.document))
      setRevision(outcome.revision)
      renderCanvas(next.document)
      setResult({ ok: true, revision: done.revision, versionId: done.versionId, message: done.message })
      setFieldUpdate(null)
      setPane('inspector')
    } catch {
      setFieldUpdate({
        request,
        preview: { ok: false, message: 'The result could not be confirmed. Reload the page before trying again.' },
        busy: false,
      })
    }
  }

  // ------------------------------------------------------- change layout

  async function openLayoutChoice(index: number) {
    const origin = currentEditor.current.sectionOrigins[index]
    if (!origin) return
    setFocusCanvas(false)
    setLayoutChooser({ origin, options: null, error: null })
    if (!(await flushForReview()) || !savedVersionId.current) {
      setLayoutChooser({ origin, options: null, error: 'Save the page successfully before changing a layout.' })
      return
    }
    const position = currentEditor.current.sectionOrigins.indexOf(origin)
    if (position < 0) {
      setLayoutChooser(null)
      return
    }
    const result = await listCompatibleSectionLayouts({
      pageId: props.pageId,
      sourceVersionId: savedVersionId.current,
      index: position,
      previewContext: sitePreview,
    })
    setLayoutChooser(current =>
      current?.origin === origin
        ? { origin, options: result.ok ? result.options : null, error: result.ok ? null : result.message }
        : current,
    )
  }
  async function loadReplacementPreview(request: ReplacementRequest, generation: number) {
    try {
      const preview = await previewSectionReplacement(request)
      if (generation === replacementGeneration.current)
        setReplacement({ request, preview, busy: false, refreshing: false })
    } catch {
      if (generation === replacementGeneration.current) {
        setReplacement({
          request,
          preview: { ok: false, message: 'The layout preview could not be loaded. Your page is unchanged.' },
          busy: false,
          refreshing: false,
        })
      }
    }
  }
  async function reviewLayoutChange(origin: string, entry: LibraryEntry) {
    setLibraryOpen(false)
    setLayoutTarget(null)
    const generation = ++replacementGeneration.current
    setReplacement({ request: null, preview: null, busy: false, refreshing: false })
    const saved = await flushForReview()
    if (generation !== replacementGeneration.current) return
    const index = currentEditor.current.sectionOrigins.indexOf(origin)
    if (!saved || !savedVersionId.current || index === -1) {
      setReplacement({
        request: null,
        preview: {
          ok: false,
          message:
            index === -1
              ? 'That section is no longer on this page.'
              : 'Save the current page successfully before changing a layout.',
        },
        busy: false,
        refreshing: false,
      })
      return
    }
    await loadReplacementPreview(
      {
        pageId: props.pageId,
        sourceVersionId: savedVersionId.current,
        index,
        targetDefinitionId: entry.section_def_id,
        previewContext: sitePreview,
      },
      generation,
    )
  }
  /** A changed choice invalidates the preview until the server renders it. */
  function remapReplacement(fieldId: string, sourceId: string | null) {
    if (!replacement?.request || !replacement.preview?.ok || replacement.busy) return
    const chosen = replacement.request.mapping
    const mapping = Object.fromEntries(
      replacement.preview.fields.map(field => [
        field.id,
        field.id === fieldId
          ? sourceId
          : chosen && Object.hasOwn(chosen, field.id)
            ? (chosen[field.id] ?? null)
            : field.sourceId,
      ]),
    )
    const request = { ...replacement.request, mapping }
    const generation = ++replacementGeneration.current
    setReplacement({ ...replacement, request, refreshing: true })
    void loadReplacementPreview(request, generation)
  }
  async function applyLayoutChange() {
    const current = replacement
    if (!current?.request || !current.preview?.ok || current.busy || current.refreshing) return
    const request = current.request
    if (isDirty(currentEditor.current) || savedVersionId.current !== request.sourceVersionId) {
      setReplacement({
        ...current,
        preview: {
          ok: false,
          message: 'The page changed after this preview. Close this window and review the layout change again.',
        },
      })
      return
    }
    setReplacement({ ...current, busy: true })
    const applied: { result?: Extract<ReplacementResult, { ok: true }> } = {}
    try {
      const outcome = await queue.current.enqueue({
        snapshot: { document: state.document, sectionOrigins: state.sectionOrigins },
        run: async currentRevision => {
          const result = await applySectionReplacement(request, currentRevision)
          if (!result.ok) {
            setReplacement({ request, preview: { ok: false, message: result.message }, busy: false, refreshing: false })
            return { ok: false, conflict: result.kind === 'conflict' }
          }
          applied.result = result
          savedVersionId.current = result.versionId
          setApprovedVersionId(null)
          setReview(existing => (existing?.versionId === result.versionId ? existing : null))
          return { ok: true, revision: result.revision }
        },
      })
      const done = applied.result
      if (outcome.status !== 'acknowledged' || !done) {
        setReplacement(existing => (existing ? { ...existing, busy: false } : null))
        return
      }
      // The server saved exactly this section. Applying it as an ordinary edit
      // on top of the acknowledged document keeps Undo, Redo, “Undo my changes”
      // and the changed markers working, and marks the result already saved.
      setReplacementDefinitions(previous => [...previous, done.definition])
      const next = setSelection(replaceSection(currentEditor.current, request.index, done.section), {
        section: request.index,
        slot: null,
      })
      setState(commitSaved(next, next.document))
      setRevision(outcome.revision)
      renderCanvas(next.document)
      setResult({ ok: true, revision: done.revision, versionId: done.versionId, message: done.message })
      setReplacement(null)
      setPane('inspector')
    } catch {
      setReplacement({
        request,
        preview: { ok: false, message: 'The result could not be confirmed. Reload the page before trying again.' },
        busy: false,
        refreshing: false,
      })
    }
  }

  /** `together` publishes the page with what it needs to go live (see publish-together.ts);
   * `siteWide` when that includes the site's design, header, footer and menu. */
  const publish = (overrideReason?: string, together = false, siteWide = false, samplesConfirmed = false) => {
    if (remainingSamples.length && !samplesConfirmed) {
      setSampleConfirmation({ ...(overrideReason ? { overrideReason } : {}), together, siteWide })
      return
    }
    setResult(null)
    startTransition(async () => {
      try {
        // Publishing goes through the same queue, so it can never overtake an
        // autosave already in flight or reuse a revision that autosave consumed.
        // Saving first also guarantees it publishes what is on screen.
        if (
          isolatedCurrent.current.enabled &&
          !canvasRefreshBlocked.current &&
          !(await isolatedCurrent.current.flush())
        )
          return
        if (isDirty(currentEditor.current)) {
          const saved = await latestSave.current('checkpoint')
          if (!saved) return // a conflict or failure; the notice is already up
        }

        const snapshot: SaveSnapshot = {
          document: currentEditor.current.document,
          sectionOrigins: currentEditor.current.sectionOrigins,
        }
        const queued = await queue.current.enqueue({
          snapshot,
          run: async (currentRevision, sending) => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('content', JSON.stringify(sending.document.sections))
            data.set('metaTitle', sending.document.meta.title ?? '')
            data.set('metaDescription', sending.document.meta.description ?? '')
            if (overrideReason) data.set('overrideReason', overrideReason)
            if (samplesConfirmed) data.set('sampleContentConfirmed', 'true')

            const outcome = together ? await publishPageTogether(data) : await publishPage(data)
            setResult(outcome)
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })

        if (queued.status !== 'acknowledged') return
        setRevision(queued.revision)
        setPublishedVersionId(savedVersionId.current)
        openingSnapshot.current = structuredClone(queued.snapshot)
        // The saved site design just went live, so the live one is what to show.
        if (siteWide) changeSitePreview('published')
        // What is now live becomes the origin: after publishing, "what have I
        // changed" restarts from the snapshot that was actually published.
        setState(current => commitBaseline(current, queued.snapshot.document, queued.snapshot.sectionOrigins))
        // Publishing writes no new version, so this only ever has anything to do
        // when the save above left the canvas owed a render.
        if (needsRender.current) renderCanvas(queued.snapshot.document)
      } catch (error) {
        // Without this a failed publish produced an unhandled rejection and no
        // user-visible notice at all.
        setResult({
          ok: false,
          kind: 'error',
          message:
            'The publication result could not be confirmed. Reload and check the live page before trying again; the server may have completed the request.',
        })
      }
    })
  }

  const submitForReview = (note: string) => {
    startTransition(async () => {
      try {
        // A review request freezes an exact stored version. Save first so the
        // reviewer never receives yesterday's canvas with today's note.
        if (
          isolatedCurrent.current.enabled &&
          !canvasRefreshBlocked.current &&
          !(await isolatedCurrent.current.flush())
        )
          return
        if (isDirty(currentEditor.current)) {
          const saved = await latestSave.current('checkpoint')
          if (!saved) return
        }

        const snapshot: SaveSnapshot = {
          document: state.document,
          sectionOrigins: state.sectionOrigins,
        }
        let submittedVersion: string | null = null
        const queued = await queue.current.enqueue({
          snapshot,
          run: async currentRevision => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('note', note)
            const outcome = await submitPageForReview(data)
            setResult(outcome)
            if (outcome.ok && outcome.versionId) {
              submittedVersion = outcome.versionId
              savedVersionId.current = outcome.versionId
            }
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })
        if (queued.status !== 'acknowledged' || submittedVersion === null) return
        setRevision(queued.revision)
        setReview({ id: '', versionId: submittedVersion })
        setReviewFeedback(null)
      } catch (error) {
        setResult({
          ok: false,
          kind: 'error',
          message: `Could not submit for review: ${(error as Error).message}. Your draft is still saved.`,
        })
      }
    })
  }

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

  /**
   * Whether this draft needs a review, derived from what is on screen.
   *
   * The prop is what the server said about the version this page was loaded
   * with, which stops being true the moment somebody opens an escape hatch —
   * and waiting for the next autosave to find out would mean the warning
   * arrives after the work. Deriving it here is the UI "deriving
   * `carries_trusted_code`" that SPEC §6.4 asks for, and it is deliberately not
   * what anything is enforced on: the save recomputes it server-side and the
   * publication trigger recomputes it again.
   */
  // The loaded database flag is useful evidence during server loading, but the
  // client document is authoritative once this editor exists. Keeping the
  // initial flag in this expression made a page remain "custom code" forever
  // in the current session after the author removed its last escape hatch.
  const needsReview =
    carriesTrustedCode(state.document) || hasTrustedSectionTemplate(state.document.sections, slotsByDef)
  const approved = !dirty && approvedVersionId !== null && approvedVersionId === savedVersionId.current
  const hasWorkNotLive = dirty || savedVersionId.current !== publishedVersionId
  const submittedCurrent = review !== null && review.versionId === savedVersionId.current && !dirty

  async function previewLibraryEntry(entry: LibraryEntry | null, at = insertAt ?? state.document.sections.length) {
    if (libraryPreparing) return
    setLibraryError('')
    if (entry && (isolatedCurrent.current.enabled || entry.carries_trusted_code)) {
      setLibraryError('This code-based page needs a separate preview. Return to sections and choose a standard layout.')
      return
    }
    if (entry) {
      setLibraryPreparing(true)
      try {
        if (!(await flushForReview())) {
          setLibraryError('Save the current page before previewing a section.')
          return
        }
        setLibraryPreview(entry)
        setInsertAt(at)
        setRichTextRequest(null)
        setCanvasReady(0)
        setCanvasFramePending(true)
        setCanvasSource(current => ({ versionId: savedVersionId.current, epoch: current.epoch + 1 }))
      } catch {
        setLibraryError('This preview could not be prepared. Your page draft is still here.')
      } finally {
        setLibraryPreparing(false)
      }
    } else {
      setLibraryPreview(null)
      renderCanvas(currentEditor.current.saved)
    }
  }
  function closeNativeLibrary() {
    returnLibraryFocus.current = true
    setLibraryOpen(false)
    setLayoutTarget(null)
    setChoosingSectionSpot(false)
    setLibraryError('')
    if (libraryPreview) {
      setLibraryPreview(null)
      renderCanvas(currentEditor.current.saved)
    }
    setPane('canvas')
  }
  function changeLibrarySpot() {
    setChoosingSectionSpot(true)
    setLibraryOpen(false)
    setLibraryError('')
    if (libraryPreview) {
      setLibraryPreview(null)
      renderCanvas(currentEditor.current.saved)
    }
    setPane('inspector')
  }
  function openLibrary(at: number) {
    if (!canInsertAt(at)) return
    if (!libraryOpen)
      libraryOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFocusCanvas(false)
    setLayoutTarget(null)
    setInsertAt(at)
    setChoosingSectionSpot(false)
    setLibraryPreview(null)
    setLibraryError('')
    setLibraryOpen(true)
    setPane('library')
  }

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

  // The message listener is registered once; this always reaches the current
  // library and editor state.
  function placeLibraryEntry(sectionDefId: string, at: number) {
    if (
      !libraryOpen ||
      layoutTarget !== null ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > state.document.sections.length ||
      !canInsertAt(at)
    )
      return
    const entry = props.library.find(candidate => candidate.section_def_id === sectionDefId)
    if (!entry) return
    if (props.originalDesign) insertLibraryEntry(entry, at)
    else void previewLibraryEntry(entry, at)
  }
  dropOnCanvas.current = placeLibraryEntry

  function insertLibraryEntry(entry: LibraryEntry, at: number) {
    const next = addSection(
      state,
      {
        section_def_id: entry.section_def_id,
        section_def_version: entry.version,
        values: entry.starting_values ?? markSampleValues(sectionStartingValues(entry.slots)),
        hidden: false,
        hidden_at: [],
        label: entry.name,
      },
      at,
    )
    // The new section arrives selected, the way a dropped section does in v1.
    // Selection also tells the freshly rendered canvas what to scroll to.
    const firstField = entry.slots.find(slot => slot.kind === 'text')?.id ?? entry.slots[0]?.id ?? null
    pendingFieldFocus.current = firstField
    setState(setSelection(next, { section: at, slot: props.originalDesign ? firstField : null }))
    setLibraryOpen(false)
    setPane('inspector')
  }

  function insertPreparedRecipe(prepared: PreparedRecipeInsertion): string | null {
    const gap = recipeGap.current
    if (!gap || resolveSectionInsertionPoint(currentEditor.current, gap) === null) {
      return 'The page changed while this template was checked. Choose where to add it again.'
    }
    // PostgreSQL limits page content to 1 MiB. Indented JSON deliberately
    // overestimates its normalized representation to leave safe headroom.
    const content = [...currentEditor.current.document.sections, ...prepared.content]
    if (new TextEncoder().encode(JSON.stringify(content, null, 1)).byteLength > 1_048_576) {
      return 'This template would make the page too large to save. Choose a smaller template or remove some content first.'
    }
    setRecipeDefinitions(previous => [...previous, ...prepared.definitions])
    setState(current => {
      const at = resolveSectionInsertionPoint(current, gap)
      return at === null
        ? current
        : setSelection(addSections(current, prepared.content, at), { section: at, slot: null })
    })
    setLibraryOpen(false)
    setPane('inspector')
    return null
  }

  async function openVisitorPreview() {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setResult({ ok: false, kind: 'error', message: 'Allow a preview window in your browser, then try again.' })
      return
    }
    tab.opener = null
    tab.document.title = 'Opening preview…'
    tab.document.body.textContent = 'Preparing your saved page…'
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush())) {
      tab.close()
      return
    }
    if (isDirty(currentEditor.current) && !(await latestSave.current('checkpoint'))) {
      tab.close()
      return
    }
    const version = savedVersionId.current
    if (!version) {
      tab.close()
      return
    }
    const visitorOrigin = props.visitorPreviewOrigin ?? props.isolatedCanvasOrigin
    if (visitorOrigin) {
      try {
        const channel = crypto.randomUUID(),
          response = await fetch(`/api/pages/${props.pageId}/canvas`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'open',
              versionId: version,
              sitePreview,
              showHidden: previewHidden,
              channel,
            }),
          })
        const ticket = response.ok ? readCanvasTicket(await response.json(), visitorOrigin, channel) : null
        if (!ticket) throw Error('unavailable')
        isolatedCurrent.current.trackVisitor(tab, ticket)
        tab.location.replace(ticket.href + '?visit=1')
      } catch {
        tab.close()
        setResult({
          ok: false,
          kind: 'error',
          message: 'The saved page preview could not be opened. Your draft is still here. Try Preview again.',
        })
      }
    } else
      tab.location.replace(
        `/preview/${version}?visit=1&lists=draft&site=${sitePreview}&hidden=${previewHidden ? '1' : '0'}`,
      )
  }

  /** Where a chosen section will land, in words for the overlay's heading. */
  function placementLabel(at: number | null): string {
    const sections = state.document.sections
    const index = at ?? sections.length
    if (sections.length === 0) return 'as the first section on this page'
    if (index >= sections.length) return `after “${nameOf(sections[sections.length - 1]!)}”`
    if (index <= 0) return `before “${nameOf(sections[0]!)}”`
    return `between “${nameOf(sections[index - 1]!)}” and “${nameOf(sections[index]!)}”`
  }
  function nameOf(section: EditorSection): string {
    return sectionDisplayName(
      section,
      slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version)),
    )
  }

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
      const anchor = currentEditor.current.document.sections[index]?.values.__cms_anchor,
        identity = currentEditor.current.document.identity,
        path = identity ? (identity.address ? '/' + identity.address : '/') : props.metadataContext.path
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
      const section = copiedSection.section,
        definition = await copiedSectionLayout(props.pageId, section.section_def_id, section.section_def_version)
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
  async function duplicateCurrentPage() {
    if (transitionPending) return
    startTransition(async () => {
      if (!(await flushForReview())) return
      let destination: string | null = null
      const result = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async revision => {
          const copied = await duplicatePageAction(props.pageId, revision)
          if (!copied.ok) {
            setResult(copied)
            return { ok: false, conflict: copied.kind === 'conflict' }
          }
          destination = copied.pageId
          return { ok: true, revision }
        },
      })
      if (result.status === 'acknowledged' && destination) window.location.assign('/pages/' + destination)
      else if (result.status === 'failed')
        setResult({
          ok: false,
          kind: 'error',
          message: 'The page could not be duplicated. Check your connection and try again.',
        })
    })
  }
  async function saveDetails(input: PageDetailsInput) {
    if (!(await flushForReview())) return null
    let result: Awaited<ReturnType<typeof savePageDetailsAction>> | undefined
    const queued = await queue.current.enqueue({
      snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
      run: async revision => {
        result = await savePageDetailsAction(input, revision)
        if (!result.ok) {
          setResult(result)
          return { ok: false, conflict: result.kind === 'conflict' }
        }
        if (result.versionId) savedVersionId.current = result.versionId
        return { ok: true, revision: result.revision }
      },
    })
    if (queued.status === 'acknowledged' && result?.ok) {
      const identity = { title: result.title, address: result.address }
      const acknowledged = { ...queued.snapshot.document, identity }
      setState(current =>
        commitSaved(
          apply(current, draft => {
            draft.identity = identity
          }),
          acknowledged,
        ),
      )
      setRevision(result.revision)
      renderCanvas(acknowledged)
    }
    return (
      result ?? {
        ok: false as const,
        kind: 'error' as const,
        message: 'The page details could not be saved. Check your connection and try again.',
      }
    )
  }
  async function applyPageDanger() {
    if (!pageDanger || transitionPending) return
    startTransition(async () => {
      if (!(await flushForReview())) return
      const action = pageDanger
      const queued = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async revision => {
          const data = new FormData()
          data.set('pageId', props.pageId)
          data.set('revision', String(revision))
          const outcome = await (action === 'archive' ? archivePage(data) : unpublishPage(data))
          setResult(outcome)
          return outcome.ok
            ? { ok: true, revision: outcome.revision }
            : { ok: false, conflict: outcome.kind === 'conflict' }
        },
      })
      if (queued.status === 'acknowledged') {
        setRevision(queued.revision)
        setPublishedVersionId(null)
        setReview(null)
        setPageDanger(null)
        if (action === 'archive') window.location.assign(props.siteHref)
      }
    })
  }
  async function applyLiveReset(wholePage: boolean) {
    if (!publishedVersionId || resetting) return
    setResetting(true)
    try {
      if (!(await flushForReview())) return
      const index = sectionConfirmation ? currentEditor.current.sectionOrigins.indexOf(sectionConfirmation.origin) : -1
      if (!wholePage && index < 0) return
      let restored: Awaited<ReturnType<typeof resetPageFromLive>> | undefined
      const outcome = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async expectedRevision => {
          restored = await resetPageFromLive({
            pageId: props.pageId,
            expectedRevision,
            expectedLiveVersionId: publishedVersionId,
            ...(wholePage ? {} : { sectionIndex: index, liveSectionIndex: liveSourceIndex }),
          })
          if (!restored.ok) {
            setResult(restored)
            return { ok: false, conflict: restored.kind === 'conflict' }
          }
          savedVersionId.current = restored.versionId
          return { ok: true, revision: restored.revision }
        },
      })
      if (outcome.status !== 'acknowledged' || !restored?.ok) return
      const definitions = restored.definitions
      setReplacementDefinitions(previous => [...previous, ...definitions])
      const next = wholePage
        ? recoverDocument(currentEditor.current, restored.document)
        : replaceSection(currentEditor.current, index, restored.document.sections[index]!)
      setState(commitSaved(next, restored.document))
      setRevision(outcome.revision)
      setApprovedVersionId(null)
      setReview(null)
      renderCanvas(restored.document)
      setResult(restored)
      setSectionConfirmation(null)
      setDiscardConfirmation(false)
    } finally {
      setResetting(false)
    }
  }
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

  useEffect(() => {
    if (!isolated.enabled || !canvasReady) return
    const controls =
      libraryOpen || siteWide || sectionTool || canvasAwaitingRender
        ? null
        : {
            sections: state.document.sections.map(section => {
              const fields = (
                slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []
              ).filter(
                field =>
                  field.kind === 'repeat' &&
                  (repeatItemSpec(field) ||
                    typeof (section.values[field.id] as { readerKey?: unknown } | undefined)?.readerKey === 'string'),
              )
              return {
                id: section.section_def_id,
                version: section.section_def_version,
                label: nameOf(section),
                hidden: Boolean(section.hidden),
                fields: fields.map(field => ({
                  id: field.id,
                  kind: field.kind,
                  label: field.label,
                  constraints: field.constraints,
                })),
                values: Object.fromEntries(
                  fields.map(field => [
                    field.id,
                    repeatItemSpec(field)
                      ? { items: repeatItemKeys(section.values[field.id]) }
                      : {
                          readerKey: (section.values[field.id] as { readerKey?: string } | undefined)?.readerKey ?? '',
                        },
                  ]),
                ),
              }
            }),
            selected: state.selection.section,
            slot: state.selection.slot,
            listItem:
              listSelection?.section === state.selection.section
                ? { readerKey: listSelection.readerKey, stableKey: listSelection.stableKey, field: listSelection.field }
                : null,
            scale: previewScale,
            canReset: Boolean(publishedVersionId && props.liveSections.length),
            preserveLayout: !props.originalDesign,
          }
    toCanvas({ type: 'cms:canvas-controls', controls })
  }, [
    isolated.enabled,
    canvasReady,
    state.document,
    state.selection,
    listSelection,
    previewScale,
    slotsByDef,
    libraryOpen,
    siteWide,
    sectionTool,
    canvasAwaitingRender,
    publishedVersionId,
    props.liveSections.length,
    toCanvas,
  ])
  canvasOperations.current = { section: applyCanvasAction, repeat: applyCanvasRepeat }
  remoteActions.current = data => {
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
      const section = state.document.sections[index]!,
        field = slotsByDef
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

  const previewBreakpoint = previewWidth < 768 ? 'sm' : previewWidth < 1024 ? 'md' : 'lg'
  const visibilityView = { sm: 'phone', md: 'tablet', lg: 'desktop' }[previewBreakpoint]
  const hiddenSectionCount = state.document.sections.filter(
    section => section.hidden || section.hidden_at?.includes(previewBreakpoint),
  ).length

  const viewTools = (
    <>
      <div className="cluster" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className="icon-btn tip"
          data-tip="Undo (⌘Z)"
          aria-label="Undo"
          disabled={siteWide?.editing || !canUndo(state)}
          onClick={() => changeHistory(false)}
        >
          <IconUndo size={17} />
        </button>
        <button
          type="button"
          className="icon-btn tip"
          data-tip="Redo (⌘⇧Z)"
          aria-label="Redo"
          disabled={siteWide?.editing || !canRedo(state)}
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
      {/* One bar, read left to right as: where am I, what state is it in, what
          can I undo, what am I looking at, is it saved, and the two decisions.
          The clusters are separated by a hairline rather than by spacing alone,
          because a row of eight equally spaced controls is a row nobody can
          scan — which is what this was. */}
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
        <div
          className={'pane-tabs' + (!props.originalDesign ? ' ' + foundationStyles.nativePaneTabs : '')}
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
            layout={{
              sectionTool,
              libraryPreview,
              libraryPreparing,
              structureOpen,
              pane,
              structureCollapsed,
              setPane,
              setStructureOpen,
              setStructureWidth,
            }}
            sections={{
              canManageSections,
              props,
              state,
              sectionLocked,
              canInsertAt,
              canMoveSection,
              slotsByDef,
              siteWide,
              setSiteWide,
              setState,
              openLibrary,
              placeLibraryEntry,
              openPageSettings,
            }}
          />

          {/* The page sits on a recessed desk with a shadow, which is enough to
            say that what is inside is the website and what is outside is the
            tool. The emulated width changes the frame, so switching to Mobile
            visibly narrows a device rather than just reflowing some content. */}
          <div id="editor-panel-canvas" className="canvas-pane" role="tabpanel" aria-labelledby="editor-tab-canvas">
            {/* One slim row. Every line above the page is height the page does
              not get, and V1 gave the page nearly all of it. */}
            <div className={foundationStyles.canvasTools}>
              {!props.originalDesign && (
                <div className={'bar-tools ' + foundationStyles.nativeViewTools}>{viewTools}</div>
              )}
              <div ref={canvasItemToolbarRef} className={foundationStyles.contextTools} />
              <Button
                variant="tertiary"
                size="s"
                title={focusCanvas ? 'Show editing panels · Esc' : undefined}
                aria-pressed={focusCanvas}
                onClick={() => setFocusCanvas(current => !current)}
              >
                {focusCanvas ? 'Show editing panels' : 'Focus on page'}
              </Button>
            </div>

            {hiddenSectionCount > 0 && (
              <div className="canvas-visibility-note" role="status">
                <span>
                  <strong>
                    {hiddenSectionCount} {hiddenSectionCount === 1 ? 'section is' : 'sections are'} hidden from visitors
                    {visibilityView === 'desktop' ? '' : ` on ${visibilityView}`}.
                  </strong>{' '}
                  {showHiddenSections ? 'Shown here for editing.' : 'Select a hidden section in Structure to edit it.'}
                </span>
                <div className="actions">
                  <Button
                    variant="secondary"
                    size="s"
                    disabled={!showHiddenSections}
                    onClick={() => setShowHiddenSections(false)}
                  >
                    Preview without hidden
                  </Button>
                  <Button
                    variant="tertiary"
                    size="s"
                    onClick={() => {
                      setShowHiddenSections(true)
                      const index = state.document.sections.findIndex(
                        section => section.hidden || section.hidden_at?.includes(previewBreakpoint),
                      )
                      if (index >= 0) {
                        setState(setSelection(state, { section: index, slot: null }))
                        setPane('inspector')
                      }
                    }}
                  >
                    Show me
                  </Button>
                </div>
              </div>
            )}
            {activeRichText &&
              (isolated.enabled ? (
                <IsolatedRichTextToolbar
                  request={activeRichText}
                  value={String(state.document.sections[activeRichText.section]?.values[activeRichText.slot] ?? '')}
                  label={
                    slotForId(
                      slotsByDef.get(
                        sectionVersionKey(
                          state.document.sections[activeRichText.section]!.section_def_id,
                          state.document.sections[activeRichText.section]!.section_def_version,
                        ),
                      )?.slots ?? [],
                      state.document.sections[activeRichText.section]!.values,
                      activeRichText.slot,
                    )?.label ?? 'Rich text'
                  }
                  constraints={richTextConstraints(
                    state.document.sections[activeRichText.section],
                    activeRichText.slot,
                  )}
                  disabled={canvasHistoryBlocked.current}
                  active={remoteRichState}
                  unavailable={remoteRichUnavailable}
                  post={toCanvas}
                  onClose={() => setRichTextRequest(null)}
                />
              ) : (
                <CanvasRichText
                  frameRef={canvasRef}
                  request={activeRichText}
                  value={String(state.document.sections[activeRichText.section]?.values[activeRichText.slot] ?? '')}
                  label={(() => {
                    const section = state.document.sections[activeRichText.section]
                    return section
                      ? (slotForId(
                          slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))
                            ?.slots ?? [],
                          section.values,
                          activeRichText.slot,
                        )?.label ?? 'Rich text')
                      : 'Rich text'
                  })()}
                  constraints={richTextConstraints(
                    state.document.sections[activeRichText.section],
                    activeRichText.slot,
                  )}
                  disabled={
                    upgrade !== null ||
                    replacement !== null ||
                    overrideOpen ||
                    submitOpen ||
                    recovery.review !== null ||
                    recovery.busy
                  }
                  onChange={value => {
                    const { section, slot, origin } = activeRichText
                    if (currentEditor.current.sectionOrigins[section] !== origin) return
                    patchCanvasRichText(
                      canvasRef.current,
                      section,
                      slot,
                      value,
                      richTextConstraints(currentEditor.current.document.sections[section], slot),
                    )
                    shown.current = withCanvasValue(shown.current, section, slot, value)
                    setState(current => setValue(current, section, slot, value))
                  }}
                  onClose={() => setRichTextRequest(null)}
                />
              ))}
            <div
              className={'canvas-frame ' + foundationStyles.canvasFrame}
              style={{ maxWidth: `calc(${deviceWidth}px + var(--space-7))` }}
            >
              <div
                className={'canvas-viewport ' + foundationStyles.canvasViewport}
                data-zoom={zoom}
                inert={Boolean(sectionTool) || Boolean(libraryPreview) || libraryPreparing}
                ref={canvasViewportRef}
              >
                {(state.document.sections.length > 0 || libraryPreview) &&
                  canvasSource.versionId &&
                  (canvasReady === 0 || isolated.error) && (
                    <div className="canvas-loading" role={isolated.error ? 'alert' : 'status'}>
                      {canvasSlow || isolated.error ? (
                        <div className="canvas-loading-retry">
                          <p>{isolated.error ?? 'The page preview is taking longer than expected.'}</p>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() => renderCanvas(currentEditor.current.saved)}
                          >
                            Reload preview
                          </button>
                          <p className="muted">Your draft stays in the editor.</p>
                        </div>
                      ) : (
                        <span>Opening the page preview…</span>
                      )}
                    </div>
                  )}
                {(state.document.sections.length > 0 || libraryPreview) && canvasSource.versionId ? (
                  canvasAttached &&
                  (!isolated.enabled || isolated.href) && (
                    <iframe
                      key={canvasSource.epoch}
                      ref={canvasRef}
                      className="canvas"
                      title="Page canvas"
                      sandbox={isolated.enabled ? 'allow-scripts allow-same-origin' : undefined}
                      referrerPolicy={isolated.enabled ? 'no-referrer' : undefined}
                      onLoad={() => {
                        if (
                          !props.originalDesign &&
                          !isolatedCurrent.current.enabled &&
                          canvasRef.current?.contentDocument
                        )
                          installNativeFieldFeedback(canvasRef.current.contentDocument)
                        if (
                          libraryStage.current &&
                          canvasRef.current?.contentDocument &&
                          !canvasRef.current.contentDocument.querySelector('[data-cms-section]')
                        )
                          setLibraryError('This section preview could not be loaded. Try again, or return to sections.')
                        if (!isolatedCurrent.current.enabled) toCanvas({ type: PREVIEW_MESSAGE.requestReady })
                      }}
                      aria-description={`${VIEWPORTS[viewport].label} preview at ${previewWidth} pixels, ${zoom === 'fit' ? 'scaled to fit the editor' : 'at actual size'}`}
                      style={{
                        width: previewWidth,
                        height: canvasSize.height > 0 ? canvasSize.height / previewScale : '100%',
                        transform: `scale(${previewScale})`,
                      }}
                      src={
                        isolated.enabled
                          ? isolated.href!
                          : `/preview/${canvasSource.versionId}?v=${canvasSource.epoch}&hidden=${showHiddenSections ? '1' : '0'}&site=${sitePreview}${libraryPreview ? '&insert=' + libraryPreview.section_def_id + '&definitionVersion=' + libraryPreview.version + '&at=' + insertAt : ''}`
                      }
                    />
                  )
                ) : (
                  <div className="canvas-empty">
                    <div className="empty-icon">
                      <IconPlus size={22} />
                    </div>
                    <h2 style={{ margin: '0 0 .5rem', fontSize: '1.0625rem' }}>This page is empty</h2>
                    <p className="muted" style={{ maxWidth: '28rem', margin: '0 auto 1.25rem' }}>
                      {canManageSections
                        ? 'Add a section to start building it. Your draft stays private until you publish.'
                        : 'This page has no content fields yet.'}
                    </p>
                    {canManageSections ? (
                      <button type="button" onClick={() => openLibrary(0)}>
                        <IconPlus size={15} /> Add the first section
                      </button>
                    ) : (
                      <p>A Site admin can add the starting sections. Then you can edit their content here.</p>
                    )}
                  </div>
                )}
                {canvasAwaitingRender && canvasReady > 0 && (
                  <div className={foundationStyles.refreshing} role="status">
                    Updating page preview…
                  </div>
                )}
                {(!libraryOpen || (!props.originalDesign && layoutTarget === null && !libraryPreview)) &&
                  !siteWide &&
                  !sectionTool &&
                  !canvasAwaitingRender &&
                  canvasReady > 0 &&
                  !sectionLocked(selected) && (
                    <CanvasChrome
                      insertionMarker={libraryOpen ? insertAt : null}
                      choosingInsertion={choosingSectionSpot}
                      nativeSectionTools={!props.originalDesign}
                      canManageSections={canManageSections && !libraryOpen}
                      preserveLayout={!props.originalDesign}
                      canInsertAt={canInsertAt}
                      canMove={canMoveSection}
                      canRemove={canInsertAt}
                      mode={isolated.enabled ? 'toolbar-only' : 'full'}
                      hoveredItem={isolated.enabled ? remoteHover : undefined}
                      toolbarHost={canvasItemToolbarRef}
                      zoomControl={canvasZoomRef}
                      frame={canvasRef}
                      viewport={canvasViewportRef}
                      ready={canvasReady}
                      scale={previewScale}
                      sections={state.document.sections}
                      selected={libraryOpen ? null : selected}
                      selectedSlot={state.selection.slot}
                      slotsFor={section =>
                        slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ??
                        []
                      }
                      slots={
                        selected === null
                          ? []
                          : (slotsByDef.get(
                              sectionVersionKey(
                                state.document.sections[selected]!.section_def_id,
                                state.document.sections[selected]!.section_def_version,
                              ),
                            )?.slots ?? [])
                      }
                      name={nameOf}
                      onAdd={openLibrary}
                      onAction={canvasAction}
                      canReset={Boolean(publishedVersionId && props.liveSections.length)}
                      onRepeat={canvasRepeat}
                      selectedItem={listSelection?.section === selected ? listSelection : null}
                      onListAction={listAction}
                      onListAdd={readerKey => setInlineList({ readerKey, unit: listUnit(readerKey) })}
                    />
                  )}
              </div>
            </div>
            <div ref={canvasZoomRef} className={foundationStyles.zoom} role="group" aria-label="Canvas zoom">
              <IconButton
                tooltip="Zoom out"
                variant="tertiary"
                size="s"
                disabled={zoom === 'actual' && manualScale <= 0.25}
                onClick={() => {
                  setManualScale(Math.max(0.25, previewScale - 0.1))
                  setZoom('actual')
                }}
              >
                −
              </IconButton>
              <Button
                variant="tertiary"
                size="s"
                onClick={() => {
                  setManualScale(1)
                  setZoom('actual')
                }}
                aria-label="Zoom to actual size"
              >
                {Math.round(previewScale * 100)}%
              </Button>
              <IconButton
                tooltip="Zoom in"
                variant="tertiary"
                size="s"
                disabled={zoom === 'actual' && manualScale >= 2}
                onClick={() => {
                  setManualScale(Math.min(2, previewScale + 0.1))
                  setZoom('actual')
                }}
              >
                +
              </IconButton>
              <Button variant="tertiary" size="s" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
                Fit
              </Button>
            </div>
          </div>

          <ResizablePanel
            key={libraryOpen ? 'library' : 'inspector'}
            storageKey={libraryOpen ? 'cms-r8-library-width' : 'cms-r8-inspector-width'}
            label={libraryOpen ? 'library' : 'inspector'}
            min={320}
            max={
              props.originalDesign
                ? libraryOpen
                  ? 900
                  : 720
                : Math.min(libraryOpen ? 900 : 720, Math.max(320, workspaceWidth - structureWidth - 240))
            }
            initial={libraryOpen ? (props.originalDesign ? 520 : 400) : 360}
            edge={libraryOpen && !props.originalDesign && layoutTarget === null ? 'right' : 'left'}
            onWidthChange={setRightWidth}
            className={panelStyles.right}
          >
            {libraryOpen && !props.originalDesign && layoutTarget === null ? (
              <PageSectionLibrary
                siteId={props.siteId}
                onFavouriteChange={(id, value) => setLibraryFavourites(previous => ({ ...previous, [id]: value }))}
                library={props.library.map(entry => ({
                  ...entry,
                  name: sectionLibraryName(entry),
                  is_favourite: libraryFavourites[entry.section_def_id] ?? entry.is_favourite,
                }))}
                placement={placementLabel(insertAt)}
                at={insertAt ?? state.document.sections.length}
                placements={Array.from({ length: state.document.sections.length + 1 }, (_, at) => ({
                  at,
                  label: placementLabel(at),
                })).filter(p => canInsertAt(p.at))}
                preview={libraryPreview}
                preparing={libraryPreparing}
                ready={canvasReady > 0 && !canvasFramePending}
                error={libraryError}
                onPreview={entry => void previewLibraryEntry(entry)}
                onAdd={() => {
                  if (libraryPreview && canvasReady > 0 && !libraryPreparing) {
                    const entry = libraryPreview
                    setLibraryPreview(null)
                    insertLibraryEntry(entry, insertAt ?? state.document.sections.length)
                  }
                }}
                onClose={closeNativeLibrary}
                onChangeSpot={changeLibrarySpot}
                onMove={at => void previewLibraryEntry(libraryPreview, at)}
                pasteControl={
                  copiedSection ? (
                    <Button variant="secondary" loading={pasting} onClick={() => void pasteSection()}>
                      Paste copied section {placementLabel(insertAt)}
                    </Button>
                  ) : undefined
                }
                recipeControl={
                  <RecipePicker
                    siteId={props.siteId}
                    allowedDefinitionIds={
                      props.chapterPage ? props.library.map(entry => entry.section_def_id) : undefined
                    }
                    onBegin={() => {
                      recipeGap.current = captureSectionInsertionPoint(
                        currentEditor.current,
                        insertAt ?? state.document.sections.length,
                      )
                    }}
                    onInsert={insertPreparedRecipe}
                  />
                }
              />
            ) : libraryOpen ? (
              <LibraryOverlay
                siteId={props.siteId}
                previewContext={sitePreview}
                library={props.library.map(entry => ({
                  ...entry,
                  is_favourite: libraryFavourites[entry.section_def_id] ?? entry.is_favourite,
                }))}
                onFavouriteChange={(id, favourite) =>
                  setLibraryFavourites(previous => ({ ...previous, [id]: favourite }))
                }
                pasteControl={
                  copiedSection ? (
                    <Button variant="secondary" size="s" loading={pasting} onClick={() => void pasteSection()}>
                      Paste copied section {placementLabel(insertAt)}
                    </Button>
                  ) : undefined
                }
                mode={replacingSection ? 'replace' : 'insert'}
                excludeDefinitionId={replacingSection?.section_def_id}
                onChangePlacement={setInsertAt}
                placementIndex={insertAt ?? state.document.sections.length}
                placements={[
                  { at: state.document.sections.length, label: 'End of page' },
                  ...state.document.sections.map((section, index) => ({
                    at: index,
                    label:
                      index === 0
                        ? `Before ${nameOf(section)} (start of page)`
                        : `After ${nameOf(state.document.sections[index - 1]!)}`,
                  })),
                ].filter(option => canInsertAt(option.at))}
                placement={replacingSection ? `for “${nameOf(replacingSection)}”` : placementLabel(insertAt)}
                recipeControl={
                  replacingSection ? undefined : (
                    <RecipePicker
                      siteId={props.siteId}
                      onBegin={() => {
                        const current = currentEditor.current
                        recipeGap.current = captureSectionInsertionPoint(
                          current,
                          insertAt ?? current.document.sections.length,
                        )
                      }}
                      onInsert={insertPreparedRecipe}
                    />
                  )
                }
                onClose={() => {
                  setLibraryOpen(false)
                  setLayoutTarget(null)
                  setPane('canvas')
                }}
                onChoose={entry =>
                  layoutTarget !== null && replacingSection
                    ? void reviewLayoutChange(layoutTarget, entry)
                    : insertLibraryEntry(entry, insertAt ?? state.document.sections.length)
                }
              />
            ) : choosingSectionSpot ? (
              <aside className="pane inspector" aria-label="Choose section spot">
                <div className={foundationStyles.contextTools}>
                  <Button variant="secondary" onClick={() => setChoosingSectionSpot(false)}>
                    Back
                  </Button>
                  <Button variant="secondary" onClick={() => setChoosingSectionSpot(false)}>
                    Done
                  </Button>
                </div>
                <h2>Add a section</h2>
                <p>Choose where the new section goes. Each blue line is a spot on this page.</p>
                <p>Click a blue line on the page. You can also use the section’s own menu: Add above, Add below.</p>
                <Button variant="secondary" onClick={() => openLibrary(state.document.sections.length)}>
                  At the end of the page
                </Button>
              </aside>
            ) : sectionTool ? (
              <SectionToolsPanel
                kind={sectionTool.kind}
                source={sectionTool.source}
                origin={props.sitePublicOrigin ?? null}
                siteId={props.siteId}
                onClose={closeSectionTool}
                onRename={applySectionLink}
              />
            ) : siteWide && !props.originalDesign ? (
              <SiteFrameNote pageId={props.pageId} part={siteWide.part} onDone={() => setSiteWide(null)} />
            ) : siteWide ? (
              <SiteLookPanel
                onCanvasMenu={isolated.enabled ? sendCanvasMenu : undefined}
                canvasMenuPage={isolated.enabled ? canvasMenuPage : null}
                frame={canvasRef}
                canvasReady={canvasReady}
                scale={previewScale}
                pageId={props.pageId}
                part={siteWide.part}
                editing={siteWide.editing}
                media={props.mediaAssets}
                menuEdit={menuEdit}
                menuMove={menuMove}
                registerDone={finish => {
                  finishSiteWide.current = finish
                }}
                onEdit={() => {
                  changeSitePreview('draft')
                  setSiteWide({ ...siteWide, editing: true })
                }}
                onDone={() => setSiteWide(null)}
                onSaved={() => {
                  changeSitePreview('draft')
                  renderCanvas(currentEditor.current.saved)
                }}
              />
            ) : selected !== null && sectionLocked(selected) ? (
              <aside
                className="pane inspector"
                aria-label="Inspector"
                onKeyDown={event => {
                  if (event.key === 'Escape' && !event.defaultPrevented) {
                    event.preventDefault()
                    closeSharedPanel()
                  }
                }}
              >
                <div className={foundationStyles.contextTools}>
                  <Button variant="secondary" onClick={closeSharedPanel}>
                    Back
                  </Button>
                  <Button variant="secondary" onClick={closeSharedPanel}>
                    Done
                  </Button>
                </div>
                <div className="pane-head">
                  <h2>{nameOf(state.document.sections[selected]!)}</h2>
                </div>
                <div className="empty-note" role="status">
                  {state.document.sections[selected]!.values.__cms_chapter_part === 'jumps' ? (
                    <>
                      <strong>Made from this page</strong>
                      <p>These links follow the sections visitors can see.</p>
                    </>
                  ) : (
                    <>
                      <strong>Site editors only</strong>
                      <p>
                        This shared section is kept by the site team. You can edit the other parts of your chapter page.
                      </p>
                    </>
                  )}
                </div>
              </aside>
            ) : (
              <Inspector
                onChangeLinkName={
                  !props.originalDesign && selected !== null ? () => void openSectionTool('link', selected) : undefined
                }
                publishedHeroValues={
                  selectedSection &&
                  props.liveSections.filter(section => section.section_def_id === selectedSection.section_def_id)
                    .length === 1
                    ? props.liveSections.find(section => section.section_def_id === selectedSection.section_def_id)
                        ?.values
                    : undefined
                }
                canManageSections={canManageSections}
                canEditSiteLook={canManageSections && !props.pageScoped}
                canAddBelow={selected !== null && canInsertAt(selected + 1)}
                onDiscardEmptyRepeat={(origin, slotId, key) =>
                  setState(current => {
                    const index = current.sectionOrigins.indexOf(origin)
                    if (index < 0) return current
                    const section = current.document.sections[index]!,
                      slot = slotsByDef
                        .get(sectionVersionKey(section.section_def_id, section.section_def_version))
                        ?.slots.find(field => field.id === slotId)
                    if (!slot || !repeatItemSpec(slot) || repeatItemHasContent(section.values, slot, key))
                      return current
                    const next = setSectionValues(
                      current,
                      index,
                      repeatValues(section, discardNewRepeatItem(section.values, slot, key)),
                    )
                    return current.selection.section === index &&
                      current.selection.slot?.startsWith(slotId + '__' + key + '__')
                      ? setSelection(next, { section: index, slot: null })
                      : next
                  })
                }
                originalDesign={props.originalDesign}
                state={state}
                onRestoreSlot={(slot, snapshot) => {
                  const origin = selected === null ? null : state.sectionOrigins[selected]
                  setState(current => {
                    const index = origin ? current.sectionOrigins.indexOf(origin) : -1
                    return index < 0 ? current : cancelFieldEdit(current, index, slot, snapshot)
                  })
                }}
                sectionOutline={
                  !props.originalDesign
                    ? state.document.sections.map((section, index) => ({ index, label: nameOf(section) }))
                    : undefined
                }
                onSelectSection={index => {
                  setSiteWide(null)
                  setState(current => setSelection(current, { section: index, slot: null }))
                  setPane('inspector')
                }}
                onSelectSlot={slot =>
                  setState(current => setSelection(current, { section: current.selection.section, slot }))
                }
                onDone={() =>
                  props.originalDesign
                    ? setState(current => setSelection(current, { section: null, slot: null }))
                    : closeSharedPanel()
                }
                hasEditableFields={hasEditableFields}
                entry={
                  selectedSection
                    ? (slotsByDef.get(
                        sectionVersionKey(selectedSection.section_def_id, selectedSection.section_def_version),
                      ) ?? null)
                    : null
                }
                latestEntry={
                  selectedSection
                    ? (props.library.find(entry => entry.section_def_id === selectedSection.section_def_id) ?? null)
                    : null
                }
                onReviewUpgrade={version => {
                  if (selected !== null) void reviewSectionUpgrade(selected, version)
                }}
                siteId={props.siteId}
                canChooseStories={props.canPublish && !props.pageScoped}
                pageId={props.pageId}
                savedVersionId={savedVersionId.current}
                canManagePage={props.canPublish && !props.pageScoped}
                hasLivePage={Boolean(publishedVersionId)}
                onSaveDetails={saveDetails}
                onDanger={action => {
                  setPageSettingsOpen(false)
                  setPageDanger(action)
                }}
                metadataContext={{
                  ...props.metadataContext,
                  path: pageIdentity.address ? '/' + pageIdentity.address : '/',
                }}
                linkTargets={props.linkTargets}
                mediaAssets={props.mediaAssets}
                imagePreviews={sitePreview === 'draft' ? props.imagePreviews : props.publishedImagePreviews}
                themeColors={sitePreview === 'draft' ? props.draftThemeColors : props.themeColors}
                readiness={readiness}
                trustedCodeApproved={approved}
                canAuthorSource={props.canApproveTrustedCode}
                canAdvanced={props.canAdvanced}
                // Nothing here talks to the canvas. Every field, every revert and
                // every undo changes the document, and the effect above is what turns
                // a changed document into a changed page — so there is no handler
                // that can be the one that forgets.
                onChange={(slot, value) => {
                  if (selected === null) return
                  setState(setValue(state, selected, slot, value, { at: Date.now() }))
                }}
                onValuesChange={(values, slot) => {
                  if (selected === null) return
                  setState(
                    setSelection(
                      setSectionValues(state, selected, repeatValues(state.document.sections[selected]!, values)),
                      { section: selected, slot },
                    ),
                  )
                }}
                onEditList={(readerKey, stableKey) =>
                  setInlineList({ readerKey, ...(stableKey ? { stableKey } : {}), unit: listUnit(readerKey) })
                }
                onRevertSlot={slot => selected !== null && setState(revertSlot(state, selected, slot))}
                onMetaChange={(key, value) => setState(setMeta(state, key, value))}
                onAppearanceChange={appearance =>
                  canManageSections && selected !== null && setState(setSectionAppearance(state, selected, appearance))
                }
                onToggleBreakpoint={breakpoint =>
                  canManageSections && selected !== null && setState(toggleHiddenAt(state, selected, breakpoint))
                }
                onToggleHidden={() => canManageSections && selected !== null && setState(toggleHidden(state, selected))}
                onChangeLayout={() => {
                  if (canManageSections && selected !== null) openLayoutChoice(selected)
                }}
                onUpdateImportedFields={() => {
                  if (selected !== null) void reviewFieldUpdate(selected)
                }}
                onLabelChange={label => {
                  if (selected !== null) setState(current => setSectionLabel(current, selected, label))
                }}
                onAddBelow={() => {
                  if (selected !== null) openLibrary(selected + 1)
                }}
                onCustomCss={css =>
                  props.canAdvanced && selected !== null && setState(setCustomCss(state, selected, css))
                }
                onRawHtml={html =>
                  props.canApproveTrustedCode && selected !== null && setState(setRawHtml(state, selected, html))
                }
                onAddSection={() =>
                  props.originalDesign
                    ? openLibrary(state.document.sections.length)
                    : (setChoosingSectionSpot(true), setPane('inspector'))
                }
                pageSettingsOpen={pageSettingsOpen}
                onPageSettingsToggle={setPageSettingsOpen}
              />
            )}
          </ResizablePanel>
        </div>

        {pageDanger && (
          <ConfirmDialog
            title={pageDanger === 'archive' ? 'Archive this page?' : 'Unpublish this page?'}
            what={
              pageDanger === 'archive'
                ? 'This page will be removed from the live site and active Pages list.'
                : 'This page will be removed from the live site.'
            }
            reassurance="Its draft and history are kept. You can restore it later."
            confirmLabel={pageDanger === 'archive' ? 'Archive page' : 'Unpublish page'}
            pending={transitionPending}
            onCancel={() => {
              setPageDanger(null)
              setPageSettingsOpen(true)
            }}
            onConfirm={() => void applyPageDanger()}
          />
        )}
        {publishReviewOpen && pageReview && props.canPublish && (
          <Dialog
            title="Publish this page"
            size="medium"
            pending={transitionPending}
            onClose={() => setPublishReviewOpen(false)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setPublishReviewOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPublishReviewOpen(false)
                    schedulePageReview()
                  }}
                >
                  Schedule instead
                </Button>
                <Button variant="publish" onClick={confirmPagePublishReview}>
                  Publish
                </Button>
              </>
            }
          >
            <p>
              <strong>{pageReview.title}</strong> · {props.siteName}
            </p>
            <p>What changed since it was last published</p>
            {pageReview.presentation.changes?.length ? (
              <ul>
                {pageReview.presentation.changes.map((change, index) => (
                  <li key={index}>
                    {change.text}
                    {change.sectionIndex !== undefined && (
                      <Button
                        variant="tertiary"
                        size="s"
                        onClick={() => {
                          setPublishReviewOpen(false)
                          setState(current => setSelection(current, { section: change.sectionIndex!, slot: null }))
                          setPane('inspector')
                        }}
                      >
                        Show
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No page changes.</p>
            )}
            {remainingSamples.length > 0 && (
              <p>This page still contains sample content. You will review it before publishing.</p>
            )}
            <p>The menu and footer aren't part of this. They have their own publish.</p>
            <p>Visitors will see these changes after you confirm.</p>
          </Dialog>
        )}
        {sampleConfirmation && (
          <Dialog
            title="Publish with sample content?"
            onClose={() => setSampleConfirmation(null)}
            pending={transitionPending}
          >
            <p>These sections still contain the examples that came with them. Visitors will see them.</p>
            <ul>
              {remainingSamples.map((sample, index) => (
                <li key={index}>
                  {sample.section} · {sample.fields.length}{' '}
                  {sample.fields.length === 1 ? 'sample field' : 'sample fields'}
                </li>
              ))}
            </ul>
            <div className="actions">
              <Button variant="secondary" onClick={() => setSampleConfirmation(null)}>
                Keep editing
              </Button>
              <Button
                variant="publish"
                onClick={() => {
                  const choice = sampleConfirmation
                  setSampleConfirmation(null)
                  publish(choice.overrideReason, choice.together, choice.siteWide, true)
                }}
              >
                Publish with sample content
              </Button>
            </div>
          </Dialog>
        )}
        {overrideOpen && (
          <ReasonDialog
            pending={transitionPending}
            title="Publish despite the readiness warning?"
            explanation="This exception is recorded with the version that goes live. Explain why publishing now is the right decision."
            label="Reason for publishing"
            value={overrideReason}
            confirmLabel="Publish and record reason"
            onChange={setOverrideReason}
            onCancel={() => {
              setOverrideOpen(false)
              setOverrideReason('')
            }}
            onConfirm={() => {
              const reason = overrideReason.trim()
              if (!reason) return
              setOverrideOpen(false)
              setOverrideReason('')
              publish(reason)
            }}
          />
        )}
        {sectionConfirmation?.action === 'delete' && (
          <ConfirmDialog
            title="Delete section?"
            what="This section will be removed from this page's draft."
            reassurance="You can undo this change. The live page stays as it is until you publish."
            confirmLabel="Delete section"
            onCancel={() => setSectionConfirmation(null)}
            onConfirm={() => {
              setState(current => {
                const index = current.sectionOrigins.indexOf(sectionConfirmation.origin)
                return index < 0 ? current : removeSection(current, index)
              })
              setSectionConfirmation(null)
            }}
          />
        )}
        {sectionConfirmation?.action === 'reset' && (
          <Dialog title="Reset to live version?" onClose={() => setSectionConfirmation(null)} pending={resetting}>
            <p>
              Choose the section from the live page. It replaces this section in a new draft. Earlier work stays in page
              history, and Undo brings it back.
            </p>
            <label htmlFor="live-section-source">Section on the live page</label>
            <select
              id="live-section-source"
              value={liveSourceIndex}
              onChange={event => setLiveSourceIndex(Number(event.target.value))}
              disabled={resetting}
            >
              {props.liveSections.map((section, index) => (
                <option key={index} value={index}>
                  {index + 1}. {nameOf(section)}
                </option>
              ))}
            </select>
            <div className="actions">
              <Button variant="secondary" onClick={() => setSectionConfirmation(null)} disabled={resetting}>
                Cancel
              </Button>
              <Button onClick={() => void applyLiveReset(false)} loading={resetting}>
                Reset to live version
              </Button>
            </div>
          </Dialog>
        )}
        {discardConfirmation && (
          <ConfirmDialog
            title="Discard all unpublished changes?"
            what="The entire page will return to its live version in a new draft."
            reassurance="Earlier work stays in page history. Undo restores it during this session."
            confirmLabel="Discard unpublished changes"
            pending={resetting}
            onCancel={() => setDiscardConfirmation(false)}
            onConfirm={() => void applyLiveReset(true)}
          />
        )}
        {inlineList && (
          <InlineListDrawer
            pageId={props.pageId}
            readerKey={inlineList.readerKey}
            stableKey={inlineList.stableKey}
            unit={inlineList.unit}
            media={props.mediaAssets}
            onClose={() => setInlineList(null)}
            onSaved={() => {
              setInlineList(null)
              renderCanvas(currentEditor.current.saved)
              setResult({
                ok: true,
                revision,
                versionId: savedVersionId.current,
                message: 'List draft saved. Publish the list when it is ready for visitors.',
              })
            }}
          />
        )}
        {layoutChooser && (
          <LayoutChooser
            options={layoutChooser.options}
            error={layoutChooser.error}
            onClose={() => setLayoutChooser(null)}
            onChoose={option => {
              const origin = layoutChooser.origin
              setLayoutChooser(null)
              void reviewLayoutChange(origin, option.definition)
            }}
          />
        )}
        {upgrade && (
          <SectionUpgradeDialog
            preview={upgrade.preview}
            sectionIndex={upgrade.request?.index}
            busy={upgrade.busy}
            onCancel={() => {
              upgradeGeneration.current++
              setUpgrade(null)
            }}
            onApply={() => void applyReviewedUpgrade()}
          />
        )}
        {replacement && (
          <SectionReplacementDialog
            preview={replacement.preview}
            mapping={replacement.request?.mapping}
            sectionIndex={replacement.request?.index}
            busy={replacement.busy}
            refreshing={replacement.refreshing}
            onMap={remapReplacement}
            onCancel={() => {
              replacementGeneration.current++
              setReplacement(null)
            }}
            onApply={() => void applyLayoutChange()}
          />
        )}
        {fieldUpdate && (
          <ImportedUpdateDialog
            preview={fieldUpdate.preview}
            sectionIndex={fieldUpdate.request?.index}
            busy={fieldUpdate.busy}
            onCancel={() => {
              fieldUpdateGeneration.current++
              setFieldUpdate(null)
            }}
            onApply={() => void applyFieldUpdate()}
          />
        )}

        {submitOpen && (
          <ReasonDialog
            pending={transitionPending}
            title="Submit this page for review?"
            explanation="The reviewer will see the exact saved version on your screen. The live page will not change until they approve it. A note is helpful, but optional."
            label="Note for the reviewer"
            value={submitNote}
            confirmLabel="Submit for review"
            required={false}
            onChange={setSubmitNote}
            onCancel={() => {
              setSubmitOpen(false)
              setSubmitNote('')
            }}
            onConfirm={() => {
              const note = submitNote.trim()
              setSubmitOpen(false)
              setSubmitNote('')
              submitForReview(note)
            }}
          />
        )}
      </LargeScreenEditing>
    </div>
  )
}
