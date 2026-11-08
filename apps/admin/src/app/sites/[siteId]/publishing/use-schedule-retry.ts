import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { localScheduleTime as resolveScheduleTime } from '../../../../lib/local-schedule-time.ts'
import { useRef, useState } from 'react'
import { retrySchedule, type ScheduleResult } from './schedule-actions.ts'
import type { RefObject } from 'react'
import type { ScheduleCommand, ScheduleWorkspaceProps } from './use-schedule-workspace.ts'
import { validScheduleChoices, validScheduleRequest } from './schedule-choice-recovery.ts'
import type { ListedSchedule } from './use-schedule-workspace.ts'
type ScheduleRetryInputs = Pick<ScheduleWorkspaceProps, 'pages'> & {
  key: string
  pending: boolean
  inFlight: RefObject<boolean>
  result: ScheduleResult | null
  setResult: (value: ScheduleResult | null) => void
  run: ScheduleCommand
}

export function useScheduleRetry({ pages, key, pending, inFlight, result, setResult, run }: ScheduleRetryInputs) {
  const [retry, setRetry] = useState<{ job: ListedSchedule; pageRevision: string } | null>(null)
  const [retryTime, setRetryTime] = useState('')
  const [retryZone, setRetryZone] = useState('your device time zone')
  const [retryOverride, setRetryOverride] = useState('')
  const retryRequestId = useRef<string | null>(null)
  const [retryBaseline, setRetryBaseline] = useState('')
  const [retrySaved, setRetrySaved] = useState(false)
  const [retryDraftError, setRetryDraftError] = useState('')
  const retryKey = key && retry ? key + '.retry.' + retry.job.id : ''
  const retryFields = { time: retryTime, zone: retryZone, override: retryOverride, revision: retry?.pageRevision ?? '' }
  const retrySignature = JSON.stringify(retryFields)
  const retryDirty = !!retry && !!retryBaseline && retrySignature !== retryBaseline
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
  useNavigationGuard(retryLeave)
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
        const record = JSON.parse(localStorage.getItem(key + '.retry.' + job.id) ?? 'null')
        const data = record?.fields
        if (record?.version === 1 && validScheduleChoices(data) && typeof data.revision === 'string') {
          value = { time: data.time, zone: data.zone, override: data.override, revision: data.revision }
          setRetrySaved(true)
          if (validScheduleRequest(record.requestId)) retryRequestId.current = record.requestId
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
  const retryScheduleTime = resolveScheduleTime(
    retryTime,
    retryZone === 'your device time zone' ? Intl.DateTimeFormat().resolvedOptions().timeZone : retryZone,
  )

  function editRetryTime(value: string) {
    setRetryTime(value)
    retryRequestId.current = null
  }
  function editRetryOverride(value: string) {
    setRetryOverride(value)
    retryRequestId.current = null
  }
  function clearRetrySelection() {
    setRetry(null)
    retryRequestId.current = null
  }
  function submitRetry() {
    if (!retry) return
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
  }
  return {
    retry,
    clearRetrySelection,
    retryDirty,
    retrySaved,
    clearRetryChoices,
    retryDraftError,
    retryZone,
    retryTime,
    retryScheduleTime,
    editRetryTime,
    retryOverride,
    editRetryOverride,
    closeRetry,
    openRetry,
    submitRetry,
  }
}
