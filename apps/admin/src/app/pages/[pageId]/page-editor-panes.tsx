import { EditorPaneTabs } from './editor-pane-tabs.tsx'
import { sectionTools } from './section-tools.ts'
import { EditorCanvas } from './editor-canvas.tsx'
import { EditorStructure } from './editor-structure.tsx'
import { siteFrameInspector } from './editor-site-frame-state.ts'
import type { CSSProperties } from 'react'
import panelStyles from './editor-panels.module.css'
import foundationStyles from './editor-foundation.module.css'
import { EditorInspectorPanel } from './editor-inspector-panel.tsx'
import { Button } from '../../../components/ui/index.ts'
import type { PageEditorScreenProps } from './page-editor-screen.tsx'
import type { ReactNode } from 'react'
export function PageEditorPanes({ session, commands, viewTools }: PageEditorScreenProps & { viewTools: ReactNode }) {
  const { props, state, currentEditor } = session.draft
  const {
    draft,
    sectionRules,
    siteFrame,
    libraryState,
    panels,
    sectionUpdates,
    reviewState,
    canvasSession,
    viewportState,
    catalog,
    canvasBridge,
    clipboard,
  } = session
  const { sitePreview, setShowHiddenSections, showHiddenSections } = session.view
  const { rightWidth, structureWidth, structureCollapsed, rightOverlay } = session.panels
  const { pageSettingsOpen, setPageSettingsOpen, pane, setPane, closeSharedPanel } = session.selection
  const { sectionTool } = session.sectionTools
  const { layoutTarget } = session.sectionUpdates
  const { libraryOpen } = session.libraryState
  const { previewWidth } = session.canvasSession.geometry
  const { isolated, isolatedCurrent } = session.canvasSession.interaction
  const { slotsByDef, nameOf } = session.catalog
  const { recovery } = session.persistence
  const { publishedVersionId } = session.reviewState.publication
  const { setPageDanger } = session.pageActions
  const { listSelection, setInlineList } = session.list
  const { siteWide, setSiteWide, finishSiteWide } = session.siteFrame
  const { readiness, approved } = commands.publishing
  const {
    selected,
    selectedSection,
    replacingSection,
    libraryActions,
    openPageSettings,
    sectionActions,
    layoutActions,
    collectionActions,
    saveDetails,
    reviewSectionUpgrade,
    reviewFieldUpdate,
  } = commands
  const { pasteSection } = commands.sectionActions
  const { insertPreparedRecipe } = commands.libraryActions
  const previewBreakpoint = previewWidth < 768 ? 'sm' : previewWidth < 1024 ? 'md' : 'lg'
  const visibilityView = { sm: 'phone', md: 'tablet', lg: 'desktop' }[previewBreakpoint]
  const hiddenSectionCount = state.document.sections.filter(
    section => section.hidden || section.hidden_at?.includes(previewBreakpoint),
  ).length

  const pageIdentity = state.document.identity ?? {
    title: props.title,
    address: props.metadataContext.path?.replace(/^\//, '') ?? '',
  }
  return (
    <>
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
    </>
  )
}
