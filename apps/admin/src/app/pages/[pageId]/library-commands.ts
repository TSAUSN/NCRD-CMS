import type { CanvasDocumentSource } from './editor-types.ts'
import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  addSection,
  addSections,
  resolveSectionInsertionPoint,
  setSelection,
  type captureSectionInsertionPoint,
  type EditorDocument,
  type EditorState,
} from '@cms/domain'
import { markSampleValues, sectionStartingValues } from '@cms/schema'
import type { PreparedRecipeInsertion } from '../../../components/recipe-picker.tsx'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { CanvasRichTextRequest } from './canvas-rich-text.tsx'
import type { EditorPane, PageEditorProps } from './editor-types.ts'

type Current<T> = { current: T }
type Set<T> = Dispatch<SetStateAction<T>>

type Inputs = {
  editor: {
    props: Pick<PageEditorProps, 'library' | 'originalDesign'>
    state: EditorState
    setState: Set<EditorState>
    currentEditor: Current<EditorState>
    canInsertAt: (index: number) => boolean
    pendingFieldFocus: Current<string | null>
    setPane: Set<EditorPane>
  }
  library: {
    insertAt: number | null
    setInsertAt: Set<number | null>
    libraryPreparing: boolean
    setLibraryPreparing: Set<boolean>
    setLibraryError: Set<string>
    libraryPreview: LibraryEntry | null
    setLibraryPreview: Set<LibraryEntry | null>
    libraryOpen: boolean
    setLibraryOpen: Set<boolean>
    layoutTarget: string | null
    setLayoutTarget: Set<string | null>
    setChoosingSectionSpot: Set<boolean>
    setFocusCanvas: Set<boolean>
    libraryOpener: Current<HTMLElement | null>
    returnLibraryFocus: Current<boolean>
  }
  preview: {
    isolatedCurrent: Current<{ enabled: boolean }>
    flushForReview: () => Promise<boolean>
    renderCanvas: (snapshot: EditorDocument) => void
    savedVersionId: Current<string | null>
    setCanvasSource: Set<CanvasDocumentSource>
    setCanvasReady: Set<number>
    setCanvasFramePending: Set<boolean>
    setRichTextRequest: Set<CanvasRichTextRequest | null>
  }
  recipe: {
    recipeGap: Current<ReturnType<typeof captureSectionInsertionPoint> | null>
    setRecipeDefinitions: Set<LibraryEntry[]>
  }
}

/** Choose and preview a layout before adding it to the page draft. */
export function libraryCommands({ editor, library, preview, recipe }: Inputs) {
  const { props, state, setState, currentEditor, canInsertAt, pendingFieldFocus, setPane } = editor
  const {
    insertAt,
    setInsertAt,
    libraryPreparing,
    setLibraryPreparing,
    setLibraryError,
    libraryPreview,
    setLibraryPreview,
    libraryOpen,
    setLibraryOpen,
    layoutTarget,
    setLayoutTarget,
    setChoosingSectionSpot,
    setFocusCanvas,
    libraryOpener,
    returnLibraryFocus,
  } = library
  const {
    isolatedCurrent,
    flushForReview,
    renderCanvas,
    savedVersionId,
    setCanvasSource,
    setCanvasReady,
    setCanvasFramePending,
    setRichTextRequest,
  } = preview
  const { recipeGap, setRecipeDefinitions } = recipe
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
  return {
    previewLibraryEntry,
    closeNativeLibrary,
    changeLibrarySpot,
    openLibrary,
    placeLibraryEntry,
    insertLibraryEntry,
    insertPreparedRecipe,
  }
}

/** The open library, its active preview and layouts added in this session. */
export function useSectionLibraryState() {
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [choosingSectionSpot, setChoosingSectionSpot] = useState(false)
  const [libraryPreview, setLibraryPreview] = useState<LibraryEntry | null>(null)
  const [libraryPreparing, setLibraryPreparing] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const libraryStage = useRef(false)
  libraryStage.current = libraryPreview !== null
  const [libraryFavourites, setLibraryFavourites] = useState<Record<string, boolean>>({})
  const [insertAt, setInsertAt] = useState<number | null>(null)
  const [recipeDefinitions, setRecipeDefinitions] = useState<LibraryEntry[]>([])
  const recipeGap = useRef<ReturnType<typeof captureSectionInsertionPoint> | null>(null)
  return {
    libraryOpen,
    setLibraryOpen,
    choosingSectionSpot,
    setChoosingSectionSpot,
    libraryPreview,
    setLibraryPreview,
    libraryPreparing,
    setLibraryPreparing,
    libraryError,
    setLibraryError,
    libraryStage,
    libraryFavourites,
    setLibraryFavourites,
    insertAt,
    setInsertAt,
    recipeDefinitions,
    setRecipeDefinitions,
    recipeGap,
  }
}
