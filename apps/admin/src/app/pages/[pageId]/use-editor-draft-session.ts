import { redo, undo } from '@cms/domain'
import type { PageEditorProps } from './editor-types.ts'
import { useCanvasSectionProtection } from './editor-section-rules.ts'
import { useDraftSave, useEditorBeforeUnload } from './use-draft-save.ts'
import { useEditorCanvasBridge } from './use-editor-canvas-bridge.ts'
import { useEditorNavigationSafety } from './use-editor-navigation-safety.ts'
import { useEditorRecoverySession } from './use-editor-recovery-session.ts'
import { useEditorSectionCatalog } from './use-editor-section-catalog.ts'
import { useEditorUndoShortcut } from './use-editor-undo-shortcut.ts'

type Save = Parameters<typeof useDraftSave>[0]
type Navigation = Parameters<typeof useEditorNavigationSafety>[1]
type Bridge = Parameters<typeof useEditorCanvasBridge>[0]
type Draft = Parameters<typeof useEditorRecoverySession>[0] &
  Omit<Save['draft'], 'slotsByDef'> &
  Pick<Save['persistence'], 'setRevision' | 'setResult'> & { props: PageEditorProps }
type Lifecycle = Parameters<typeof useEditorRecoverySession>[1] & Pick<Navigation, 'upgrade' | 'replacement'>
type Inputs = {
  draft: Draft
  lifecycle: Lifecycle
  navigation: Omit<Navigation, keyof Lifecycle | 'recovery'>
  definitions: Omit<Parameters<typeof useEditorSectionCatalog>[2], 'recoveryDefinitions'>
  bridge: Omit<Bridge, 'document'> & {
    document: Omit<Bridge['document'], 'slotsByDef' | 'slotKind' | 'richTextConstraints'>
  }
  protection: Parameters<typeof useCanvasSectionProtection>[0]
  shortcut: Omit<Parameters<typeof useEditorUndoShortcut>[0], keyof Lifecycle | 'changeHistory'>
  persistence: Omit<Save['persistence'], keyof Draft | keyof Lifecycle>
  canvas: Omit<Save['canvas'], 'withCanvasValues' | 'renderCanvas'>
  clearRichText: () => void
}

/** Restore, protect and save the same draft in the editor's effect order. */
export function useEditorDraftSession({
  draft,
  lifecycle,
  navigation,
  definitions,
  bridge,
  protection,
  shortcut,
  persistence,
  canvas,
  clearRichText,
}: Inputs) {
  const { recovery, recoveryDefinitions } = useEditorRecoverySession(draft, lifecycle, clearRichText)
  const limitedHistory = useEditorNavigationSafety(draft, { ...lifecycle, ...navigation, recovery }, () => ({
    saveDraft: saveSession.savePageBeforeLeaving,
    discard: saveSession.discardPageBeforeLeaving,
  }))

  // Recovery can reintroduce old section versions. Resolve them before the
  // canvas subscribes, and register its listeners before starting autosave.
  const catalog = useEditorSectionCatalog(draft.props, draft.state.document.sections, {
    ...definitions,
    recoveryDefinitions,
  })
  const { slotsByDef, slotKind, richTextConstraints } = catalog
  const canvasBridge = useEditorCanvasBridge({
    ...bridge,
    document: { ...bridge.document, slotsByDef, slotKind, richTextConstraints },
  })
  const { renderCanvas } = canvasBridge

  async function withCanvasValues(action: () => void | Promise<void>): Promise<void> {
    const { isolatedCurrent, canvasRefreshBlocked } = canvas
    if (isolatedCurrent.current.enabled && !canvasRefreshBlocked.current && !(await isolatedCurrent.current.flush())) {
      draft.setResult({
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
      draft.setState(current => (forward ? redo(current) : undo(current)))
    })
  }

  useCanvasSectionProtection(protection)
  useEditorUndoShortcut({ ...shortcut, ...lifecycle, changeHistory })
  useEditorBeforeUnload({ ...lifecycle, dirty: draft.dirty, queue: draft.queue, recovery })
  const saveSession = useDraftSave({
    draft: { ...draft, slotsByDef },
    persistence: { ...draft, ...lifecycle, ...persistence },
    canvas: { ...canvas, renderCanvas, withCanvasValues },
  })
  return { recovery, limitedHistory, catalog, canvasBridge, saveSession, withCanvasValues, changeHistory }
}
