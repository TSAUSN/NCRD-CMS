import { isDirty, setSelection, replaceSection, commitSaved } from '@cms/domain'
import type { LibraryEntry } from '../../../lib/queries.ts'
import {
  listCompatibleSectionLayouts,
  applySectionReplacement,
  previewSectionReplacement,
  type ReplacementRequest,
  type ReplacementPreview,
  type ReplacementResult,
  type ReplacementOption,
} from './section-replacement-actions.ts'
import type { DraftCommandInputs, Current, Set } from './editor-draft-command-inputs.ts'

type LayoutChoice = { origin: string; options: ReplacementOption[] | null; error: string | null } | null
type Replacement = {
  request: ReplacementRequest | null
  preview: ReplacementPreview | null
  busy: boolean
  refreshing: boolean
} | null
type Inputs = DraftCommandInputs & {
  replacement: Replacement
  setReplacement: Set<Replacement>
  replacementGeneration: Current<number>
  setLayoutChooser: Set<LayoutChoice>
  setFocusCanvas: Set<boolean>
  setLayoutTarget: Set<string | null>
  setLibraryOpen: Set<boolean>
}

export function sectionReplacementCommands(inputs: Inputs) {
  const {
    props,
    state,
    currentEditor,
    queue,
    savedVersionId,
    flushForReview,
    renderCanvas,
    sitePreview,
    setApprovedVersionId,
    setPane,
    setReplacementDefinitions,
    setResult,
    setReview,
    setRevision,
    setState,
    replacement,
    setReplacement,
    replacementGeneration,
    setLayoutChooser,
    setFocusCanvas,
    setLayoutTarget,
    setLibraryOpen,
  } = inputs

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

  return { openLayoutChoice, reviewLayoutChange, remapReplacement, applyLayoutChange }
}
