'use client'
import { ReleaseReadinessSummary } from '../../../../components/release-readiness-summary.tsx'
import { createPortal } from 'react-dom'
import { TextLink as Link } from '../../../../components/ui/index.ts'
import type { ReleaseStamp } from '../../../../lib/release-stamps.ts'
import { localScheduleTime, localScheduleHint } from '../../../../lib/local-schedule-time.ts'
import { selectedReleaseKeys, type InitialReleasePick } from '../../../../lib/release-selection.ts'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { ReleaseItem, ReleaseRow } from '../../../../lib/releases.ts'
import { releaseGroup, releaseLabel, type ReleasePresentation } from '../../../../lib/release-copy.ts'
import {
  Button,
  Drawer,
  EmptyState,
  Field,
  Card,
  Badge,
  Disclosure,
  ActionNote,
} from '../../../../components/ui/index.ts'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { ReleaseRecoveryReview } from './release-recovery-review.tsx'
import {
  cancelRelease,
  prepareRelease,
  publishRelease,
  scheduleRelease,
  type ReleaseResult,
} from './release-actions.ts'
import styles from './publish.module.css'
import shared from '../../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import siteSummaryStyles from '../../../../components/workspace-styles/site-summary.module.css'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../../../components/workspace-styles/review-workbench.module.css'
import ownedStyles from './release-workspace-styles.module.css'
import { ReleaseComparisonDialog } from './release-comparison-dialog.tsx'

type ListedRelease = Omit<ReleaseRow, 'created_at' | 'finished_at'> & {
  created_at: string
  finished_at: string | null
  actorLabel?: string
}
export function ReleaseWorkspace({
  siteId,
  actorId = '',
  items,
  releases,
  canPublish,
  canAdminister,
  isSuperAdmin = false,
  archived,
  initialRelease = false,
  presentations = {},
  view = 'changes',
  initialArea,
  schedulingAvailable = false,
  initialReleaseId,
  initialPick,
  initialReviewPresentations = {},
  initialSchedule = false,
  initialScheduleTime = '',
  native = false,
  stamps = {},
  headerActionsId,
}: {
  native?: boolean
  stamps?: Record<string, ReleaseStamp>
  headerActionsId?: string
  actorId?: string
  siteId: string
  items: ReleaseItem[]
  releases: ListedRelease[]
  canPublish: boolean
  canAdminister: boolean
  isSuperAdmin?: boolean
  archived: boolean
  initialRelease?: boolean
  presentations?: Record<string, ReleasePresentation>
  view?: 'changes' | 'history'
  initialArea?: string
  schedulingAvailable?: boolean
  initialReleaseId?: string
  initialPick?: InitialReleasePick
  initialReviewPresentations?: Record<string, ReleasePresentation>
  initialSchedule?: boolean
  initialScheduleTime?: string
}) {
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null)
  useEffect(() => setHeaderTarget(headerActionsId ? document.getElementById(headerActionsId) : null), [headerActionsId])
  const [current, setCurrent] = useState<ListedRelease | null>(
    () => releases.find(release => release.id === initialReleaseId) ?? null,
  )
  const [selected, setSelected] = useState<string[]>(() =>
    current?.status === 'planned'
      ? current.snapshot.map(item => item.key)
      : selectedReleaseKeys(items, canAdminister, initialArea, initialPick),
  )
  const [result, setResult] = useState<ReleaseResult | null>(null)
  const [override, setOverride] = useState(''),
    [samplesConfirmed, setSamplesConfirmed] = useState(false)
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | null>(null)
  const [descriptions, setDescriptions] = useState({ releaseId: initialReleaseId, values: initialReviewPresentations })
  const [scheduleOpen, setScheduleOpen] = useState(initialSchedule && current?.status === 'planned'),
    [time, setTime] = useState(initialScheduleTime),
    [zone, setZone] = useState('your device time zone')
  const [compare, setCompare] = useState<ReleaseItem | null>(null)
  const [transitionPending, startTransition] = useTransition(),
    [recoveryPending, setRecoveryPending] = useState(false)
  const pending = transitionPending || recoveryPending
  const scheduleError = useRef<HTMLParagraphElement>(null),
    reviewHeading = useRef<HTMLHeadingElement>(null)
  const requestId = useRef<string | null>(null),
    scheduleRequestId = useRef<string | null>(null),
    inFlight = useRef(false)
  const [intentBaseline, setIntentBaseline] = useState(''),
    [intentSaved, setIntentSaved] = useState(false),
    [intentError, setIntentError] = useState('')
  const intentKey = actorId && current ? 'cms.release-schedule.' + actorId + '.' + siteId + '.' + current.id : '',
    intent = JSON.stringify({ time, zone, override }),
    intentDirty = !!current && current.status === 'planned' && !!intentBaseline && intent !== intentBaseline
  const saveIntent = async () => {
    if (!intentKey) return { ok: false, message: 'Sign in again before saving these choices in this browser.' }
    try {
      localStorage.setItem(
        intentKey,
        JSON.stringify({ version: 1, time, zone, override, requestId: scheduleRequestId.current }),
      )
      setIntentBaseline(intent)
      setIntentSaved(true)
      return { ok: true }
    } catch {
      return {
        ok: false,
        message: 'This browser could not save these choices. Keep editing, copy them, or discard the changes.',
      }
    }
  }
  const discardIntent = () => {
    const saved = JSON.parse(intentBaseline) as { time: string; zone: string; override: string }
    setTime(saved.time)
    setZone(saved.zone)
    setOverride(saved.override)
    scheduleRequestId.current = null
    setIntentError('')
  }
  const leaveIntent = () => ({
    dirty: intentDirty,
    pending: inFlight.current || pending,
    draft: {
      label: 'Publish later choices (saved only in this browser)',
      saveDraft: saveIntent,
      discard: discardIntent,
    },
  })
  useNavigationGuard(leaveIntent)
  useEffect(() => {
    setSamplesConfirmed(false)
    scheduleRequestId.current = null
    setIntentSaved(false)
    setIntentError('')
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    let value = { time: current?.id === initialReleaseId ? initialScheduleTime : '', zone: deviceZone, override: '' }
    if (intentKey && current?.status === 'planned')
      try {
        const saved = JSON.parse(localStorage.getItem(intentKey) ?? 'null')
        if (
          saved?.version === 1 &&
          typeof saved.time === 'string' &&
          saved.time.length <= 32 &&
          typeof saved.zone === 'string' &&
          saved.zone.length <= 100 &&
          typeof saved.override === 'string' &&
          saved.override.length <= 2000
        ) {
          new Intl.DateTimeFormat(undefined, { timeZone: saved.zone })
          value = { time: saved.time, zone: saved.zone, override: saved.override }
          setIntentSaved(true)
          if (
            typeof saved.requestId === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.requestId)
          )
            scheduleRequestId.current = saved.requestId
        }
      } catch {
        /* Recovery is optional until explicitly saved. */
      }
    setTime(value.time)
    setZone(value.zone)
    setOverride(value.override)
    setIntentBaseline(JSON.stringify(value))
  }, [intentKey])
  function closeSchedule() {
    const close = () => setScheduleOpen(false)
    if (requestLocalDraftNavigation(leaveIntent, close)) close()
  }
  function clearIntent() {
    try {
      if (intentKey) localStorage.removeItem(intentKey)
      setTime('')
      setOverride('')
      scheduleRequestId.current = null
      setIntentSaved(false)
      setIntentError('')
      setIntentBaseline(JSON.stringify({ time: '', zone, override: '' }))
    } catch {
      setIntentError('The saved choices could not be cleared. Keep them here and try again.')
    }
  }
  function finishIntent() {
    try {
      if (intentKey) localStorage.removeItem(intentKey)
    } catch {
      /* The accepted command is authoritative. */
    }
    setIntentSaved(false)
    setIntentBaseline(intent)
    setScheduleOpen(false)
  }
  useEffect(() => {
    if (scheduleOpen && result && !result.ok) {
      scheduleError.current?.focus()
      scheduleError.current?.scrollIntoView({ block: 'center' })
    }
  }, [scheduleOpen, result])
  useEffect(() => {
    if (current && !scheduleOpen) {
      reviewHeading.current?.focus({ preventScroll: true })
      reviewHeading.current?.scrollIntoView({ block: 'start' })
    }
  }, [current?.id, scheduleOpen])
  useEffect(() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone), [])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (inFlight.current || pending || intentDirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [pending, intentDirty])
  const scheduleTime = localScheduleTime(
      time,
      zone === 'your device time zone' ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone,
    ),
    scheduleHint = localScheduleHint(time, scheduleTime)
  // The saved review is authoritative. An edit to its selection starts a new review.
  const checkedItems = new Set(current?.status === 'planned' ? current.snapshot.map(item => item.key) : selected)
  const picked = items.filter(item => checkedItems.has(item.key) && (!item.requiresAdmin || canAdminister))
  const hasSamples =
    current?.preview_report.some(check => check.report.blocking.some(finding => finding.rule === 'sample_content')) ??
    false
  const blocked =
    current?.preview_report.some(check => check.report.blocking.some(finding => finding.rule !== 'sample_content')) ??
    false
  const canExecute =
    canPublish &&
    (isSuperAdmin || !current?.snapshot.some(item => item.type === 'site_files')) &&
    (canAdminister || !current?.snapshot.some(item => item.requiresAdmin))
  const ready =
    canExecute && !current?.stale && !archived && (!hasSamples || samplesConfirmed) && (!blocked || !!override.trim())
  function run(operation: () => Promise<ReleaseResult>, finish = false, after?: () => void) {
    if (inFlight.current || recoveryPending) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const outcome = await operation()
        setResult(outcome)
        if (outcome.ok) {
          setConfirm(null)
          if (outcome.release) {
            setDescriptions({ releaseId: outcome.release.id, values: outcome.presentations ?? {} })
            setCurrent(outcome.release)
            requestId.current = null
            setOverride('')
          } else if (finish) setCurrent(null)
          // Each action revalidates this path and returns its refreshed UI.
          // A second client refresh could overtake the person's next navigation.
          after?.()
        }
      } catch {
        setResult({ ok: false, message: 'The result could not be confirmed. Check History before retrying.' })
      } finally {
        inFlight.current = false
      }
    })
  }
  function resetReview() {
    requestId.current = null
    setCurrent(null)
    setResult(null)
    setOverride('')
    setSamplesConfirmed(false)
  }
  function chooseItem(key: string, checked: boolean) {
    const change = () => {
      const next = new Set(picked.map(item => item.key))
      if (checked) next.add(key)
      else next.delete(key)
      resetReview()
      setSelected([...next])
    }
    if (requestLocalDraftNavigation(leaveIntent, change)) change()
  }
  function prepare(later: boolean) {
    requestId.current ??= crypto.randomUUID()
    run(
      () => prepareRelease(siteId, requestId.current!, picked),
      false,
      () => setScheduleOpen(later),
    )
  }
  function preset(monday: boolean) {
    const date = new Date()
    date.setDate(date.getDate() + (monday ? (8 - date.getDay()) % 7 || 7 : 1))
    date.setHours(9, 0, 0, 0)
    setTime(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T09:00`,
    )
    scheduleRequestId.current = null
  }
  const selectedChanges = current && (
    <ul className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}>
      {current.snapshot.map(item => (
        <li key={item.key}>
          <div className={recordTableStyles.rowCopy}>
            <strong className={recordTableStyles.singleLine} title={releaseLabel(item)}>
              {releaseLabel(item)}
              {item.action === 'unpublish' ? ' · will leave the live site' : ''}
            </strong>
            {descriptions.releaseId === current.id && descriptions.values[item.key] && (
              <p
                className={recordTableStyles.singleLine + ' ' + recordTableStyles.meta}
                title={descriptions.values[item.key]!.summary}
              >
                {descriptions.values[item.key]!.summary}
              </p>
            )}
          </div>
          {current.status === 'planned' && (
            <Button variant="secondary" size="s" disabled={pending || !!current.stale} onClick={() => setCompare(item)}>
              View changes
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
  const review = current && (
    <div className={shared.workspaceContent} aria-label="Selected changes review">
      <div className={styles.heading}>
        <h2 ref={reviewHeading} tabIndex={-1}>
          Check selected changes
        </h2>
        <span>
          {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change' : 'changes'}
        </span>
      </div>
      {current.snapshot.length > 3 ? (
        <Disclosure title={`Selected changes (${current.snapshot.length})`}>{selectedChanges}</Disclosure>
      ) : (
        selectedChanges
      )}

      <ReleaseReadinessSummary
        checks={current.preview_report}
        releaseId={current.id}
        planned={current.status === 'planned'}
        canPreview={canExecute && !archived}
        applied={current.status === 'applied'}
      />
      {current.stale && (
        <p className="notice notice-warn">
          The site changed after this review. Return to Changes ready to publish and prepare a fresh review.
        </p>
      )}
      {current.status === 'planned' && (
        <>
          {hasSamples && (
            <label className={selectionControlsStyles.checkRow}>
              <input
                type="checkbox"
                checked={samplesConfirmed}
                disabled={pending}
                onChange={event => setSamplesConfirmed(event.target.checked)}
              />
              <span>
                Publish with sample content<small>I have reviewed the examples listed above.</small>
              </span>
            </label>
          )}
          {blocked && canPublish && (
            <Field
              id="release-override"
              density="compact"
              label="Reason for publishing despite these findings"
              help="Your reason and the reviewed findings are kept in activity. Approval and ownership rules still apply."
            >
              <textarea
                id="release-override"
                disabled={pending}
                value={override}
                onChange={event => {
                  setOverride(event.target.value)
                  scheduleRequestId.current = null
                }}
                maxLength={2000}
              />
            </Field>
          )}
          {canPublish && !canExecute && (
            <p role="status">A site administrator must publish these shared design or list field changes.</p>
          )}
          {canPublish && !scheduleOpen && (
            <div className={styles.actions}>
              <Button
                variant="publish"
                disabled={pending || !ready}
                onClick={() => {
                  setResult(null)
                  setConfirm('publish')
                }}
              >
                Publish selected ({current.snapshot.length})
              </Button>
              <Button
                variant="secondary"
                disabled={pending || !ready || !schedulingAvailable}
                onClick={() => setScheduleOpen(true)}
              >
                Publish later…
              </Button>
              <Button
                variant="tertiary"
                disabled={pending}
                onClick={() => {
                  setResult(null)
                  setConfirm('cancel')
                }}
              >
                Cancel review
              </Button>
            </div>
          )}
        </>
      )}
      {current.status === 'applied' && canPublish && !archived && (
        <ReleaseRecoveryReview
          key={current.id}
          releaseId={current.id}
          canAdminister={canAdminister}
          onBusyChange={setRecoveryPending}
          onPlanned={release => {
            setCurrent(release)
            setResult({
              ok: true,
              message: 'Earlier content prepared as a draft. Review its effects before publishing.',
            })
            setOverride('')
          }}
        />
      )}
    </div>
  )
  const publishActions = (
    <>
      <Button variant="publish" disabled={pending || !picked.length} loading={pending} onClick={() => prepare(false)}>
        Publish selected ({picked.length})
      </Button>
      <Button
        variant="secondary"
        disabled={pending || !picked.length || !schedulingAvailable}
        onClick={() => prepare(true)}
      >
        Publish later…
      </Button>
    </>
  )
  return (
    <section
      data-native={native || undefined}
      className={styles.workspace + ' ' + shared.denseStack}
      aria-label={view === 'history' ? 'Publishing history' : 'Changes ready to publish'}
    >
      {native &&
        headerTarget &&
        view === 'changes' &&
        canPublish &&
        !archived &&
        items.length > 0 &&
        !current &&
        createPortal(<div className={workspaceFormsStyles.actions}>{publishActions}</div>, headerTarget)}
      {view === 'changes' && !(current?.status === 'planned' && current.snapshot.some(item => item.entryIds)) && (
        <>
          <div className={styles.heading}>
            <div>
              <h2 className={native && !initialRelease ? selectionControlsStyles.visuallyHidden : undefined}>
                {initialRelease ? 'Publish your site for the first time' : 'Changes ready to publish'}
              </h2>
              <p className={styles.muted}>
                {canPublish ? 'Choose what goes live together.' : 'See saved work and publishing history.'}
              </p>
            </div>
            {items.length > 0 && canPublish && (
              <Button
                variant="tertiary"
                disabled={pending}
                onClick={() => {
                  const change = () => {
                    resetReview()
                    setSelected(items.filter(item => !item.requiresAdmin || canAdminister).map(item => item.key))
                  }
                  if (requestLocalDraftNavigation(leaveIntent, change)) change()
                }}
              >
                Select everything
              </Button>
            )}
          </div>
          {!canPublish && (
            <p className="notice">
              An editor can put these changes live. Submit your changes from the page or list you edited.{' '}
              <Link href={`/sites/${siteId}`}>Open pages</Link>
            </p>
          )}
          {initialRelease && (
            <p className="notice">
              Your site is private. Include its pages, Site look, header, footer and menu in its first publication.
            </p>
          )}
          {native && items.length > 0 ? (
            <div className={recordTableStyles.tableWrap}>
              <table data-density="content" className={recordTableStyles.table + ' ' + ownedStyles.publishTable}>
                <caption className={selectionControlsStyles.visuallyHidden}>Saved changes ready to publish</caption>
                <thead>
                  <tr>
                    <th>
                      <span className={selectionControlsStyles.visuallyHidden}>Select</span>
                    </th>
                    <th>What</th>
                    <th>What changed</th>
                    <th>Who</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.key}>
                      <td>
                        {canPublish && (!item.requiresAdmin || canAdminister) && (
                          <label className={selectionControlsStyles.checkRow}>
                            <input
                              type="checkbox"
                              aria-label={releaseLabel(item)}
                              checked={checkedItems.has(item.key)}
                              disabled={pending || archived}
                              onChange={event => chooseItem(item.key, event.target.checked)}
                            />
                          </label>
                        )}
                      </td>
                      <th scope="row">
                        <strong className={recordTableStyles.singleLine} title={releaseLabel(item)}>
                          {releaseLabel(item)}
                        </strong>
                        <small className={recordTableStyles.meta}>
                          {releaseGroup(item) === 'Pages' ? 'Page' : releaseGroup(item)}
                          {item.requiresAdmin && !canAdminister ? ' · needs an Admin' : ''}
                        </small>
                      </th>
                      <td>
                        <div className={recordTableStyles.summaryAction}>
                          <p
                            className={recordTableStyles.singleLine}
                            title={
                              presentations[item.key]?.summary ??
                              (item.unpublished ? 'New page · not live yet' : 'Saved changes')
                            }
                          >
                            {presentations[item.key]?.summary ??
                              (item.unpublished ? 'New page · not live yet' : 'Saved changes')}
                          </p>
                          <Button variant="tertiary" size="s" disabled={pending} onClick={() => setCompare(item)}>
                            View changes
                          </Button>
                        </div>
                      </td>
                      <td>
                        <span
                          className={recordTableStyles.singleLine}
                          title={stamps[item.key]?.actor ?? 'Not recorded'}
                        >
                          {stamps[item.key]?.actor ?? 'Not recorded'}
                        </span>
                      </td>
                      <td>
                        {stamps[item.key] ? (
                          <time
                            dateTime={stamps[item.key]!.when}
                            title={new Date(stamps[item.key]!.when).toLocaleString()}
                          >
                            {new Intl.DateTimeFormat('en-US', {
                              month: 'short',
                              day: 'numeric',
                              timeZone: 'America/New_York',
                            }).format(new Date(stamps[item.key]!.when))}
                            <small>
                              {new Intl.DateTimeFormat('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                timeZone: 'America/New_York',
                              }).format(new Date(stamps[item.key]!.when))}
                            </small>
                          </time>
                        ) : (
                          'Not recorded'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !items.length ? (
            <EmptyState title={native && archived ? 'No changes can be published' : 'Everything saved is live'}>
              {native && archived
                ? 'This site is archived. Open History to view earlier releases.'
                : 'Your next saved changes will appear here.'}
            </EmptyState>
          ) : (
            ['Pages', 'Lists', 'Data values', 'Site look'].map(group => {
              const grouped = items.filter(item => releaseGroup(item) === group)
              return (
                grouped.length > 0 && (
                  <Card title={group} density="compact" key={group}>
                    <ul className={siteSummaryStyles.rowList}>
                      {grouped.map(item => (
                        <li key={item.key}>
                          <label className={selectionControlsStyles.checkRow}>
                            {canPublish && (
                              <input
                                type="checkbox"
                                checked={checkedItems.has(item.key)}
                                disabled={
                                  pending || !canPublish || archived || (!!item.requiresAdmin && !canAdminister)
                                }
                                onChange={event => chooseItem(item.key, event.target.checked)}
                              />
                            )}
                            <span>
                              <strong>{releaseLabel(item)}</strong>
                              <small>
                                {presentations[item.key]?.summary ??
                                  (item.unpublished ? 'New page · not live yet' : 'Saved changes')}
                                {item.requiresAdmin && !canAdminister ? ' · needs a site admin' : ''}
                              </small>
                            </span>
                          </label>
                          <Button
                            variant="secondary"
                            size="s"
                            disabled={pending}
                            onClick={() => {
                              setCompare(item)
                            }}
                          >
                            View changes
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )
              )
            })
          )}
          {!native && canPublish && !archived && items.length > 0 && !current && (
            <div className={styles.bar}>
              <Button
                variant="publish"
                disabled={pending || !picked.length}
                loading={pending}
                onClick={() => prepare(false)}
              >
                Publish selected ({picked.length})
              </Button>
              <Button
                variant="secondary"
                disabled={pending || !picked.length || !schedulingAvailable}
                onClick={() => prepare(true)}
              >
                Publish later…
              </Button>
              <span className={styles.muted}>Review the checks before confirming.</span>
            </div>
          )}
          {native && items.length > 0 && (
            <p className={ownedStyles.publishNote}>
              Selected items go live together. Pages that show a changed list update after it is published.{' '}
              <Link href={'/sites/' + siteId + '/publishing?tab=scheduled'}>View scheduled publishing</Link>
            </p>
          )}
          {!schedulingAvailable && canPublish && (
            <p className={styles.muted}>
              Scheduling is off. Ask an administrator to turn on automatic publishing and check that it is running.
            </p>
          )}
        </>
      )}
      {view === 'history' && (
        <>
          <h2>History</h2>
          {releases.length ? (
            <ul className={siteSummaryStyles.rowList + ' ' + reviewWorkbenchStyles.panel}>
              {releases.map(release => (
                <li key={release.id}>
                  <div className={recordTableStyles.rowCopy}>
                    <div className={recordTableStyles.summaryAction}>
                      <Badge
                        tone={
                          release.status === 'applied' ? 'live' : release.status === 'cancelled' ? 'neutral' : 'pending'
                        }
                      >
                        {release.status === 'applied'
                          ? 'Went live'
                          : release.status === 'cancelled'
                            ? 'Cancelled review'
                            : release.stale
                              ? 'Review out of date'
                              : 'Reviewed draft'}
                      </Badge>
                      <p className={recordTableStyles.singleLine} title={release.snapshot.map(releaseLabel).join(', ')}>
                        {release.snapshot.map(releaseLabel).join(', ')}
                      </p>
                    </div>
                    <small>
                      {new Date(release.finished_at ?? release.created_at).toLocaleString()} ·{' '}
                      {release.actorLabel ?? 'Another editor'}
                    </small>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      const change = () => {
                        setCurrent(release)
                        setResult(null)
                        setOverride('')
                      }
                      if (requestLocalDraftNavigation(leaveIntent, change)) change()
                    }}
                  >
                    View details
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No publishing history yet">A record is kept every time changes go live.</EmptyState>
          )}
        </>
      )}
      {result && !confirm && !transitionPending && (
        <p className={`notice ${result.ok ? 'notice-ok' : 'notice-error'}`} role={result.ok ? 'status' : 'alert'}>
          {result.message}
        </p>
      )}
      {!scheduleOpen && review}
      {compare && (
        <ReleaseComparisonDialog
          key={compare.key}
          siteId={siteId}
          item={compare}
          initial={presentations[compare.key]}
          onClose={() => setCompare(null)}
        />
      )}
      {scheduleOpen && current && (
        <Drawer
          density="compact"
          title="Publish later"
          pending={pending}
          onClose={closeSchedule}
          footer={
            <>
              <ActionNote>
                Save draft and leave keeps the time and reason only in this browser. It does not schedule anything.
              </ActionNote>
              <Button variant="secondary" disabled={pending} onClick={closeSchedule}>
                Cancel
              </Button>
              <Button
                disabled={pending || !ready || !time || !scheduleTime}
                loading={pending}
                onClick={() => {
                  if (!time || !scheduleTime) return
                  scheduleRequestId.current ??= crypto.randomUUID()
                  run(
                    () =>
                      scheduleRelease(
                        current.id,
                        scheduleTime!.runAt,
                        override,
                        samplesConfirmed,
                        scheduleRequestId.current!,
                      ),
                    true,
                    finishIntent,
                  )
                }}
              >
                Schedule selected changes
              </Button>
            </>
          }
        >
          <div className={listInspectorStyles.formStack}>
            {intentSaved && (
              <p role="status">
                Choices restored or saved in this browser. Review this exact set of changes and confirm any required
                approvals again before scheduling.
              </p>
            )}
            {intentSaved && (
              <Button variant="secondary" disabled={pending} onClick={clearIntent}>
                Clear saved choices
              </Button>
            )}
            {intentError && <p role="alert">{intentError}</p>}
            <p>
              {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change will' : 'changes will'} go
              live together.{' '}
              {current.scope_before_hash
                ? 'Changes to this story, its article or required site settings stop this schedule for another review. You can keep working on other stories.'
                : 'New edits after this review stop the schedule so they can be checked again.'}
            </p>
            <div className={styles.presets}>
              <Button variant="secondary" disabled={pending} onClick={() => preset(false)}>
                Tomorrow 9:00 AM
              </Button>
              <Button variant="secondary" disabled={pending} onClick={() => preset(true)}>
                Monday 9:00 AM
              </Button>
            </div>
            {result && !result.ok && (
              <p ref={scheduleError} tabIndex={-1} role="alert" className="notice notice-error">
                {result.message}
              </p>
            )}
            <Field
              density="compact"
              id="release-schedule-time"
              label={`Date and time (${zone})`}
              help={['Choose at least one minute from now.', scheduleHint].filter(Boolean).join(' ')}
            >
              <input
                id="release-schedule-time"
                type="datetime-local"
                value={time}
                disabled={pending}
                onChange={event => {
                  setTime(event.target.value)
                  scheduleRequestId.current = null
                }}
              />
            </Field>
            {review}
          </div>
        </Drawer>
      )}
      {confirm && current && (
        <ConfirmDialog
          size={confirm === 'publish' ? 'medium' : undefined}
          title={confirm === 'publish' ? 'Publish selected changes?' : 'Cancel this review?'}
          what={
            confirm === 'publish' ? (
              <div className={shared.stack}>
                <p>
                  {current.snapshot.length} selected {current.snapshot.length === 1 ? 'change will' : 'changes will'} go
                  live together.
                </p>
                <div>
                  <strong>What’s changing</strong>
                  <ul>
                    {current.snapshot.map(item => (
                      <li key={item.key}>
                        {releaseLabel(item)}
                        {descriptions.releaseId === current.id && descriptions.values[item.key] && (
                          <p className={styles.muted}>{descriptions.values[item.key]!.summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  {pending && (
                    <p role="status">
                      Publishing the selected changes and updating their pages. Keep this window open; this may take a
                      minute.
                    </p>
                  )}
                  <strong>Checks</strong>
                  <p>
                    {current.preview_report.length}{' '}
                    {current.preview_report.length === 1 ? 'page checked' : 'pages checked'} ·{' '}
                    {hasSamples
                      ? 'Sample content approved'
                      : blocked
                        ? 'Recorded exception reviewed'
                        : 'Ready to publish'}
                  </p>
                </div>
              </div>
            ) : (
              'This prepared review will close. Saved drafts stay available.'
            )
          }
          reassurance="Your earlier content remains in history."
          confirmLabel={confirm === 'publish' ? 'Publish selected' : 'Cancel review'}
          tone={confirm === 'publish' ? 'publish' : native ? 'primary' : 'danger'}
          pending={pending}
          error={result && !result.ok ? result.message : undefined}
          onCancel={() => {
            if (!inFlight.current) setConfirm(null)
          }}
          onConfirm={() =>
            run(
              () =>
                confirm === 'publish'
                  ? publishRelease(current.id, override, samplesConfirmed)
                  : cancelRelease(current.id),
              true,
            )
          }
        />
      )}
    </section>
  )
}
