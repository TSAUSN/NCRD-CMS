import { recoverStoryDraft, chooseStoryDraft, type StoryDraftGroup } from '../../../../../lib/story-draft-recovery.ts'
import { useEffect, useRef, useState } from 'react'
import type { StoryEditInput } from '../../../../../lib/stories-edit.ts'
import type { RefObject } from 'react'
import { storyDraftInput } from './story-draft-input.ts'
import type { StoryEditorProps } from './use-story-draft.ts'

type StoryRecoveryInput = Pick<
  StoryEditorProps,
  'authorAvailable' | 'catalog' | 'configured' | 'entry' | 'initialRevision' | 'newDraft'
> & {
  baseline: string
  dirty: boolean
  inFlight: RefObject<boolean>
  pending: boolean
  revision: string
  setBaseline: (baseline: string) => void
  setError: (error: boolean) => void
  setNotice: (notice: string) => void
  setRevision: (revision: string) => void
  setValue: (value: StoryEditInput) => void
  value: StoryEditInput
}
export function useStoryRecovery({
  authorAvailable,
  baseline,
  catalog,
  configured,
  dirty,
  entry,
  inFlight,
  initialRevision,
  newDraft,
  pending,
  revision,
  setBaseline,
  setError,
  setNotice,
  setRevision,
  setValue,
  value,
}: StoryRecoveryInput) {
  const seenServerRevision = useRef(initialRevision),
    [recovery, setRecovery] = useState<
      ({ saved: StoryEditInput; revision: string } & ReturnType<typeof recoverStoryDraft>) | null
    >(null),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [choices, setChoices] = useState<Partial<Record<StoryDraftGroup, 'mine' | 'saved'>>>({})

  useEffect(() => {
    if (newDraft || pending || inFlight.current || initialRevision === seenServerRevision.current) return
    seenServerRevision.current = initialRevision
    const saved = storyDraftInput(entry.values, catalog, configured, authorAvailable)
    if (!dirty) {
      setValue(saved)
      setBaseline(JSON.stringify(saved))
      setRevision(initialRevision)
      setRecovery(null)
      if (initialRevision !== revision) setNotice('The latest saved story is loaded.')
      return
    }
    const next = recoverStoryDraft(JSON.parse(baseline), value, saved)
    setRecovery({ ...next, saved, revision: initialRevision })
    setChoices({})
    setRecoveryOpen(true)
    setError(true)
    setNotice('Saved Stories changed. Your words are still here. Review the saved changes before saving again.')
  }, [initialRevision, revision, pending, newDraft, entry.values, catalog, configured, baseline, dirty, value])
  const acceptRecovery = () => {
    if (!recovery) return
    const merged = chooseStoryDraft(recovery, recovery.saved, choices)
    if (!merged) return
    setValue(merged)
    setBaseline(JSON.stringify(recovery.saved))
    setRevision(recovery.revision)
    setRecovery(null)
    setRecoveryOpen(false)
    setError(false)
    setNotice('Your selected changes are ready. Save draft to keep them; nothing has been published.')
  }
  return { recovery, recoveryOpen, setRecoveryOpen, choices, setChoices, acceptRecovery }
}
