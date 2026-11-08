'use client'
import type { ComponentProps, Dispatch, RefObject, ReactNode, SetStateAction } from 'react'
import { setSelection, setValue, type EditorDocument, type EditorSection, type EditorState } from '@cms/domain'
import { slotForId } from '@cms/schema'
import { PREVIEW_MESSAGE } from '@cms/renderer'
import { Button, IconButton } from '../../../components/ui/index.ts'
import { IconPlus } from '../../../components/icons.tsx'
import { listItemUnit as listUnit } from '../../../lib/list-items.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import { installNativeFieldFeedback } from './canvas-field-feedback.ts'
import { sectionVersionKey } from '../../../lib/section-version.ts'
import { withCanvasValue } from './canvas-sync.ts'
import { CanvasRichText, patchCanvasRichText, type CanvasRichTextRequest } from './canvas-rich-text.tsx'
import { IsolatedRichTextToolbar } from './isolated-rich-text-toolbar.tsx'
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
type Props = {
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
    canvasSource: { versionId: string | null; epoch: number }
    canvasReady: number
    canvasSlow: boolean
    canvasAttached: boolean
    renderCanvas: (snapshot: EditorDocument) => void
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
export function EditorCanvas({ view, frame, fields, overlays }: Props) {
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
    manualScale,
    setManualScale,
    setZoom,
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
    shown,
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
    activeRichText,
    slotsByDef,
    richTextConstraints,
    canvasHistoryBlocked,
    remoteRichState,
    remoteRichUnavailable,
    setRichTextRequest,
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
    upgrade,
    replacement,
    overrideOpen,
    submitOpen,
    recovery,
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
  const needsPreview = state.document.sections.length > 0 || Boolean(libraryPreview)
  const sameOriginSource =
    !isolated.enabled && canvasAttached && needsPreview && canvasSource.versionId
      ? `/preview/${canvasSource.versionId}?v=${canvasSource.epoch}&hidden=${showHiddenSections ? '1' : '0'}&site=${sitePreview}${libraryPreview ? '&insert=' + libraryPreview.section_def_id + '&definitionVersion=' + libraryPreview.version + '&at=' + insertAt : ''}`
      : null
  const retryDocument = useCanvasDocumentRetry(sameOriginSource, canvasReady > 0, toCanvas)
  // Use the same URL generation as Reload preview for the fresh document.
  const canvasAddress = retryDocument
    ? sameOriginSource?.replace(`?v=${canvasSource.epoch}&`, `?v=${canvasSource.epoch + 1}&`)
    : sameOriginSource
  return (
    <div id="editor-panel-canvas" className="canvas-pane" role="tabpanel" aria-labelledby="editor-tab-canvas">
      {/* One slim row. Every line above the page is height the page does
        not get, and V1 gave the page nearly all of it. */}
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
            constraints={richTextConstraints(state.document.sections[activeRichText.section], activeRichText.slot)}
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
                    slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? [],
                    section.values,
                    activeRichText.slot,
                  )?.label ?? 'Rich text')
                : 'Rich text'
            })()}
            constraints={richTextConstraints(state.document.sections[activeRichText.section], activeRichText.slot)}
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
                key={`${canvasSource.epoch}:${retryDocument ? 1 : 0}`}
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
                src={(isolated.enabled ? isolated.href : canvasAddress) ?? undefined}
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
                  slotsByDef.get(sectionVersionKey(section.section_def_id, section.section_def_version))?.slots ?? []
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
  )
}
