import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { orderedNewsroomStories, storyFeatureRank, storyAllowedInFeeds, storyDateInFeed } from '@cms/schema'
import { flatReorderIntent } from '../../../../components/ui/flat-reorder.ts'
import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { mergeSavedStoryRows, storyListLive, storyInSource, type StoryListRow } from '../../../../lib/story-list.ts'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { StoryListSnapshot } from './list-draft.ts'
import { saveStoryNewsroomOrder, saveStoryListPatch, reloadStoryList } from './actions.ts'

type Intent = { kind: 'order'; ids: string[] } | { kind: 'feature'; id: string; value: boolean }
export type NewsroomOrderProps = {
  siteId: string
  initial: StoryListSnapshot
  rights: CollectionRights
  canCreate: boolean
}

export const storyTitle = (row: StoryListRow) => String(row.values.title ?? 'Untitled story')
export const storyDate = (row: StoryListRow) => String(row.values.published_date ?? '')

function rowsInOrder(ids: string[], byId: ReadonlyMap<string, StoryListRow>) {
  return ids.flatMap(id => {
    const row = byId.get(id)
    return row ? [row] : []
  })
}

export function useNewsroomOrder({ siteId, initial, rights }: NewsroomOrderProps) {
  const [state, setState] = useState(initial)
  const [proposal, setProposal] = useState<string[] | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [pending, start] = useTransition()
  const busy = useRef(false)
  const intent = useRef<Intent | null>(null)
  const featureDrag = useRef<string | null>(null)
  const [overFeatured, setOverFeatured] = useState(false)
  const refusedFeature = useRef(false)
  const saved = useRef(initial)
  const ordered = useMemo(() => orderedNewsroomStories(state.rows), [state.rows])
  const rowById = useMemo(() => new Map(state.rows.map(row => [row.id, row])), [state.rows])
  const featured = useMemo(
    () => (proposal ? rowsInOrder(proposal, rowById) : ordered.filter(row => storyFeatureRank(row.values))),
    [proposal, rowById, ordered],
  )
  const featuredIds = useMemo(() => new Set(featured.map(row => row.id)), [featured])
  const other = useMemo(() => state.rows.filter(row => !featuredIds.has(row.id)), [state.rows, featuredIds])
  const eligible = useMemo(
    () =>
      ordered.filter(
        row => storyAllowedInFeeds(row.values, state.settings) && storyDateInFeed(row.values.published_date),
      ),
    [ordered, state.settings],
  )
  const eligibleById = useMemo(() => new Map(eligible.map(row => [row.id, row])), [eligible])
  const visitor = useMemo(() => {
    if (!proposal) return eligible
    const proposed = new Set(proposal)
    return [...rowsInOrder(proposal, eligibleById), ...eligible.filter(row => !proposed.has(row.id))]
  }, [proposal, eligibleById, eligible])
  const editable = rights.editEntries && state.newsroomReady
  useEffect(() => {
    if (busy.current || intent.current) return
    saved.current = initial
    setState(initial)
  }, [initial])
  async function run(next: Intent): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for the current Story change to finish.' }
    intent.current = next
    busy.current = true
    setError('')
    setNotice('Saving Newsroom order…')
    try {
      const base = saved.current
      const result =
        next.kind === 'order'
          ? await saveStoryNewsroomOrder(siteId, base.collectionId, base.catalogRevision, base.entryRevision, next.ids)
          : await saveStoryListPatch(siteId, base.collectionId, next.id, base.catalogRevision, base.entryRevision, {
              action: 'featured',
              value: next.value,
            })
      if (!result.ok) {
        setError(result.message)
        setNotice('Your proposed order is not confirmed. Retry, or use the saved order.')
        return { ok: false, message: result.message }
      }
      const entries = 'entries' in result ? result.entries : undefined
      const rows = entries ? mergeSavedStoryRows(base.rows, entries) : base.rows
      const current = { ...base, rows, catalogRevision: result.catalogRevision, entryRevision: result.entryRevision }
      saved.current = current
      setState(current)
      intent.current = null
      setProposal(null)
      setNotice('Newsroom order saved.')
      return { ok: true }
    } catch {
      const message =
        'The result could not be confirmed. Your proposed order is still here. Check the saved order before retrying.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
    }
  }
  const apply = (next: Intent, ids: string[]) => {
    if (pending || busy.current) return
    setProposal(ids)
    start(async () => {
      await run(next)
    })
  }
  async function discard() {
    if (busy.current) return
    const latest = await reloadStoryList(siteId)
    if (!latest.ok) {
      setError(latest.message)
      return
    }
    const current = { ...saved.current, ...latest, media: saved.current.media }
    saved.current = current
    setState(current)
    setProposal(null)
    intent.current = null
    setError('')
    setNotice('Saved Newsroom order restored. Unsaved proposal discarded.')
  }
  useNavigationGuard(() => ({
    dirty: intent.current !== null,
    pending: pending || busy.current,
    draft: {
      label: 'Newsroom order',
      saveDraft: () => (intent.current ? run(intent.current) : Promise.resolve({ ok: true })),
      discard,
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (intent.current || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  function feature(id: string, value: boolean) {
    if (!editable || pending || intent.current) return
    const ids = featured.map(row => row.id)
    if (value && ids.length >= 5) {
      setError('You can feature up to 5 stories. Remove one first.')
      return
    }
    apply({ kind: 'feature', id, value }, value ? [...ids, id] : ids.filter(key => key !== id))
  }
  function move(id: string, to: number) {
    if (!editable || pending || intent.current) return
    const ids = featured.map(row => row.id)
    const from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    apply({ kind: 'order', ids }, ids)
  }
  const reorderDisabled = !editable || pending || Boolean(intent.current)
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-featured-story',
    decide: point =>
      flatReorderIntent(
        featured.map(row => row.id),
        point,
      ),
    apply: ({ from, to }) => {
      const row = featured[from]!
      move(row.id, to)
      return storyTitle(row) + ' moved to position ' + (to + 1) + '.'
    },
  })
  const live = state.rows.filter(row => storyListLive(row, state.publishedSettings)).length
  const needsReview = state.rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length

  return {
    state,
    proposal,
    notice,
    error,
    pending,
    entryRevision: saved.current.entryRevision,
    hasProposal: Boolean(intent.current),
    featureDrag,
    overFeatured,
    setOverFeatured,
    refusedFeature,
    setError,
    featured,
    eligibleById,
    other,
    visitor,
    editable,
    feature,
    move,
    reorderDisabled,
    reorder,
    live,
    needsReview,
    useSavedOrder: () =>
      start(async () => {
        await discard()
      }),
    retry: () =>
      start(async () => {
        if (intent.current) await run(intent.current)
      }),
  }
}
export type NewsroomOrderModel = ReturnType<typeof useNewsroomOrder>
