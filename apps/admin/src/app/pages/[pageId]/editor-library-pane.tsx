import type { Dispatch, SetStateAction } from 'react'
import { captureSectionInsertionPoint, type EditorSection, type EditorState } from '@cms/domain'
import { RecipePicker, type PreparedRecipeInsertion } from '../../../components/recipe-picker.tsx'
import { Button } from '../../../components/ui/index.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { SectionClipboard } from '../../../lib/section-clipboard.ts'
import { sectionLibraryName } from '../../../lib/section-library-search.ts'
import type { EditorPane, PageEditorProps } from './editor-types.ts'
import { LibraryOverlay } from './library-overlay.tsx'
import { PageSectionLibrary } from './page-section-library.tsx'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }

type Inputs = {
  page: {
    props: Pick<PageEditorProps, 'originalDesign' | 'siteId' | 'library' | 'chapterPage'>
    state: EditorState
    currentEditor: Current<EditorState>
    nameOf: (section: EditorSection) => string
    sitePreview: SitePreviewContext
  }
  placement: {
    insertAt: number | null
    setInsertAt: Set<number | null>
    canInsertAt: (index: number) => boolean
    layoutTarget: string | null
    setLayoutTarget: Set<string | null>
    replacingSection: EditorSection | null
    reviewLayoutChange: (origin: string, entry: LibraryEntry) => Promise<void>
    setLibraryOpen: Set<boolean>
    setPane: Set<EditorPane>
  }
  preview: {
    libraryFavourites: Record<string, boolean>
    setLibraryFavourites: Set<Record<string, boolean>>
    libraryPreview: LibraryEntry | null
    setLibraryPreview: Set<LibraryEntry | null>
    libraryPreparing: boolean
    canvasReady: number
    canvasFramePending: boolean
    libraryError: string
    previewLibraryEntry: (entry: LibraryEntry | null, at?: number) => Promise<void>
    insertLibraryEntry: (entry: LibraryEntry, at: number) => void
    closeNativeLibrary: () => void
    changeLibrarySpot: () => void
  }
  recipes: {
    copiedSection: SectionClipboard | null
    pasting: boolean
    pasteSection: () => Promise<void>
    recipeGap: Current<ReturnType<typeof captureSectionInsertionPoint> | null>
    insertPreparedRecipe: (prepared: PreparedRecipeInsertion) => string | null
  }
}

/** Show choices and placement while a section is being added or replaced. */
export function EditorLibraryPane({ page, placement, preview, recipes }: Inputs) {
  const { props, state, currentEditor, nameOf, sitePreview } = page
  const {
    insertAt,
    setInsertAt,
    canInsertAt,
    layoutTarget,
    setLayoutTarget,
    replacingSection,
    reviewLayoutChange,
    setLibraryOpen,
    setPane,
  } = placement
  const {
    libraryFavourites,
    setLibraryFavourites,
    libraryPreview,
    setLibraryPreview,
    libraryPreparing,
    canvasReady,
    canvasFramePending,
    libraryError,
    previewLibraryEntry,
    insertLibraryEntry,
    closeNativeLibrary,
    changeLibrarySpot,
  } = preview
  const { copiedSection, pasting, pasteSection, recipeGap, insertPreparedRecipe } = recipes
  /** Where a chosen section will land, in words for the overlay's heading. */
  function placementLabel(at: number | null): string {
    const sections = state.document.sections
    const index = at ?? sections.length
    if (sections.length === 0) return 'as the first section on this page'
    if (index >= sections.length) return `after “${nameOf(sections[sections.length - 1]!)}”`
    if (index <= 0) return `before “${nameOf(sections[0]!)}”`
    return `between “${nameOf(sections[index - 1]!)}” and “${nameOf(sections[index]!)}”`
  }
  return !props.originalDesign && layoutTarget === null ? (
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
          allowedDefinitionIds={props.chapterPage ? props.library.map(entry => entry.section_def_id) : undefined}
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
  ) : (
    <LibraryOverlay
      siteId={props.siteId}
      previewContext={sitePreview}
      library={props.library.map(entry => ({
        ...entry,
        is_favourite: libraryFavourites[entry.section_def_id] ?? entry.is_favourite,
      }))}
      onFavouriteChange={(id, favourite) => setLibraryFavourites(previous => ({ ...previous, [id]: favourite }))}
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
              recipeGap.current = captureSectionInsertionPoint(current, insertAt ?? current.document.sections.length)
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
  )
}
