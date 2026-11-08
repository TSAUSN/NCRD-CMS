'use client'
import type { CanvasDocumentSource } from './editor-types.ts'
import {
  useCallback,
  type ComponentProps,
  type Dispatch,
  type RefObject,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { setSelection, type EditorDocument, type EditorSection, type EditorState } from '@cms/domain'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import { Button, IconButton } from '../../../components/ui/index.ts'
import { IconPlus } from '../../../components/icons.tsx'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import { installNativeFieldFeedback } from './canvas-field-feedback.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import { EditorCanvasRichText } from './editor-canvas-rich-text.tsx'
import type { RichTextToolbarState } from './rich-text-commands.ts'
import { CanvasChrome, type CanvasHover } from './canvas-chrome.tsx'
import type { PageEditorProps, EditorPane } from './editor-types.ts'
import type { useIsolatedCanvas } from './use-isolated-canvas.ts'
import type { usePageRecovery } from './use-page-recovery.ts'
import { useCanvasDocumentRetry } from './use-canvas-document-retry.ts'
import { VIEWPORTS, type Viewport } from './editor-viewports.ts'
import foundationStyles from './editor-foundation.module.css'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type Chrome = ComponentProps<typeof CanvasChrome>
type Isolation = ReturnType<typeof useIsolatedCanvas>
type Zoom = 'fit' | 'actual'
export type EditorCanvasProps = {
  view: {
    props: Pick<PageEditorProps, 'originalDesign' | 'liveSections'>
    viewTools: ReactNode
    canvasItemToolbarRef: RefObject<HTMLDivElement | null>
    focusCanvas: boolean
    setFocusCanvas: Set<boolean>
    hiddenSectionCount: number
    visibilityView: string
    showHiddenSections: boolean
    setShowHiddenSections: Set<boolean>
    previewBreakpoint: 'sm' | 'md' | 'lg'
    deviceWidth: number
    zoom: Zoom
    canvasViewportRef: RefObject<HTMLDivElement | null>
    viewport: Viewport
    previewWidth: number
    canvasSize: { width: number; height: number }
    previewScale: number
    canvasZoomRef: RefObject<HTMLDivElement | null>
    manualScale: number
    setManualScale: Set<number>
    setZoom: Set<Zoom>
  }
  frame: {
    isolated: Isolation
    isolatedCurrent: Current<Isolation>
    canvasRef: RefObject<HTMLIFrameElement | null>
    canvasSource: CanvasDocumentSource
    canvasReady: number
    canvasSlow: boolean
    canvasAttached: boolean
    renderCanvas: (snapshot: EditorDocument, automaticRetry?: boolean) => void
    shown: Current<EditorDocument>
    toCanvas: (message: Record<string, unknown>) => void
    canvasAwaitingRender: boolean
    sitePreview: SitePreviewContext
    publishedVersionId: string | null
  }
  fields: {
    state: EditorState
    currentEditor: Current<EditorState>
    setState: Set<EditorState>
    setPane: Set<EditorPane>
    activeRichText: CanvasRichTextRequest | null
    slotsByDef: Map<string, LibraryEntry>
    richTextConstraints: (section: EditorSection | undefined, slot: string) => unknown
    canvasHistoryBlocked: Current<boolean>
    remoteRichState: RichTextToolbarState | null
    remoteRichUnavailable: boolean
    setRichTextRequest: Set<CanvasRichTextRequest | null>
    sectionLocked: (index: number | null) => boolean
    selected: number | null
    remoteHover: CanvasHover | null
    nameOf: NonNullable<Chrome['name']>
    canvasAction: NonNullable<Chrome['onAction']>
    canvasRepeat: NonNullable<Chrome['onRepeat']>
    listSelection: { section: number; readerKey: string; stableKey: string; field: string } | null
    listAction: NonNullable<Chrome['onListAction']>
    setInlineList: Set<{ readerKey: string; stableKey?: string; unit: string } | null>
  }
  overlays: {
    upgrade: unknown
    replacement: unknown
    overrideOpen: boolean
    submitOpen: boolean
    recovery: Pick<ReturnType<typeof usePageRecovery>, 'review' | 'busy'>
    sectionTool: unknown
    libraryPreview: LibraryEntry | null
    libraryPreparing: boolean
    libraryStage: Current<boolean>
    setLibraryError: Set<string>
    insertAt: number | null
    canManageSections: boolean
    openLibrary: (at: number) => void
    libraryOpen: boolean
    layoutTarget: string | null
    siteWide: unknown
    choosingSectionSpot: boolean
    canInsertAt: NonNullable<Chrome['canInsertAt']>
    canMoveSection: NonNullable<Chrome['canMove']>
  }
}

/** The editor's canvas view uses the same draft and undo history as the other panes. */
export function EditorCanvas({ view, frame, fields, overlays }: EditorCanvasProps) {
  const {
    props,
    viewTools,
    canvasItemToolbarRef,
    focusCanvas,
    setFocusCanvas,
    hiddenSectionCount,
    visibilityView,
    showHiddenSections,
    setShowHiddenSections,
    previewBreakpoint,
    deviceWidth,
    zoom,
    canvasViewportRef,
    viewport,
    previewWidth,
    canvasSize,
    previewScale,
    canvasZoomRef,
  } = view
  const {
    isolated,
    isolatedCurrent,
    canvasRef,
    canvasSource,
    canvasReady,
    canvasSlow,
    canvasAttached,
    renderCanvas,
    toCanvas,
    canvasAwaitingRender,
    sitePreview,
    publishedVersionId,
  } = frame
  const {
    state,
    currentEditor,
    setState,
    setPane,
    slotsByDef,
    sectionLocked,
    selected,
    remoteHover,
    nameOf,
    canvasAction,
    canvasRepeat,
    listSelection,
    listAction,
    setInlineList,
  } = fields
  const {
    sectionTool,
    libraryPreview,
    libraryPreparing,
    libraryStage,
    setLibraryError,
    insertAt,
    canManageSections,
    openLibrary,
    libraryOpen,
    layoutTarget,
    siteWide,
    choosingSectionSpot,
    canInsertAt,
    canMoveSection,
  } = overlays
  const slotsFor = (section: EditorSection | undefined) =>
    section ? (slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []) : []
  const needsPreview = state.document.sections.length > 0 || Boolean(libraryPreview)
  const sameOriginSource =
    !isolated.enabled && canvasAttached && needsPreview && canvasSource.versionId
      ? `/preview/${canvasSource.versionId}?v=${canvasSource.epoch}&hidden=${showHiddenSections ? '1' : '0'}&site=${sitePreview}${libraryPreview ? '&insert=' + libraryPreview.section_def_id + '&definitionVersion=' + libraryPreview.version + '&at=' + insertAt : ''}`
      : null
  const recoverCanvas = useCallback(
    () => renderCanvas(currentEditor.current.saved, true),
    [currentEditor, renderCanvas],
  )
  useCanvasDocumentRetry(
    sameOriginSource,
    canvasReady > 0,
    Boolean(canvasSource.automaticRetry),
    toCanvas,
    recoverCanvas,
  )
  return (
    <div id="editor-panel-canvas" className="canvas-pane" role="tabpanel" aria-labelledby="editor-tab-canvas">
      <div className={foundationStyles.canvasTools}>
        {!props.originalDesign && <div className={'bar-tools ' + foundationStyles.nativeViewTools}>{viewTools}</div>}
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

      <EditorCanvasRichText fields={fields} frame={frame} overlays={overlays} />
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
          {needsPreview && canvasSource.versionId && (canvasReady === 0 || isolated.error) && (
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
          {needsPreview && canvasSource.versionId ? (
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
                  if (!props.originalDesign && !isolatedCurrent.current.enabled && canvasRef.current?.contentDocument)
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
                src={(isolated.enabled ? isolated.href : sameOriginSource) ?? undefined}
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
                slotsFor={slotsFor}
                slots={slotsFor(selected === null ? undefined : state.document.sections[selected])}
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

      <CanvasZoom view={view} />
    </div>
  )
}

function CanvasZoom({ view }: { view: EditorCanvasProps['view'] }) {
  const { canvasZoomRef, zoom, manualScale, previewScale, setManualScale, setZoom } = view
  function setActualScale(scale: number) {
    setManualScale(scale)
    setZoom('actual')
  }
  return (
    <div ref={canvasZoomRef} className={foundationStyles.zoom} role="group" aria-label="Canvas zoom">
      <IconButton
        tooltip="Zoom out"
        variant="tertiary"
        size="s"
        disabled={zoom === 'actual' && manualScale <= 0.25}
        onClick={() => setActualScale(Math.max(0.25, previewScale - 0.1))}
      >
        −
      </IconButton>
      <Button variant="tertiary" size="s" onClick={() => setActualScale(1)} aria-label="Zoom to actual size">
        {Math.round(previewScale * 100)}%
      </Button>
      <IconButton
        tooltip="Zoom in"
        variant="tertiary"
        size="s"
        disabled={zoom === 'actual' && manualScale >= 2}
        onClick={() => setActualScale(Math.min(2, previewScale + 0.1))}
      >
        +
      </IconButton>
      <Button variant="tertiary" size="s" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
        Fit
      </Button>
    </div>
  )
}
