import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import type { EditorSection } from '@cms/domain'
import { Button } from '../../../components/ui/index.ts'
import { ResizablePanel } from '../../../components/ui/resizable-panel.tsx'
import { SiteLookPanel } from '../../../components/site-look-panel.tsx'
import { EditorInspectorFields } from './editor-inspector-fields.tsx'
import { EditorLibraryPane } from './editor-library-pane.tsx'
import { SectionToolsPanel } from './section-tools-panel.tsx'
import { SiteFrameNote } from './site-frame-note.tsx'
import foundationStyles from './editor-foundation.module.css'
import panelStyles from './editor-panels.module.css'
import type { PageEditorProps } from './editor-types.ts'

type FramePanel = ComponentProps<typeof SiteLookPanel>
type SiteWide = { part: 'header' | 'footer'; editing: boolean }
type Props = {
  props: Pick<PageEditorProps, 'originalDesign' | 'pageId' | 'siteId' | 'mediaAssets' | 'sitePublicOrigin'>
  layout: {
    libraryOpen: boolean
    choosingSectionSpot: boolean
    layoutTarget: string | null
    workspaceWidth: number
    structureWidth: number
    setRightWidth: (width: number) => void
    setChoosingSectionSpot: Dispatch<SetStateAction<boolean>>
  }
  library: ComponentProps<typeof EditorLibraryPane>
  fields: ComponentProps<typeof EditorInspectorFields>
  structure: {
    sections: EditorSection[]
    selected: number | null
    sectionLocked: (index: number | null) => boolean
    nameOf: (section: EditorSection) => string
    closeSharedPanel: () => void
    openLibrary: (index: number) => void
    sectionTool: Pick<ComponentProps<typeof SectionToolsPanel>, 'kind' | 'source'> | null
    closeSectionTool: ComponentProps<typeof SectionToolsPanel>['onClose']
    applySectionLink: ComponentProps<typeof SectionToolsPanel>['onRename']
  }
  siteFrame: {
    siteWide: SiteWide | null
    setSiteWide: Dispatch<SetStateAction<SiteWide | null>>
    preview: Pick<
      FramePanel,
      | 'onCanvasMenu'
      | 'canvasMenuPage'
      | 'frame'
      | 'canvasReady'
      | 'scale'
      | 'menuEdit'
      | 'menuMove'
      | 'registerDone'
      | 'onSaved'
    >
    edit: (current: SiteWide) => void
  }
}

/** Show exactly one of the editor tools in the resizable right rail. */
export function EditorInspectorPanel({ props, layout, library, fields, structure, siteFrame }: Props) {
  const {
    libraryOpen,
    choosingSectionSpot,
    layoutTarget,
    workspaceWidth,
    structureWidth,
    setRightWidth,
    setChoosingSectionSpot,
  } = layout
  const {
    sections,
    selected,
    sectionLocked,
    nameOf,
    closeSharedPanel,
    openLibrary,
    sectionTool,
    closeSectionTool,
    applySectionLink,
  } = structure
  const { siteWide, setSiteWide, preview, edit } = siteFrame
  return (
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
      {libraryOpen ? (
        <EditorLibraryPane {...library} />
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
          <Button variant="secondary" onClick={() => openLibrary(sections.length)}>
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
          {...preview}
          pageId={props.pageId}
          part={siteWide.part}
          editing={siteWide.editing}
          media={props.mediaAssets}
          onEdit={() => edit(siteWide)}
          onDone={() => setSiteWide(null)}
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
            <h2>{nameOf(sections[selected]!)}</h2>
          </div>
          <div className="empty-note" role="status">
            {sections[selected]!.values.__cms_chapter_part === 'jumps' ? (
              <>
                <strong>Made from this page</strong>
                <p>These links follow the sections visitors can see.</p>
              </>
            ) : (
              <>
                <strong>Site editors only</strong>
                <p>This shared section is kept by the site team. You can edit the other parts of your chapter page.</p>
              </>
            )}
          </div>
        </aside>
      ) : (
        <EditorInspectorFields {...fields} />
      )}
    </ResizablePanel>
  )
}
