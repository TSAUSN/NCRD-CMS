import { useReorderableList } from '../../../../../components/ui/use-reorderable-list.ts'
import { flatReorderIntent } from '../../../../../components/ui/flat-reorder.ts'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { STORY_MAP_AREAS, storyTagIds, type StoriesSettings, type StoryTagGroup } from '@cms/schema'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import type { StoriesTagOperation } from '../../../../../lib/stories-tags.ts'
import { changeTags } from './actions.ts'
type Entry = { id: string; values: Record<string, unknown> }
type Edit = {
  group: StoryTagGroup
  id: string | null
  label: string
  keywords: string
  areas: (typeof STORY_MAP_AREAS)[number][]
}
export type TagManagerProps = {
  siteId: string
  collectionId: string
  initial: StoriesSettings
  initialRevision: string
  initialEntryRevision: string
  initialEntries: Entry[]
  initialHasDraft: boolean
}
function editTagOperation(edit: Edit, keywords: string[]): StoriesTagOperation {
  const fields = { group: edit.group, label: edit.label, keywords, areas: edit.areas }
  return edit.id ? { action: 'edit', id: edit.id, ...fields } : { action: 'add', ...fields }
}
export function useTagManager({
  siteId,
  collectionId,
  initial,
  initialRevision,
  initialEntryRevision,
  initialEntries,
  initialHasDraft,
}: TagManagerProps) {
  const router = useRouter()
  const [settings, setSettings] = useState(initial)
  const [revision, setRevision] = useState(initialRevision)
  const [entryRevision, setEntryRevision] = useState(initialEntryRevision)
  const [entries, setEntries] = useState(initialEntries)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [rename, setRename] = useState<{ group: StoryTagGroup; label: string } | null>(null)
  const [deleting, setDeleting] = useState<{
    group: StoryTagGroup
    id: string
    label: string
    replacement: string | null
  } | null>(null)
  const [confirmSuggestions, setConfirmSuggestions] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const [pending, start] = useTransition()
  const saving = useRef(false)
  const focusAfterMove = useRef<{ group: StoryTagGroup; id: string } | null>(null)
  const [hasDraft, setHasDraft] = useState(initialHasDraft)
  const dirty = edit !== null || rename !== null
  useNavigationGuard(() => ({
    dirty,
    pending: pending || saving.current,
    draft: { label: 'Tags', saveDraft: saveBeforeLeaving, discard: close },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  useEffect(() => {
    if (!pending && !saving.current && focusAfterMove.current) {
      const { group, id } = focusAfterMove.current
      document
        .querySelector<HTMLButtonElement>(`[data-group="${group}"][data-tag-id="${CSS.escape(id)}"] button`)
        ?.focus()
      focusAfterMove.current = null
    }
  }, [pending, settings])
  const tags = (group: StoryTagGroup) => (group === 'main' ? settings.mainTags : settings.secondaryTags)
  const tagKey = (group: StoryTagGroup, id: string) => group + ':' + id
  const reorder = useReorderableList<{ group: StoryTagGroup; id: string; before: string | null }>({
    mimeType: 'application/x-cms-story-tag',
    decide: point => {
      if (saving.current) return { status: 'blocked', message: 'Wait for the current tag save to finish.' }
      const group = point.from.startsWith('main:') ? 'main' : 'secondary'
      if (!point.over.startsWith(group + ':')) return { status: 'blocked', message: 'Move a tag within its own level.' }
      const rows = tags(group)
      const result = flatReorderIntent(
        rows.map(tag => tagKey(group, tag.id)),
        point,
      )
      if (result.status !== 'move') return result
      const { from, to } = result.move
      const id = rows[from]!.id
      const remaining = rows.filter(row => row.id !== id)
      return { ...result, move: { group, id, before: remaining[to]?.id ?? null } }
    },
    apply: ({ group, id, before }) => move(group, id, before),
  })
  const usage = useMemo(() => {
    const byLevel: Record<StoryTagGroup, Map<string, number>> = { main: new Map(), secondary: new Map() }
    for (const entry of entries) {
      for (const level of ['main', 'secondary'] as const) {
        const counts = byLevel[level]
        for (const id of storyTagIds(entry.values, level)) counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return byLevel
  }, [entries])
  const count = (group: StoryTagGroup, id: string) => usage[group].get(id) ?? 0
  const persist = async (operation: StoriesTagOperation): Promise<{ ok: boolean; message?: string }> => {
    if (saving.current) return { ok: false, message: 'Wait for the current tag save to finish.' }
    saving.current = true
    setError(false)
    setMessage('Saving tag changes…')
    try {
      const result = await changeTags(siteId, collectionId, revision, entryRevision, operation)
      if (!result.ok) {
        setError(true)
        setMessage(result.message)
        return { ok: false, message: result.message }
      }
      if (result.changed) setHasDraft(true)
      setSettings(result.settings)
      setRevision(result.revision)
      setEntryRevision(result.entryRevision)
      setEntries(result.entries)
      setEdit(null)
      setRename(null)
      setDeleting(null)
      setConfirmSuggestions(false)
      setMessage(
        !result.changed
          ? 'No tag changes were needed.'
          : operation.action === 'resuggest'
            ? 'Suggestions saved for unreviewed stories. Reviewed stories kept their tags.'
            : 'Saved as a draft. Publish to update the site.',
      )
      router.refresh()
      return { ok: true }
    } catch {
      const message = 'Tags could not be saved. Your changes are still here. Try again.'
      setError(true)
      setMessage(message)
      return { ok: false, message }
    } finally {
      saving.current = false
    }
  }
  const save = (operation: StoriesTagOperation) =>
    start(async () => {
      await persist(operation)
    })
  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (edit) return persist(editTagOperation(edit, draftKeywords))
    if (rename) return persist({ action: 'rename-group', ...rename })
    return { ok: true }
  }
  function move(group: StoryTagGroup, id: string, before: string | null) {
    if (id === before || saving.current) return
    const rows = tags(group)
    const source = rows.find(tag => tag.id === id)
    if (!source) return
    const reordered = rows.filter(tag => tag.id !== id)
    const to = before === null ? reordered.length : reordered.findIndex(tag => tag.id === before)
    if (to < 0 || to === rows.indexOf(source)) return
    reordered.splice(to, 0, source)
    const previous = settings
    const name = group === 'main' ? 'mainTags' : 'secondaryTags'
    setSettings(current => ({ ...current, [name]: reordered }))
    focusAfterMove.current = { group, id }
    start(async () => {
      const result = await persist({ action: 'move', group, id, before })
      if (!result.ok) {
        setSettings(previous)
        reorder.announce(result.message ?? 'Tag move could not be saved.')
      }
    })
    return `Moved ${source.label} to position ${to + 1}.`
  }
  const close = () => {
    if (!saving.current) {
      setEdit(null)
      setRename(null)
      setError(false)
      setMessage('')
    }
  }
  const begin = (group: StoryTagGroup, id: string | null) => {
    const tag = tags(group).find(t => t.id === id)
    setMessage('')
    setError(false)
    setEdit({
      group,
      id,
      label: tag?.label ?? '',
      keywords: tag?.keywords.join(', ') ?? '',
      areas: group === 'secondary' ? (settings.secondaryTags.find(t => t.id === id)?.areas ?? []) : [],
    })
  }
  const draftKeywords = edit
    ? [
        ...new Set(
          edit.keywords
            .split(',')
            .map(k => k.trim())
            .filter(Boolean),
        ),
      ]
    : []
  const saveEdit = () => {
    if (edit) save(editTagOperation(edit, draftKeywords))
  }
  return {
    settings,
    edit,
    setEdit,
    rename,
    setRename,
    deleting,
    setDeleting,
    confirmSuggestions,
    setConfirmSuggestions,
    message,
    setMessage,
    error,
    setError,
    pending,
    hasDraft,
    dirty,
    tags,
    tagKey,
    reorder,
    count,
    save,
    move,
    close,
    begin,
    draftKeywords,
    saveEdit,
  }
}
export type TagManagerModel = ReturnType<typeof useTagManager>
