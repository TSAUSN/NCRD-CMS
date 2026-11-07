'use client'
import type { ComponentProps, Dispatch, SetStateAction } from 'react'
import { moveSection, setSelection, toggleHidden, type EditorState } from '@cms/domain'
import { IconButton } from '../../../components/ui/index.ts'
import { ResizablePanel } from '../../../components/ui/resizable-panel.tsx'
import { IconSections } from '../../../components/icons.tsx'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { EditorPane, PageEditorProps } from './editor-types.ts'
import { StructureTree } from './structure-tree.tsx'
import panelStyles from './editor-panels.module.css'

type Tree = ComponentProps<typeof StructureTree>
type Set<T> = Dispatch<SetStateAction<T>>
type SiteWide = { part: 'header' | 'footer'; editing: boolean } | null
type Props = {
  layout: {
    sectionTool: unknown
    libraryPreview: LibraryEntry | null
    libraryPreparing: boolean
    structureOpen: boolean
    pane: EditorPane
    structureCollapsed: boolean
    setPane: Set<EditorPane>
    setStructureOpen: Set<boolean>
    setStructureWidth: Set<number>
  }
  sections: {
    canManageSections: boolean
    props: Pick<PageEditorProps, 'originalDesign'>
    state: EditorState
    sectionLocked: Tree['locked']
    canInsertAt: Tree['canInsertAt']
    canMoveSection: Tree['canMove']
    slotsByDef: Tree['library']
    siteWide: SiteWide
    setSiteWide: Set<SiteWide>
    setState: Set<EditorState>
    openLibrary: Tree['onAdd']
    placeLibraryEntry: Tree['onDropLibrary']
    openPageSettings: Tree['onPageSettings']
  }
}

/** The editor's structure view uses the same draft and undo history as the other panes. */
export function EditorStructure({ layout, sections }: Props) {
  const {
    sectionTool,
    libraryPreview,
    libraryPreparing,
    structureOpen,
    pane,
    structureCollapsed,
    setPane,
    setStructureOpen,
    setStructureWidth,
  } = layout
  const {
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
  } = sections
  return (
    <div
      className={panelStyles.structure}
      inert={Boolean(sectionTool) || Boolean(libraryPreview) || libraryPreparing}
      data-open={structureOpen || pane === 'tree'}
    >
      {structureCollapsed && (
        <IconButton
          variant="tertiary"
          className={panelStyles.structureToggle}
          tooltip={structureOpen || pane === 'tree' ? 'Close Structure' : 'Open Structure'}
          aria-expanded={structureOpen || pane === 'tree'}
          onClick={() => {
            if (pane === 'tree') setPane('canvas')
            setStructureOpen(!(structureOpen || pane === 'tree'))
          }}
        >
          <IconSections size={16} />
        </IconButton>
      )}
      <ResizablePanel
        storageKey="cms-r8-structure-width"
        label="Structure"
        min={240}
        max={360}
        initial={240}
        edge="right"
        onWidthChange={setStructureWidth}
        className={panelStyles.structurePanel}
      >
        <StructureTree
          canManageSections={canManageSections}
          oneSectionAtATime={!props.originalDesign}
          state={state}
          locked={sectionLocked}
          canInsertAt={canInsertAt}
          canMove={canMoveSection}
          library={slotsByDef}
          onSelect={(section, slot) => {
            if (siteWide?.editing) return
            setSiteWide(null)
            setState(setSelection(state, { section, slot }))
            setStructureOpen(false)
            setPane('inspector')
          }}
          onMove={(from, to) => setState(setSelection(moveSection(state, from, to), { section: to, slot: null }))}
          onAdd={openLibrary}
          onDropLibrary={placeLibraryEntry}
          onToggleHidden={section => setState(toggleHidden(state, section))}
          onPageSettings={openPageSettings}
        />
      </ResizablePanel>
    </div>
  )
}
