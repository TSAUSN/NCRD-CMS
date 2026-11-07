import { isDirty, setSelection, replaceSection, commitSaved } from '@cms/domain'
import { sitePreviewContext } from '../../../lib/preview-context.ts'
import {
  applySectionUpgrade,
  previewSectionUpgrade,
  type UpgradePreview,
  type UpgradeRequest,
} from './section-upgrade-actions.ts'
import {
  applyImportedFieldUpdate,
  previewImportedFieldUpdate,
  type ImportedUpdatePreview,
  type ImportedUpdateRequest,
  type ImportedUpdateResult,
} from './imported-update-actions.ts'
import type { DraftCommandInputs, Current, Set } from './editor-draft-command-inputs.ts'

type Upgrade = { request: UpgradeRequest | null; preview: UpgradePreview | null; busy: boolean } | null
type FieldUpdate = {
  request: ImportedUpdateRequest | null
  preview: ImportedUpdatePreview | null
  busy: boolean
} | null
type Inputs = DraftCommandInputs & {
  upgrade: Upgrade
  setUpgrade: Set<Upgrade>
  upgradeGeneration: Current<number>
  fieldUpdate: FieldUpdate
  setFieldUpdate: Set<FieldUpdate>
  fieldUpdateGeneration: Current<number>
}

export function sectionUpdateCommands(inputs: Inputs) {
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
    upgrade,
    setUpgrade,
    upgradeGeneration,
    fieldUpdate,
    setFieldUpdate,
    fieldUpdateGeneration,
  } = inputs

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

  return { reviewSectionUpgrade, applyReviewedUpgrade, reviewFieldUpdate, applyFieldUpdate }
}
