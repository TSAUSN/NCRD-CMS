'use client'
import { TextLink as Link, Button, Disclosure, Field, Badge } from '../../../../components/ui/index.ts'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { localScheduleTime as resolveScheduleTime, localScheduleHint } from '../../../../lib/local-schedule-time.ts'
import shared from '../../../../components/workspace.module.css'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PageRow } from '../../../../lib/queries.ts'
import type { ScheduleRow } from '../../../../lib/scheduling.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { cancelSchedule, schedulePage, retrySchedule, type ScheduleResult } from './schedule-actions.ts'

type ListedSchedule = Omit<ScheduleRow, 'run_at'> & { run_at: string }
function localScheduleTime(value: string, zone: string): string {
  if (zone === 'your device time zone') return new Date(value).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
  return `${new Intl.DateTimeFormat(undefined, { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value))} · ${zone}`
}
export function ScheduleWorkspace({
  pages,
  schedules,
  available,
  canManage,
  archived,
  siteId,
  actorId = '',
}: {
  actorId?: string
  siteId?: string
  pages: PageRow[]
  schedules: ListedSchedule[]
  available: boolean
  canManage: boolean
  archived: boolean
}) {
  const router = useRouter()
  const [pageId, setPageId] = useState(pages[0]?.id ?? '')
  const [selected, setSelected] = useState<PageRow | null>(pages[0] ?? null)
  const [action, setAction] = useState<'publish' | 'unpublish'>('publish')
  const [time, setTime] = useState('')
  const [zone, setZone] = useState('your device time zone')
  const [override, setOverride] = useState('')
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [retry, setRetry] = useState<{ job: ListedSchedule; pageRevision: string } | null>(null)
  const [retryTime, setRetryTime] = useState(''),
    [retryZone, setRetryZone] = useState('your device time zone')
  const [retryOverride, setRetryOverride] = useState('')
  const retryRequestId = useRef<string | null>(null)
  const [pending, startTransition] = useTransition()
  const requestId = useRef<string | null>(null),
    inFlight = useRef(false)
  const [baseline, setBaseline] = useState(''),
    [saved, setSaved] = useState(false),
    [draftError, setDraftError] = useState(''),
    [formOpen, setFormOpen] = useState(false)
  const [retryBaseline, setRetryBaseline] = useState(''),
    [retrySaved, setRetrySaved] = useState(false),
    [retryDraftError, setRetryDraftError] = useState('')
  const key = actorId && siteId ? 'cms.page-schedule.' + actorId + '.' + siteId : '',
    pin = selected
      ? {
          revision: selected.revision,
          draft_version_id: selected.draft_version_id,
          published_version_id: selected.published_version_id,
        }
      : null
  const fields = { pageId, action, time, zone, override, pin },
    signature = JSON.stringify(fields),
    dirty = canManage && available && !archived && !!baseline && signature !== baseline
  const retryKey = key && retry ? key + '.retry.' + retry.job.id : '',
    retryFields = { time: retryTime, zone: retryZone, override: retryOverride, revision: retry?.pageRevision ?? '' },
    retrySignature = JSON.stringify(retryFields),
    retryDirty = !!retry && !!retryBaseline && retrySignature !== retryBaseline
  const validRequest = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  const validChoices = (value: unknown): boolean => {
    const data = value as typeof fields
    try {
      return (
        !!data &&
        typeof data.time === 'string' &&
        data.time.length <= 32 &&
        typeof data.override === 'string' &&
        data.override.length <= 2000 &&
        typeof data.zone === 'string' &&
        data.zone.length <= 100 &&
        !!new Intl.DateTimeFormat(undefined, { timeZone: data.zone })
      )
    } catch {
      return false
    }
  }
  function restoreFields(value: typeof fields) {
    setPageId(value.pageId)
    setAction(value.action)
    setTime(value.time)
    setZone(value.zone)
    setOverride(value.override)
    const page = pages.find(page => page.id === value.pageId)
    setSelected(page && value.pin ? { ...page, ...value.pin } : null)
    setBaseline(JSON.stringify({ ...value, pin: page ? value.pin : null }))
  }
  useEffect(() => {
    const page = pages[0],
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    let value: typeof fields = {
      pageId: page?.id ?? '',
      action: 'publish',
      time: '',
      zone,
      override: '',
      pin: page
        ? {
            revision: page.revision,
            draft_version_id: page.draft_version_id,
            published_version_id: page.published_version_id,
          }
        : null,
    }
    setSaved(false)
    setDraftError('')
    requestId.current = null
    if (key)
      try {
        const record = JSON.parse(localStorage.getItem(key) ?? 'null'),
          data = record?.fields
        if (
          record?.version === 1 &&
          validChoices(data) &&
          typeof data.pageId === 'string' &&
          (data.action === 'publish' || data.action === 'unpublish') &&
          (data.pin === null ||
            (data.pin &&
              typeof data.pin.revision === 'string' &&
              [data.pin.draft_version_id, data.pin.published_version_id].every(
                value => value === null || typeof value === 'string',
              )))
        ) {
          value = {
            pageId: data.pageId,
            action: data.action,
            time: data.time,
            zone: data.zone,
            override: data.override,
            pin: data.pin
              ? {
                  revision: data.pin.revision,
                  draft_version_id: data.pin.draft_version_id,
                  published_version_id: data.pin.published_version_id,
                }
              : null,
          }
          setSaved(true)
          setFormOpen(true)
          if (validRequest(record.requestId)) requestId.current = record.requestId
        }
      } catch {
        /* Recovery is optional until explicitly saved. */
      }
    restoreFields(value)
  }, [key])
  const saveChoices = async () => {
    if (!key) return { ok: false, message: 'Sign in again before saving these choices in this browser.' }
    try {
      localStorage.setItem(key, JSON.stringify({ version: 1, fields, requestId: requestId.current }))
      setBaseline(signature)
      setSaved(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'This browser could not save the schedule choices. Keep editing, copy them, or discard changes.',
      }
    }
  }
  const singleLeave = () => ({
    dirty,
    pending: pending || inFlight.current,
    draft: {
      label: 'Single-page schedule choices (saved only in this browser)',
      saveDraft: saveChoices,
      discard: () => {
        restoreFields(JSON.parse(baseline))
        requestId.current = null
        setDraftError('')
      },
    },
  })
  const saveRetryChoices = async () => {
    if (!retryKey) return { ok: false, message: 'Sign in again before saving these choices in this browser.' }
    try {
      localStorage.setItem(
        retryKey,
        JSON.stringify({ version: 1, fields: retryFields, requestId: retryRequestId.current }),
      )
      setRetryBaseline(retrySignature)
      setRetrySaved(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'This browser could not save the retry choices. Keep editing, copy them, or discard changes.',
      }
    }
  }
  const retryLeave = () => ({
    dirty: retryDirty,
    pending: pending || inFlight.current,
    draft: {
      label: 'Retry schedule choices (saved only in this browser)',
      saveDraft: saveRetryChoices,
      discard: () => {
        const value = JSON.parse(retryBaseline) as typeof retryFields
        setRetryTime(value.time)
        setRetryZone(value.zone)
        setRetryOverride(value.override)
        setRetry(current => (current ? { ...current, pageRevision: value.revision } : null))
        retryRequestId.current = null
        setRetryDraftError('')
      },
    },
  })
  useNavigationGuard(singleLeave)
  useNavigationGuard(retryLeave)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || retryDirty || pending || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, retryDirty, pending])
  function closeRetry() {
    const close = () => {
      setRetry(null)
      setResult(null)
    }
    if (requestLocalDraftNavigation(retryLeave, close)) close()
  }
  function openRetry(job: ListedSchedule) {
    const page = pages.find(page => page.id === job.item_id)
    if (!page) return
    setResult(null)
    setRetryDraftError('')
    setRetrySaved(false)
    retryRequestId.current = null
    let value = {
      time: '',
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      override: '',
      revision: page.revision,
    }
    if (key)
      try {
        const record = JSON.parse(localStorage.getItem(key + '.retry.' + job.id) ?? 'null'),
          data = record?.fields
        if (record?.version === 1 && validChoices(data) && typeof data.revision === 'string') {
          value = { time: data.time, zone: data.zone, override: data.override, revision: data.revision }
          setRetrySaved(true)
          if (validRequest(record.requestId)) retryRequestId.current = record.requestId
        }
      } catch {
        /* Recovery is optional until explicitly saved. */
      }
    setRetryTime(value.time)
    setRetryZone(value.zone)
    setRetryOverride(value.override)
    setRetryBaseline(JSON.stringify(value))
    setRetry({ job, pageRevision: value.revision })
  }
  function clearChoices() {
    try {
      if (key) localStorage.removeItem(key)
      const page = pages.find(page => page.id === pageId)
      restoreFields({
        ...fields,
        time: '',
        override: '',
        pin: page
          ? {
              revision: page.revision,
              draft_version_id: page.draft_version_id,
              published_version_id: page.published_version_id,
            }
          : null,
      })
      requestId.current = null
      setSaved(false)
      setDraftError('')
      setResult(null)
    } catch {
      setDraftError('The saved choices could not be cleared. Keep them here and try again.')
    }
  }
  function clearRetryChoices() {
    try {
      if (retryKey) localStorage.removeItem(retryKey)
      const revision = pages.find(page => page.id === retry?.job.item_id)?.revision ?? retry?.pageRevision ?? ''
      setRetryTime('')
      setRetryOverride('')
      setRetry(current => (current ? { ...current, pageRevision: revision } : null))
      setRetryBaseline(JSON.stringify({ time: '', zone: retryZone, override: '', revision }))
      retryRequestId.current = null
      setRetrySaved(false)
      setRetryDraftError('')
      setResult(null)
    } catch {
      setRetryDraftError('The saved retry choices could not be cleared. Keep them here and try again.')
    }
  }
  const scheduleZone = zone === 'your device time zone' ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone,
    scheduleTime = resolveScheduleTime(time, scheduleZone),
    retryScheduleTime = resolveScheduleTime(
      retryTime,
      retryZone === 'your device time zone' ? Intl.DateTimeFormat().resolvedOptions().timeZone : retryZone,
    )
  const current = pages.find(page => page.id === pageId)
  const changed = (!!pageId && !current) || (!!selected && current?.revision !== selected.revision)
  const versionId = action === 'publish' ? selected?.draft_version_id : selected?.published_version_id
  function choosePage(id: string, nextAction = action) {
    const change = () => {
      setPageId(id)
      setAction(nextAction)
      setSelected(pages.find(page => page.id === id) ?? null)
      setResult(null)
      setOverride('')
      requestId.current = null
    }
    if (requestLocalDraftNavigation(singleLeave, change)) change()
  }
  function run(command: () => Promise<ScheduleResult>, onSuccess?: () => void) {
    if (inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const outcome = await command()
        setResult(outcome)
        if (outcome.ok) {
          setCancelId(null)
          setRetry(null)
          retryRequestId.current = null
          onSuccess?.()
        }
        router.refresh()
      } catch {
        setResult({ ok: false, message: 'The result could not be confirmed. Refresh the queue before retrying.' })
      } finally {
        inFlight.current = false
      }
    })
  }
  return (
    <section
      className={shared.workspaceContent + ' ' + shared.compactForm + ' ' + shared.denseStack}
      aria-labelledby="schedules-title"
    >
      <h2 id="schedules-title">Scheduled publishing</h2>
      {!available && (
        <p className="notice">
          Scheduling is switched off on this installation, so pages publish only when somebody presses Publish. An
          administrator can switch it on once background tasks are monitored.
        </p>
      )}
      {canManage && available && !archived && (
        <Disclosure
          title="Schedule a single page"
          open={formOpen}
          summaryProps={{
            onClick: event => {
              event.preventDefault()
              const toggle = () => setFormOpen(value => !value)
              if (!formOpen || requestLocalDraftNavigation(singleLeave, toggle)) toggle()
            },
          }}
        >
          <form
            className={shared.formStack}
            onSubmit={event => {
              event.preventDefault()
              if (!selected || !versionId || !time || !scheduleTime) return
              requestId.current ??= crypto.randomUUID()
              run(
                () =>
                  schedulePage({
                    pageId,
                    revision: selected.revision,
                    versionId,
                    action,
                    runAt: scheduleTime!.runAt,
                    override,
                    requestId: requestId.current!,
                    reviewedFindings: result?.report?.findings,
                  }),
                () => {
                  try {
                    if (key) localStorage.removeItem(key)
                  } catch {
                    /* The accepted command is authoritative. */
                  }
                  setTime('')
                  setOverride('')
                  requestId.current = null
                  setSaved(false)
                  setDraftError('')
                  setBaseline(JSON.stringify({ ...fields, time: '', override: '' }))
                },
              )
            }}
          >
            <p>Save draft and leave keeps these choices only in this browser. It does not schedule anything.</p>
            {saved && (
              <p role="status">
                Schedule choices restored or saved in this browser. Review the page, version, time and any checks again.
              </p>
            )}
            {saved && (
              <Button variant="secondary" disabled={pending} onClick={clearChoices}>
                Clear saved schedule choices
              </Button>
            )}
            {draftError && <p role="alert">{draftError}</p>}
            <fieldset data-align="controls" disabled={pending} className={shared.threeColumns}>
              <Field density="compact" id="schedule-page" label="Page">
                <select id="schedule-page" value={pageId} onChange={event => choosePage(event.target.value)}>
                  {!current && pageId && (
                    <option value={pageId} disabled>
                      Saved page is unavailable — choose a current page
                    </option>
                  )}
                  {pages.map(page => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field density="compact" id="schedule-action" label="Action">
                <select
                  id="schedule-action"
                  value={action}
                  onChange={event => choosePage(pageId, event.target.value as typeof action)}
                >
                  <option value="publish">Publish the current saved draft</option>
                  <option value="unpublish">Unpublish the current live version</option>
                </select>
              </Field>
              <Field density="compact" id="schedule-time" label={`Date and time (${zone})`}>
                <input
                  id="schedule-time"
                  type="datetime-local"
                  aria-describedby="schedule-time-hint"
                  required
                  value={time}
                  onChange={event => {
                    setTime(event.target.value)
                    requestId.current = null
                  }}
                />
              </Field>
            </fieldset>
            {localScheduleHint(time, scheduleTime) && (
              <p id="schedule-time-hint" className="hint">
                {localScheduleHint(time, scheduleTime)}
              </p>
            )}
            <p className="hint">
              Choose at least one minute from now.{' '}
              {action === 'unpublish'
                ? 'If another version goes live first, this schedule will not remove it.'
                : 'Later draft edits do not change the version this schedule will publish.'}
            </p>
            {versionId && (
              <p className="hint">
                <Link href={`/preview/${versionId}?readonly=1`} target="_blank" rel="noopener">
                  Preview the exact content being scheduled
                </Link>
              </p>
            )}
            {changed && (
              <p className="notice notice-warn">
                The page changed or is no longer available.{' '}
                <Button size="s" variant="secondary" disabled={pending} onClick={() => choosePage(pageId)}>
                  Reload version
                </Button>
              </p>
            )}
            {!versionId && (
              <p className="notice">
                {action === 'publish' ? 'Save a draft of this page first.' : 'This page does not have a live version.'}
              </p>
            )}
            {!retry && (result?.report || override) && (
              <div className="notice notice-warn">
                <ul>
                  {(result?.report?.blocking ?? []).map((finding, index) => (
                    <li key={index}>{finding.message}</li>
                  ))}
                </ul>
                <Field density="compact" id="schedule-override" label="Reason for the publishing exception">
                  <textarea
                    id="schedule-override"
                    disabled={pending}
                    value={override}
                    maxLength={2000}
                    onChange={event => {
                      setOverride(event.target.value)
                      requestId.current = null
                    }}
                  />
                  <p>
                    Only these reviewed findings may be overridden. New problems at execution time will stop the
                    schedule.
                  </p>
                </Field>
              </div>
            )}
            <div className={shared.actions}>
              <Button type="submit" disabled={pending || !versionId || !time || !scheduleTime || changed}>
                {pending ? 'Saving…' : 'Save schedule'}
              </Button>
            </div>
          </form>
        </Disclosure>
      )}
      {result && !cancelId && !retry && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}
      {schedules.length === 0 ? (
        <p className="muted">No scheduled actions for this site yet.</p>
      ) : (
        <ul className={shared.rowList + ' ' + shared.panel}>
          {schedules.map(job => (
            <li key={job.id} id={`schedule-${job.id}`} aria-label={`Scheduled action ${job.title}`}>
              <div>
                <strong className={shared.singleLine} title={job.title}>
                  {job.title}
                </strong>
                <p>
                  {job.action === 'publish' ? 'Publish saved changes' : 'Unpublish saved page'} ·{' '}
                  <time dateTime={job.run_at} title={new Date(job.run_at).toISOString()}>
                    {localScheduleTime(job.run_at, zone)}
                  </time>
                </p>
                <p>
                  <span className={shared.visuallyHidden}>Status: </span>
                  <Badge tone={job.status === 'failed' ? 'error' : job.status === 'succeeded' ? 'live' : 'neutral'}>
                    {job.status}
                  </Badge>
                  {job.attempt_count
                    ? ` · ${job.attempt_count} ${job.attempt_count === 1 ? 'attempt' : 'attempts'}`
                    : ''}
                </p>
                {job.last_error && <p className="notice notice-error">{job.last_error}</p>}
                {job.retry_of_id && (
                  <p>
                    Retry of <Link href={`#schedule-${job.retry_of_id}`}>an earlier failed attempt</Link>.
                  </p>
                )}
                {job.retried_as_id && (
                  <p>
                    A retry was created:{' '}
                    <Link href={`#schedule-${job.retried_as_id}`}>{job.retried_as_status} attempt</Link>.
                  </p>
                )}
                {job.override_reason && <p>Recorded exception: {job.override_reason}</p>}
              </div>
              {job.item_type === 'release' && (
                <Link
                  href={`${siteId ? '/sites/' + siteId + '/publishing' : ''}?tab=${job.status === 'failed' ? 'changes' : 'history'}${job.status === 'failed' ? '' : '&release=' + job.item_id}`}
                >
                  {job.status === 'failed' ? 'Review changes again' : 'View selected changes'}
                </Link>
              )}
              {canManage && job.item_type !== 'release' && job.status === 'failed' && !job.retried_as_id && (
                <Button
                  size="s"
                  variant="secondary"
                  disabled={pending || !available || archived || !pages.some(page => page.id === job.item_id)}
                  onClick={() => openRetry(job)}
                >
                  Retry failed schedule
                </Button>
              )}
              {canManage && ['pending', 'running'].includes(job.status) && (
                <Button
                  size="s"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setResult(null)
                    setCancelId(job.id)
                  }}
                >
                  Cancel schedule
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {retry && (
        <ConfirmDialog
          title="Retry this failed schedule?"
          what={
            <>
              <p>Save draft and leave keeps retry choices only in this browser. It does not queue a new attempt.</p>
              {retrySaved && (
                <>
                  <p role="status">
                    Retry choices restored or saved in this browser. Check the exact version and review any findings
                    again.
                  </p>
                  <Button variant="secondary" disabled={pending} onClick={clearRetryChoices}>
                    Clear saved retry choices
                  </Button>
                </>
              )}
              {retryDraftError && <p role="alert">{retryDraftError}</p>}
              <p>
                {retry.job.action === 'publish' ? 'Publish' : 'Unpublish'} the same saved version of “{retry.job.title}”
                in a new attempt. Later draft edits are not included.
              </p>
              <p>
                <Link href={`/preview/${retry.job.version_id}?readonly=1`} target="_blank" rel="noopener">
                  Preview the version being retried
                </Link>
              </p>
              <Field density="compact" id="retry-schedule-time" label={`Retry date and time (${retryZone})`}>
                <input
                  id="retry-schedule-time"
                  type="datetime-local"
                  aria-describedby="retry-time-hint"
                  value={retryTime}
                  disabled={pending}
                  onChange={event => {
                    setRetryTime(event.target.value)
                    retryRequestId.current = null
                  }}
                />
              </Field>
              {localScheduleHint(retryTime, retryScheduleTime) && (
                <p id="retry-time-hint" className="hint">
                  {localScheduleHint(retryTime, retryScheduleTime)}
                </p>
              )}
              <p>
                Choose at least one minute from now. Permissions, readiness and worker availability are checked again.
              </p>
              {(result?.report || retryOverride) && (
                <div>
                  <ul>
                    {(result?.report?.blocking ?? []).map((finding, index) => (
                      <li key={index}>{finding.message}</li>
                    ))}
                  </ul>
                  <Field density="compact" id="retry-schedule-override" label="Reason for the new publishing exception">
                    <textarea
                      id="retry-schedule-override"
                      value={retryOverride}
                      disabled={pending}
                      maxLength={2000}
                      onChange={event => {
                        setRetryOverride(event.target.value)
                        retryRequestId.current = null
                      }}
                    />
                  </Field>
                  <p>
                    The earlier attempt's exception is not carried forward. Only these reviewed findings can be
                    approved.
                  </p>
                </div>
              )}
            </>
          }
          reassurance="Nothing changes on the live site now. The failed attempt and its error remain in history."
          confirmLabel="Schedule new attempt"
          tone="primary"
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={closeRetry}
          onConfirm={() => {
            if (!retryTime || !retryScheduleTime) {
              setResult({ ok: false, message: 'Choose a valid date and time for the new attempt.' })
              return
            }
            retryRequestId.current ??= crypto.randomUUID()
            run(
              () =>
                retrySchedule({
                  id: retry.job.id,
                  revision: retry.pageRevision,
                  runAt: retryScheduleTime!.runAt,
                  override: retryOverride,
                  requestId: retryRequestId.current!,
                  reviewedFindings: result?.report?.findings,
                }),
              () => {
                try {
                  if (retryKey) localStorage.removeItem(retryKey)
                } catch {
                  /* The accepted command is authoritative. */
                }
                setRetrySaved(false)
              },
            )
          }}
        />
      )}
      {cancelId && (
        <ConfirmDialog
          title="Cancel this scheduled action?"
          what="This intention will not run if it has not already completed."
          reassurance="The page and its current live version stay unchanged."
          confirmLabel="Cancel schedule"
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={() => setCancelId(null)}
          onConfirm={() => run(() => cancelSchedule(cancelId))}
        />
      )}
    </section>
  )
}
