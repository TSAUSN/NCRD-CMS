import { localScheduleTime, localScheduleHint } from '../../../../lib/local-schedule-time.ts'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import type { ListedRelease } from './use-release-workspace.ts'

type ScheduleIntentInput = {
  siteId: string
  actorId: string
  current: ListedRelease | null
  initialReleaseId?: string
  initialSchedule: boolean
  initialScheduleTime: string
  pending: boolean
  inFlight: RefObject<boolean>
}
export function useReleaseScheduleIntent({
  siteId,
  actorId,
  current,
  initialReleaseId,
  initialSchedule,
  initialScheduleTime,
  pending,
  inFlight,
}: ScheduleIntentInput) {
  const [override, setOverride] = useState('')
  const [samplesConfirmed, setSamplesConfirmed] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(initialSchedule && current?.status === 'planned')
  const [time, setTime] = useState(initialScheduleTime)
  const [zone, setZone] = useState('your device time zone')
  const scheduleRequestId = useRef<string | null>(null)
  const [intentBaseline, setIntentBaseline] = useState('')
  const [intentSaved, setIntentSaved] = useState(false)
  const [intentError, setIntentError] = useState('')
  const intentKey = actorId && current ? 'cms.release-schedule.' + actorId + '.' + siteId + '.' + current.id : ''
  const intent = JSON.stringify({ time, zone, override })
  const intentDirty = !!current && current.status === 'planned' && !!intentBaseline && intent !== intentBaseline
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
  )
  const scheduleHint = localScheduleHint(time, scheduleTime)
  function preset(monday: boolean) {
    const date = new Date()
    date.setDate(date.getDate() + (monday ? (8 - date.getDay()) % 7 || 7 : 1))
    date.setHours(9, 0, 0, 0)
    setTime(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T09:00`,
    )
    scheduleRequestId.current = null
  }

  return {
    override,
    setOverride,
    samplesConfirmed,
    setSamplesConfirmed,
    scheduleOpen,
    setScheduleOpen,
    time,
    setTime,
    zone,
    intentSaved,
    intentError,
    scheduleTime,
    scheduleHint,
    scheduleRequestId,
    leaveIntent,
    closeSchedule,
    clearIntent,
    finishIntent,
    preset,
  }
}
