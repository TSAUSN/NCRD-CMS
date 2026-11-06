'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { storyFeatureRank, type StoryListPatch, type StoriesSettings } from '@cms/schema'
import { Button, ButtonLink, Dialog, EmptyState, Note, TextLink } from '../../../../components/ui/index.ts'
import { StoryListRowView } from '../../../../components/story-list-row.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import {
  storyPreviewHref,
  filterStoryList,
  optimisticStoryList,
  storyListLive,
  storyInSource,
  STORY_LIST_STATUSES,
  type StoryListFilters,
  type StoryListRow,
} from '../../../../lib/story-list.ts'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { updateStoryWriting, saveStoryListPatch, reloadStoryList } from './actions.ts'
import { AddStory } from './add-story.tsx'
import { storySourceStatusLine, storySourceResult } from '../../../../lib/story-source-status.ts'
import type { StorySourceCheck } from '../../../../lib/story-source-check.ts'
import { StoriesHeader } from './header.tsx'
import shared from '../../../../components/workspace.module.css'
type Snapshot = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
type Job = { entryId: string; patch: StoryListPatch }
export function StoriesList({
  siteId,
  initial,
  rights,
  canCreate,
  initialFilters,
}: {
  siteId: string
  initial: Snapshot
  rights: CollectionRights
  canCreate: boolean
  initialFilters: { q: string; status: string; main: string; secondary: string }
}) {
  const [newsroomReady, setNewsroomReady] = useState(initial.newsroomReady),
    [updating, startUpdate] = useTransition()
  const [settings, setSettings] = useState(initial.settings),
    [publishedSettings, setPublishedSettings] = useState(initial.publishedSettings),
    [rows, setRows] = useState(initial.rows),
    [filters, setFilters] = useState<StoryListFilters>({
      q: initialFilters.q.slice(0, 120),
      status: STORY_LIST_STATUSES.includes(initialFilters.status as StoryListFilters['status'])
        ? (initialFilters.status as StoryListFilters['status'])
        : 'all',
      main: initialFilters.main,
      secondary: initialFilters.secondary,
    }),
    [queued, setQueued] = useState(0),
    [notice, setNotice] = useState(''),
    [failure, setFailure] = useState(''),
    [errorOpen, setErrorOpen] = useState(false),
    [savedDraft, setSavedDraft] = useState(initial.catalogChanged || initial.rows.some(r => r.changed)),
    baseRows = useRef(initial.rows),
    jobs = useRef<Job[]>([]),
    busy = useRef(false),
    failed = useRef(false),
    catalogRevision = useRef(initial.catalogRevision),
    entryRevision = useRef(initial.entryRevision),
    catalog = useRef(initial.settings),
    catalogPending = useRef(initial.catalogChanged),
    search = useRef<HTMLInputElement>(null)
  const [sourceStatus, setSourceStatus] = useState(initial.sourceStatus),
    [checking, setChecking] = useState(false),
    [checkMessage, setCheckMessage] = useState(''),
    [checkFailed, setCheckFailed] = useState(false),
    [newStories, setNewStories] = useState(0),
    checkBusy = useRef(false),
    checkRequest = useRef<string | null>(null)
  useEffect(() => {
    if (!checking) return
    const timer = setTimeout(
      () => setCheckMessage('Still checking the feed. Saved stories are safe; this can take a little longer.'),
      8000,
    )
    return () => clearTimeout(timer)
  }, [checking])
  const visible = filterStoryList(rows, filters, settings, publishedSettings),
    live = rows.filter(row => storyListLive(row, publishedSettings)).length,
    needsReview = rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
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
    setSourceStatus(initial.sourceStatus)
    baseRows.current = initial.rows
    setRows(initial.rows)
    setSettings(initial.settings)
    catalog.current = initial.settings
    setPublishedSettings(initial.publishedSettings)
    catalogPending.current = initial.catalogChanged
    setSavedDraft(initial.catalogChanged || initial.rows.some(r => r.changed))
    catalogRevision.current = initial.catalogRevision
    entryRevision.current = initial.entryRevision
  }, [initial])
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
            ? baseRows.current.map(row => {
                const saved = result.entries.find(saved => saved.id === row.id)
                return saved ? { ...row, values: saved.values, changed: saved.changed } : row
              })
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
  const checkSource = async () => {
    if (checkBusy.current || busy.current || jobs.current.length || failed.current) return
    checkBusy.current = true
    setChecking(true)
    setCheckFailed(false)
    setNewStories(0)
    setCheckMessage('Checking the public stories feed…')
    checkRequest.current ??= crypto.randomUUID()
    try {
      const response = await fetch('/api/sites/' + siteId + '/stories/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ collectionId: initial.collectionId, requestId: checkRequest.current }),
        }),
        result = (await response.json()) as { check?: StorySourceCheck; error?: string }
      if (!response.ok || !result.check)
        throw new Error(result.error || 'The connection was lost. Retry this check to see its saved result.')
      const check = result.check
      checkRequest.current = null
      setSourceStatus(previous => ({
        latest: check,
        lastSuccessAt: check.status === 'ok' ? check.finished_at : previous.lastSuccessAt,
      }))
      setCheckMessage(storySourceResult(check))
      setCheckFailed(check.status === 'error')
      setNewStories(check.status === 'ok' ? (check.result.added ?? 0) : 0)
      if (check.status === 'ok') {
        const latest = await reloadStoryList(siteId)
        if (!latest.ok)
          throw new Error('The check finished, but the list could not reload. Reload Stories to see saved drafts.')
        baseRows.current = latest.rows
        setRows(latest.rows)
        catalogPending.current = latest.catalogChanged
        catalogRevision.current = latest.catalogRevision
        entryRevision.current = latest.entryRevision
        catalog.current = latest.settings
        setSettings(latest.settings)
        setPublishedSettings(latest.publishedSettings)
        setSourceStatus(latest.sourceStatus)
        setSavedDraft(latest.catalogChanged || latest.rows.some(row => row.changed))
      }
    } catch (error) {
      setCheckFailed(true)
      setCheckMessage(
        error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)
          ? error.message
          : 'The connection was lost. Retry this check to see its saved result. Saved stories are safe.',
      )
    } finally {
      checkBusy.current = false
      setChecking(false)
    }
  }
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="stories"
        sourceStatus={checking ? 'Checking feed…' : storySourceStatusLine(settings.source, sourceStatus)}
        actions={
          <>
            {rights.manageSchema && initial.ready && settings.source === 'sawso' && (
              <Button
                variant="secondary"
                disabled={checking || queued > 0 || Boolean(failure)}
                onClick={() => void checkSource()}
              >
                {checking ? 'Checking stories…' : checkRequest.current ? 'Retry check' : 'Check for new stories'}
              </Button>
            )}
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories/tags'}>
                Manage tags
              </ButtonLink>
            )}
            {queued || failure || checking ? (
              <Button variant="secondary" disabled>
                Preview
              </Button>
            ) : (
              <ButtonLink variant="secondary" href={storyPreviewHref(siteId, filters)} target="_blank" rel="noopener">
                Preview
              </ButtonLink>
            )}
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={initial.collectionId}
                revision={entryRevision.current}
                catalog={settings}
                media={initial.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      {checkMessage && (
        <p className={shared.meta} role={checkFailed ? 'alert' : 'status'}>
          {checkMessage}
          {newStories > 0 && (
            <Button
              variant="tertiary"
              size="s"
              onClick={() => setFilters({ q: '', status: 'review', main: '', secondary: '' })}
            >
              Review new stories
            </Button>
          )}
        </p>
      )}
      {savedDraft && (
        <Note tone="warning">
          Draft changes wait for publishing.{' '}
          {rights.publish && <TextLink href={'/sites/' + siteId + '/publishing?lists=1'}>Review and publish</TextLink>}
        </Note>
      )}
      {!newsroomReady && (
        <Note>
          Update Stories to use Feature, Newsroom order and Author.{' '}
          {rights.manageSchema && (
            <Button
              variant="secondary"
              loading={updating}
              disabled={checking || queued > 0 || Boolean(failure)}
              onClick={() =>
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
            >
              Update Stories
            </Button>
          )}
        </Note>
      )}
      {!initial.ready && (
        <Note>
          Existing stories are available. A Site admin must finish the Stories update before quick tagging is available.
        </Note>
      )}
      {notice && (
        <p className={shared.meta} role={failure ? 'alert' : 'status'}>
          {notice} {queued > 0 && !failure && `(${queued} queued)`}
          {failure && (
            <Button variant="tertiary" size="s" onClick={() => setErrorOpen(true)}>
              Review unsaved changes
            </Button>
          )}
        </p>
      )}
      <div className={shared.filters + ' ' + shared.listFilters} aria-label="Filter stories">
        <label className={shared.visuallyHidden} htmlFor="story-search">
          Search titles and descriptions
        </label>
        <input
          ref={search}
          id="story-search"
          type="search"
          value={filters.q}
          maxLength={120}
          placeholder="Search titles and descriptions"
          onChange={event => setFilters({ ...filters, q: event.target.value })}
        />
        <label className={shared.visuallyHidden} htmlFor="story-status">
          Story status
        </label>
        <select
          id="story-status"
          value={filters.status}
          onChange={event => setFilters({ ...filters, status: event.target.value as StoryListFilters['status'] })}
        >
          {[
            ['all', 'All stories'],
            ['review', 'Needs review'],
            [
              'untagged',
              settings.mainLabel === 'Project Sectors' && settings.secondaryLabel === 'Regions'
                ? 'Missing sector or region'
                : 'Missing tags',
            ],
            ['live', 'Live'],
            ['hidden', 'Hidden'],
            ['removed', 'No longer in feed'],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className={shared.visuallyHidden} htmlFor="story-main">
          {settings.mainLabel}
        </label>
        <select
          id="story-main"
          value={filters.main}
          onChange={event => setFilters({ ...filters, main: event.target.value })}
        >
          <option value="">
            {settings.mainLabel === 'Project Sectors' ? 'All project sectors' : 'All ' + settings.mainLabel}
          </option>
          <option value="__none">No {settings.mainLabel === 'Project Sectors' ? 'project sector' : 'main tag'}</option>
          {settings.mainTags.map(tag => (
            <option key={tag.id} value={tag.id}>
              {tag.label}
            </option>
          ))}
        </select>
        <label className={shared.visuallyHidden} htmlFor="story-secondary">
          {settings.secondaryLabel}
        </label>
        <select
          id="story-secondary"
          value={filters.secondary}
          onChange={event => setFilters({ ...filters, secondary: event.target.value })}
        >
          <option value="">
            {settings.secondaryLabel === 'Regions' ? 'All regions' : 'All ' + settings.secondaryLabel}
          </option>
          <option value="__none">No {settings.secondaryLabel === 'Regions' ? 'region' : 'secondary tag'}</option>
          {settings.secondaryTags.map(tag => (
            <option key={tag.id} value={tag.id}>
              {tag.label}
            </option>
          ))}
        </select>
        <span className={shared.meta} role="status">
          {visible.length} of {rows.length}
        </span>
      </div>
      <div className={shared.listRows} aria-label="Stories">
        {visible.map(row => (
          <StoryListRowView
            key={row.id}
            row={row}
            settings={settings}
            publishedSettings={publishedSettings}
            siteId={siteId}
            editable={rights.editEntries && initial.ready}
            featureEditable={newsroomReady}
            pending={checking || updating}
            onChange={patch => enqueue(row.id, patch)}
          />
        ))}
        {!visible.length && (
          <EmptyState
            title={rows.length ? 'No stories match these filters' : 'No stories yet'}
            action={
              rows.length ? (
                <Button
                  variant="secondary"
                  onClick={() => setFilters({ q: '', status: 'all', main: '', secondary: '' })}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {rows.length
              ? 'Try another search or clear the filters.'
              : 'Add a story to start. It stays private until it is published.'}
          </EmptyState>
        )}
      </div>
      {errorOpen && (
        <Dialog
          density="compact"
          size="medium"
          title="Story changes weren't saved"
          role="alertdialog"
          onClose={() => setErrorOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setErrorOpen(false)}>
                Cancel
              </Button>
              <Button variant={canRetry ? 'secondary' : 'primary'} onClick={discard}>
                Discard unsaved changes
              </Button>
              {canRetry && <Button onClick={retry}>Retry changes</Button>}
            </>
          }
        >
          <div className={shared.compactFields}>
            <p>{failure}</p>
            <p>
              {jobs.current.length} queued {jobs.current.length === 1 ? 'change is' : 'changes are'} still here. Saved
              story text and photos are preserved.
            </p>
            {!canRetry && (
              <p>A story or tag is no longer available. Discard the queued choices, then use the current list.</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
