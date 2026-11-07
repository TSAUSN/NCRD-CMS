import { useEffect } from 'react'

/** Undo page changes outside inputs and dialogs, which own their keyboard. */
export function useEditorUndoShortcut({
  libraryStage,
  sectionTool,
  upgrade,
  replacement,
  siteWideCurrent,
  changeHistory,
}: {
  libraryStage: { current: unknown }
  sectionTool: object | null
  upgrade: object | null
  replacement: object | null
  siteWideCurrent: { current: { editing: boolean } | null }
  changeHistory: (forward: boolean) => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        libraryStage.current ||
        sectionTool !== null ||
        upgrade !== null ||
        replacement !== null ||
        siteWideCurrent.current?.editing
      )
        return
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"],[role="alertdialog"]')) return
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      // ⌘Z / ⌘⇧Z across every edit operation, not only typing (SPEC §6.4).
      changeHistory(event.shiftKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [upgrade, replacement, sectionTool])
}
