import { useRef, useState } from 'react'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { ImportedUpdatePreview, ImportedUpdateRequest } from './imported-update-actions.ts'
import { ImportedUpdateDialog } from './imported-update-dialog.tsx'
import { LayoutChooser } from './layout-chooser.tsx'
import type { ReplacementOption, ReplacementPreview, ReplacementRequest } from './section-replacement-actions.ts'
import type { sectionReplacementCommands } from './section-replacement-commands.ts'
import { SectionReplacementDialog } from './section-replacement-dialog.tsx'
import type { sectionUpdateCommands } from './section-update-commands.ts'
import type { UpgradePreview, UpgradeRequest } from './section-upgrade-actions.ts'
import { SectionUpgradeDialog } from './section-upgrade-dialog.tsx'

/** Track the pending section change and the latest request for each dialog. */
export function useSectionUpdateDialogs() {
  const [upgrade, setUpgrade] = useState<{
    request: UpgradeRequest | null
    preview: UpgradePreview | null
    busy: boolean
  } | null>(null)
  const upgradeGeneration = useRef(0)
  /** The section (by stable origin) whose layout the library is choosing. */
  const [layoutChooser, setLayoutChooser] = useState<{
    origin: string
    options: ReplacementOption[] | null
    error: string | null
  } | null>(null)
  const [layoutTarget, setLayoutTarget] = useState<string | null>(null)
  const [replacement, setReplacement] = useState<{
    request: ReplacementRequest | null
    preview: ReplacementPreview | null
    busy: boolean
    refreshing: boolean
  } | null>(null)
  const replacementGeneration = useRef(0)
  const [fieldUpdate, setFieldUpdate] = useState<{
    request: ImportedUpdateRequest | null
    preview: ImportedUpdatePreview | null
    busy: boolean
  } | null>(null)
  const fieldUpdateGeneration = useRef(0)
  const [replacementDefinitions, setReplacementDefinitions] = useState<LibraryEntry[]>([])
  return {
    upgrade,
    setUpgrade,
    upgradeGeneration,
    layoutChooser,
    setLayoutChooser,
    layoutTarget,
    setLayoutTarget,
    replacement,
    setReplacement,
    replacementGeneration,
    fieldUpdate,
    setFieldUpdate,
    fieldUpdateGeneration,
    replacementDefinitions,
    setReplacementDefinitions,
  }
}

type UpdateActions = Pick<ReturnType<typeof sectionUpdateCommands>, 'applyReviewedUpgrade' | 'applyFieldUpdate'>
type LayoutActions = Pick<
  ReturnType<typeof sectionReplacementCommands>,
  'reviewLayoutChange' | 'applyLayoutChange' | 'remapReplacement'
>

/** Review the exact requested section change before applying it. */
export function EditorSectionUpdateDialogs({
  state,
  actions,
  layout,
}: {
  state: ReturnType<typeof useSectionUpdateDialogs>
  actions: UpdateActions
  layout: LayoutActions
}) {
  const {
    layoutChooser,
    setLayoutChooser,
    upgrade,
    upgradeGeneration,
    setUpgrade,
    replacement,
    replacementGeneration,
    setReplacement,
    fieldUpdate,
    fieldUpdateGeneration,
    setFieldUpdate,
  } = state
  const { applyReviewedUpgrade, applyFieldUpdate } = actions
  const { reviewLayoutChange, applyLayoutChange, remapReplacement } = layout
  return (
    <>
      {layoutChooser && (
        <LayoutChooser
          options={layoutChooser.options}
          error={layoutChooser.error}
          onClose={() => setLayoutChooser(null)}
          onChoose={option => {
            const origin = layoutChooser.origin
            setLayoutChooser(null)
            void reviewLayoutChange(origin, option.definition)
          }}
        />
      )}
      {upgrade && (
        <SectionUpgradeDialog
          preview={upgrade.preview}
          sectionIndex={upgrade.request?.index}
          busy={upgrade.busy}
          onCancel={() => {
            upgradeGeneration.current++
            setUpgrade(null)
          }}
          onApply={() => void applyReviewedUpgrade()}
        />
      )}
      {replacement && (
        <SectionReplacementDialog
          preview={replacement.preview}
          mapping={replacement.request?.mapping}
          sectionIndex={replacement.request?.index}
          busy={replacement.busy}
          refreshing={replacement.refreshing}
          onMap={remapReplacement}
          onCancel={() => {
            replacementGeneration.current++
            setReplacement(null)
          }}
          onApply={() => void applyLayoutChange()}
        />
      )}
      {fieldUpdate && (
        <ImportedUpdateDialog
          preview={fieldUpdate.preview}
          sectionIndex={fieldUpdate.request?.index}
          busy={fieldUpdate.busy}
          onCancel={() => {
            fieldUpdateGeneration.current++
            setFieldUpdate(null)
          }}
          onApply={() => void applyFieldUpdate()}
        />
      )}
    </>
  )
}
