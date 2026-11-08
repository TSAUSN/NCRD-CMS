import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { storyFeatureRank, type StoryListPatch } from '@cms/schema'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  filterStoryList,
  optimisticStoryList,
  storyListLive,
  storyInSource,
  STORY_LIST_STATUSES,
  type StoryListFilters,
} from '../../../../lib/story-list.ts'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { updateStoryWriting, saveStoryListPatch, reloadStoryList } from './actions.ts'
import { useStoryListFeedCheck } from './list-feed-check.ts'

export type StoryListSnapshot = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
export type StoryListSummary = Omit<StoryListSnapshot, 'media'>
export type StoryListProps = {
  siteId: string
  initial: StoryListSnapshot
  rights: CollectionRights
  canCreate: boolean
  initialFilters: { q: string; status: string; main: string; secondary: string }
}
type Job = { entryId: string; patch: StoryListPatch }

type StoryRow = StoryListSnapshot['rows'][number]

function applySavedStoryRows(rows: StoryRow[], savedRows: Pick<StoryRow, 'id' | 'values' | 'changed'>[]): StoryRow[] {
  const savedById = new Map(savedRows.map(row => [row.id, row]))
  return rows.map(row => {
    const saved = savedById.get(row.id)
    return saved ? { ...row, values: saved.values, changed: saved.changed } : row
  })
}

export function useStoryListDraft({ siteId, initial, initialFilters }: StoryListProps) {
  const [newsroomReady, setNewsroomReady] = useState(initial.newsroomReady)
  const [updating, startUpdate] = useTransition()
  const [settings, setSettings] = useState(initial.settings)
  const [publishedSettings, setPublishedSettings] = useState(initial.publishedSettings)
  const [rows, setRows] = useState(initial.rows)
  const [filters, setFilters] = useState<StoryListFilters>({
    q: initialFilters.q.slice(0, 120),
    status: STORY_LIST_STATUSES.includes(initialFilters.status as StoryListFilters['status'])
      ? (initialFilters.status as StoryListFilters['status'])
      : 'all',
    main: initialFilters.main,
    secondary: initialFilters.secondary,
  })
  const [queued, setQueued] = useState(0)
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')
  const [errorOpen, setErrorOpen] = useState(false)
  const [savedDraft, setSavedDraft] = useState(initial.catalogChanged || initial.rows.some(r => r.changed))
  const baseRows = useRef(initial.rows)
  const jobs = useRef<Job[]>([])
  const busy = useRef(false)
  const failed = useRef(false)
  const catalogRevision = useRef(initial.catalogRevision)
  const entryRevision = useRef(initial.entryRevision)
  const catalog = useRef(initial.settings)
  const catalogPending = useRef(initial.catalogChanged)
  const search = useRef<HTMLInputElement>(null)

  const feed = useStoryListFeedCheck({
    siteId,
    collectionId: initial.collectionId,
    initialStatus: initial.sourceStatus,
    cannotCheck: () => busy.current || jobs.current.length > 0 || failed.current,
    applySnapshot: applyDraftSnapshot,
  })
  const { checkBusy } = feed
  const visible = useMemo(
    () => filterStoryList(rows, filters, settings, publishedSettings),
    [rows, filters, settings, publishedSettings],
  )
  const { live, needsReview } = useMemo(
    () => ({
      live: rows.filter(row => storyListLive(row, publishedSettings)).length,
      needsReview: rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length,
    }),
    [rows, publishedSettings],
  )
  useNavigationGuard(() => ({
    dirty: failed.current && jobs.current.length > 0,
    pending: busy.current || checkBusy.current || updating,
    draft: { label: 'Story list changes', saveDraft: saveBeforeLeaving, discard },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (jobs.current.length || busy.current || checkBusy.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  useEffect(() => {
    if (
      jobs.current.length ||
      busy.current ||
      checkBusy.current ||
      BigInt(initial.entryRevision) < BigInt(entryRevision.current)
    )
      return
    setNewsroomReady(initial.newsroomReady)
    feed.setSourceStatus(initial.sourceStatus)
    applyDraftSnapshot(initial)
  }, [initial])
  function applyDraftSnapshot(latest: StoryListSummary) {
    baseRows.current = latest.rows
    setRows(latest.rows)
    setSettings(latest.settings)
    catalog.current = latest.settings
    setPublishedSettings(latest.publishedSettings)
    catalogPending.current = latest.catalogChanged
    setSavedDraft(latest.catalogChanged || latest.rows.some(row => row.changed))
    catalogRevision.current = latest.catalogRevision
    entryRevision.current = latest.entryRevision
  }

  useEffect(() => {
    const query = new URLSearchParams()
    if (filters.q) query.set('q', filters.q)
    if (filters.status !== 'all') query.set('status', filters.status)
    if (filters.main) query.set('main', filters.main)
    if (filters.secondary) query.set('secondary', filters.secondary)
    window.history.replaceState(null, '', '/sites/' + siteId + '/stories' + (query.size ? '?' + query.toString() : ''))
  }, [filters, siteId])
  const redraw = () => {
    try {
      setRows(optimisticStoryList(baseRows.current, jobs.current, catalog.current))
    } catch {
      setRows(baseRows.current)
    }
    setQueued(jobs.current.length)
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) search.current?.focus()
    })
  }
  const drain = async (showError = true): Promise<{ ok: boolean; message?: string }> => {
    if (busy.current || checkBusy.current) return { ok: false, message: 'Wait for the current story action to finish.' }
    if (failed.current) return { ok: false, message: 'Retry or discard the unsaved story choices before leaving.' }
    if (!jobs.current.length) return { ok: true }
    let lastFailure = 'The story choices could not be saved. Keep editing to retry or discard them.'
    busy.current = true
    setNotice('Saving story changes…')
    while (jobs.current.length && !failed.current) {
      const job = jobs.current[0]!
      try {
        const result = await saveStoryListPatch(
          siteId,
          initial.collectionId,
          job.entryId,
          catalogRevision.current,
          entryRevision.current,
          job.patch,
        )
        if (!result.ok) throw new Error(result.message)
        catalogRevision.current = result.catalogRevision
        entryRevision.current = result.entryRevision
        baseRows.current =
          'entries' in result && result.entries
            ? applySavedStoryRows(baseRows.current, result.entries)
            : baseRows.current.map(row =>
                row.id === result.entryId ? { ...row, values: result.values, changed: result.changed } : row,
              )
        jobs.current.shift()
        setSavedDraft(catalogPending.current || baseRows.current.some(row => row.changed))
        redraw()
      } catch (error) {
        failed.current = true
        lastFailure = error instanceof Error ? error.message : 'The story changes could not be saved.'
        setFailure(lastFailure)
        if (showError) setErrorOpen(true)
        try {
          const latest = await reloadStoryList(siteId)
          if (latest.ok) {
            baseRows.current = latest.rows
            catalogPending.current = latest.catalogChanged
            catalogRevision.current = latest.catalogRevision
            entryRevision.current = latest.entryRevision
            catalog.current = latest.settings
            setSettings(latest.settings)
            setPublishedSettings(latest.publishedSettings)
          }
        } catch {
          lastFailure =
            'The connection was lost. Your queued choices are still here. Retry when you are connected again.'
          setFailure(lastFailure)
        }
        redraw()
      }
    }
    busy.current = false
    setNotice(
      failed.current
        ? 'Your queued choices are not saved. Choose Retry or Discard.'
        : catalogPending.current || baseRows.current.some(row => row.changed)
          ? 'Story changes saved.'
          : 'Story changes saved. There are no unpublished changes.',
    )
    setQueued(jobs.current.length)
    return failed.current ? { ok: false, message: lastFailure } : { ok: true }
  }
  const enqueue = (entryId: string, patch: StoryListPatch) => {
    if (checkBusy.current || updating) return
    if (patch.action === 'featured' && patch.value && rows.filter(row => storyFeatureRank(row.values)).length >= 5) {
      setNotice('You can feature up to 5 stories. Remove one first.')
      return
    }
    jobs.current.push({ entryId, patch })
    redraw()
    void drain()
  }
  const retry = () => {
    failed.current = false
    setFailure('')
    setErrorOpen(false)
    void drain()
  }
  const discard = () => {
    jobs.current = []
    failed.current = false
    setFailure('')
    setErrorOpen(false)
    setNotice('Unsaved tag changes discarded. Saved stories are shown.')
    redraw()
  }
  const canRetry = jobs.current.every(
    job =>
      baseRows.current.some(row => row.id === job.entryId) &&
      (job.patch.action !== 'tag' ||
        (job.patch.group === 'main' ? settings.mainTags : settings.secondaryTags).some(
          tag => job.patch.action === 'tag' && tag.id === job.patch.id,
        )),
  )
  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (!canRetry)
      return {
        ok: false,
        message: 'A story or tag is no longer available. Discard the queued choices, then use the current list.',
      }
    failed.current = false
    setFailure('')
    setErrorOpen(false)
    return drain(false)
  }

  function updateWritingTools() {
    startUpdate(async () => {
      const result = await updateStoryWriting(
        siteId,
        initial.collectionId,
        catalogRevision.current,
        entryRevision.current,
      )
      if (!result.ok) {
        setNotice(result.message)
        return
      }
      const latest = await reloadStoryList(siteId)
      if (latest.ok) {
        catalogRevision.current = latest.catalogRevision
        entryRevision.current = latest.entryRevision
        setNewsroomReady(latest.newsroomReady)
        catalogPending.current = latest.catalogChanged
        setSavedDraft(latest.catalogChanged || latest.rows.some(row => row.changed))
        setNotice('Stories controls updated as a draft. Review and publish when ready.')
      }
    })
  }

  return {
    ...feed,
    search,
    filters,
    setFilters,
    live,
    needsReview,
    settings,
    publishedSettings,
    rows,
    visible,
    newsroomReady,
    updating,
    savedDraft,
    queued,
    notice,
    failure,
    errorOpen,
    setErrorOpen,
    entryRevision: entryRevision.current,
    canRetry,
    enqueue,
    retry,
    discard,
    updateWritingTools,
  }
}
