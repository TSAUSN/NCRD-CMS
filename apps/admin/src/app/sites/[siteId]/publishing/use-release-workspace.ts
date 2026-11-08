import type { ReleaseStamp } from '../../../../lib/release-stamps.ts'
import { selectedReleaseKeys, type InitialReleasePick } from '../../../../lib/release-selection.ts'
import { useEffect, useRef, useState, useTransition } from 'react'
import type { ReleaseItem, ReleaseRow } from '../../../../lib/releases.ts'
import type { ReleasePresentation } from '../../../../lib/release-copy.ts'
import { requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { prepareRelease, type ReleaseResult } from './release-actions.ts'
import { useReleaseScheduleIntent } from './use-release-schedule-intent.ts'

export type ListedRelease = Omit<ReleaseRow, 'created_at' | 'finished_at'> & {
  created_at: string
  finished_at: string | null
  actorLabel?: string
}

export type ReleaseWorkspaceProps = {
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
}

export function useReleaseWorkspace({
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
}: ReleaseWorkspaceProps) {
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
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | null>(null)
  const [descriptions, setDescriptions] = useState({ releaseId: initialReleaseId, values: initialReviewPresentations })
  const [compare, setCompare] = useState<ReleaseItem | null>(null)
  const [transitionPending, startTransition] = useTransition()
  const [recoveryPending, setRecoveryPending] = useState(false)
  const pending = transitionPending || recoveryPending
  const scheduleError = useRef<HTMLParagraphElement>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const requestId = useRef<string | null>(null)
  const inFlight = useRef(false)
  const schedule = useReleaseScheduleIntent({
    siteId,
    actorId,
    current,
    initialReleaseId,
    initialSchedule,
    initialScheduleTime,
    pending,
    inFlight,
  })
  const { override, setOverride, samplesConfirmed, setSamplesConfirmed, scheduleOpen, setScheduleOpen, leaveIntent } =
    schedule
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
  return {
    current,
    descriptions,
    setCompare,
    pending,
    canPublish,
    canAdminister,
    archived,
    schedulingAvailable,
    setResult,
    override,
    setOverride,
    samplesConfirmed,
    setSamplesConfirmed,
    setConfirm,
    scheduleOpen,
    setScheduleOpen,
    reviewHeading,
    setRecoveryPending,
    hasSamples,
    blocked,
    canExecute,
    ready,
    setCurrent,
    schedule,
    siteId,
    items,
    initialRelease,
    presentations,
    view,
    native,
    stamps,
    leaveIntent,
    checkedItems,
    picked,
    resetReview,
    setSelected,
    chooseItem,
    prepare,
    releases,
    result,
    confirm,
    inFlight,
    run,
    scheduleError,
    headerTarget,
    transitionPending,
    compare,
  }
}

export type ReleaseWorkspaceModel = ReturnType<typeof useReleaseWorkspace>
