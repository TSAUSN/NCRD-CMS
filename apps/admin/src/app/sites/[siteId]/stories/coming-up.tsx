'use client'
import { storySourceStatusLine } from '../../../../lib/story-source-status.ts'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import {
  calendarDay,
  readyUndatedStories,
  validStoryDay,
  type StoryCalendarJob,
} from '../../../../lib/story-calendar.ts'
import { storyListLive, storyInSource } from '../../../../lib/story-list.ts'
import { Calendar } from '../../../../components/calendar.tsx'
import { IconChevronLeft, IconChevronRight, IconDrag } from '../../../../components/icons.tsx'
import {
  Button,
  IconButton,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  Note,
} from '../../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { StoriesHeader } from './header.tsx'
import { AddStory } from './add-story.tsx'
import { prepareStoryCalendarSchedule } from './actions.ts'
import shared from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import ownedStyles from './coming-up-styles.module.css'
type State = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
export function StoriesComingUp({
  siteId,
  state,
  rights,
  canCreate,
  jobs,
  available,
  today,
}: {
  siteId: string
  state: State
  rights: CollectionRights
  canCreate: boolean
  jobs: StoryCalendarJob[]
  available: boolean
  today: string
}) {
  const router = useRouter()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [zone, setZone] = useState('UTC')
  const [selected, setSelected] = useState<string | null>(null)
  const [day, setDay] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [firstSite, setFirstSite] = useState(false)
  const [search, setSearch] = useState('')
  const busy = useRef(false)
  const request = useRef<{ key: string; id: string } | null>(null)
  const base = '/sites/' + siteId + '/stories'
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [])
  useNavigationGuard(() => ({ dirty: false, pending: busy.current }))
  const ready = readyUndatedStories(state.rows, jobs)
  const filtered = ready.filter(row => String(row.values.title).toLowerCase().includes(search.toLowerCase()))
  const chosen = ready.find(row => row.id === selected)
  const canSchedule = rights.publish && available
  const live = state.rows.filter(row => storyListLive(row, state.publishedSettings)).length
  const needsReview = state.rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
  function choose(id: string, date = '') {
    if (!canSchedule || !ready.some(row => row.id === id)) return
    setSelected(id)
    setDay(date)
    setMessage('')
    setFirstSite(false)
  }
  function shift(delta: number) {
    const date = new Date(month + '-01T12:00:00Z')
    date.setUTCMonth(date.getUTCMonth() + delta)
    const next = date.toISOString().slice(0, 7)
    if (validStoryDay(next + '-01')) setMonth(next)
  }
  async function review() {
    if (!chosen || !validStoryDay(day) || busy.current) return
    busy.current = true
    setPending(true)
    setMessage('Saving the story day and preparing its review. This may take a minute.')
    const key = chosen.id + ':' + day
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() }
    try {
      const result = await prepareStoryCalendarSchedule(
        siteId,
        state.collectionId,
        chosen.id,
        state.entryRevision,
        day,
        request.current.id,
      )
      if (result.ok)
        router.push('/sites/' + siteId + '/publishing?release=' + result.releaseId + '&intent=schedule&day=' + day)
      else {
        setMessage(result.message)
        setFirstSite('firstSiteReview' in result && result.firstSiteReview === true)
      }
    } catch {
      setMessage('The review could not be confirmed. Reload Coming up to check your saved story before trying again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const monthJobs = jobs.filter(job => calendarDay(new Date(job.runAt), zone).startsWith(month))
  const published = state.rows.filter(
    row => row.published && String(row.published.published_date ?? '').startsWith(month),
  ).length
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="soon"
        sourceStatus={storySourceStatusLine(state.settings.source, state.sourceStatus)}
        actions={
          <>
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={base + '/tags'}>
                Manage tags
              </ButtonLink>
            )}
            <ButtonLink variant="secondary" href={'/preview/stories/' + siteId}>
              Preview
            </ButtonLink>
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={state.collectionId}
                revision={state.entryRevision}
                catalog={state.settings}
                media={state.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      <Note tone="info">
        Space stories out so the site has news every week, instead of many in one day and none for months.
      </Note>
      {!available && (
        <Note tone="warning">
          Scheduling is off. Ask an administrator to turn on automatic publishing and check that it is running. You can
          keep editing story drafts.
        </Note>
      )}
      <div className={ownedStyles.calendarLayout}>
        <Card
          title={new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
            new Date(month + '-01T12:00:00Z'),
          )}
          density="summary"
          headerActions={
            <>
              <IconButton variant="secondary" tooltip="Previous month" onClick={() => shift(-1)}>
                <IconChevronLeft size={16} />
              </IconButton>
              <IconButton variant="secondary" tooltip="Next month" onClick={() => shift(1)}>
                <IconChevronRight size={16} />
              </IconButton>
            </>
          }
        >
          <p className={recordTableStyles.meta}>
            Times use {zone}. Choose a ready story or drag it onto a day, then review its schedule.
          </p>
          <Calendar
            month={month}
            onDropDay={canSchedule ? (date, id) => choose(id, date) : undefined}
            renderDay={date => (
              <>
                {monthJobs
                  .filter(job => calendarDay(new Date(job.runAt), zone) === date)
                  .map(job => (
                    <Link
                      className={ownedStyles.calendarEvent}
                      key={job.id + job.entryId}
                      href={
                        job.status === 'needs_review'
                          ? base + '/' + job.entryId
                          : '/sites/' + siteId + '/publishing' + (job.releaseId ? '?release=' + job.releaseId : '')
                      }
                    >
                      <strong>{job.title}</strong>
                      <br />
                      {new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(
                        new Date(job.runAt),
                      )}{' '}
                      ·{' '}
                      {job.status === 'pending'
                        ? 'Scheduled'
                        : job.status === 'running'
                          ? 'Publishing'
                          : job.status === 'succeeded'
                            ? 'Published'
                            : job.status === 'needs_review'
                              ? 'Needs review'
                              : 'Needs attention'}
                    </Link>
                  ))}
              </>
            )}
          />
        </Card>
        <Card title="Ready, no date yet" density="summary">
          <p className={recordTableStyles.meta}>
            Reviewed stories with text, a photo and description.{' '}
            {canSchedule ? 'Drag onto a day, or choose a story to pick its day.' : 'Open a story to keep editing.'}
          </p>
          <Field id="ready-story-search" label="Find a ready story">
            <input
              id="ready-story-search"
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </Field>
          <div className={shared.denseStack}>
            {filtered.length ? (
              filtered.map(row =>
                canSchedule ? (
                  <Button
                    key={row.id}
                    variant="secondary"
                    className={ownedStyles.calendarReady}
                    aria-label={'Choose day for ' + String(row.values.title)}
                    draggable
                    onDragStart={event => {
                      event.dataTransfer.setData('application/x-cms-story', row.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => choose(row.id)}
                  >
                    <IconDrag size={14} />
                    <span>{String(row.values.title)}</span>
                  </Button>
                ) : (
                  <Link key={row.id} className={ownedStyles.calendarReady} href={base + '/' + row.id}>
                    {String(row.values.title)}
                  </Link>
                ),
              )
            ) : (
              <EmptyState title={search ? 'No matching ready stories' : 'No undated stories ready'}>
                {search
                  ? 'Try another title.'
                  : 'Add story text, a described photo and mark the story Reviewed in Stories.'}
              </EmptyState>
            )}
          </div>
          <div className={ownedStyles.calendarSummary}>
            <strong>This month</strong>
            <p className={recordTableStyles.meta}>
              {published} published ·{' '}
              {monthJobs.filter(job => job.status === 'pending' || job.status === 'running').length} scheduled ·{' '}
              {ready.length} ready
            </p>
          </div>
        </Card>
      </div>
      {chosen && (
        <Dialog
          title="Choose a story day"
          pending={pending}
          onClose={() => {
            if (!busy.current) setSelected(null)
          }}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setSelected(null)}>
                Cancel
              </Button>
              <Button loading={pending} disabled={pending || !validStoryDay(day)} onClick={() => void review()}>
                Review schedule
              </Button>
            </>
          }
        >
          <p>{String(chosen.values.title)}</p>
          <Field
            id="calendar-story-day"
            label="Story day"
            help="This saves the story date as a draft, then opens the normal publishing review at 9:00 AM in your device time zone. You can change the time before scheduling."
          >
            <input id="calendar-story-day" type="date" value={day} onChange={event => setDay(event.target.value)} />
          </Field>
          {message && <p role={pending ? 'status' : 'alert'}>{message}</p>}
          {firstSite && (
            <ButtonLink variant="secondary" href={'/sites/' + siteId + '/publishing?lists=1'}>
              Review first site publication
            </ButtonLink>
          )}
        </Dialog>
      )}
    </>
  )
}
