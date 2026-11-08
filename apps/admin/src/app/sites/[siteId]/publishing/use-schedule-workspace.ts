import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PageRow } from '../../../../lib/queries.ts'
import type { ScheduleRow } from '../../../../lib/scheduling.ts'
import { type ScheduleResult } from './schedule-actions.ts'
import { useSinglePageSchedule } from './use-single-page-schedule.ts'
import { useScheduleRetry } from './use-schedule-retry.ts'
export type ListedSchedule = Omit<ScheduleRow, 'run_at'> & { run_at: string }
export type ScheduleWorkspaceProps = {
  actorId?: string
  siteId?: string
  pages: PageRow[]
  schedules: ListedSchedule[]
  available: boolean
  canManage: boolean
  archived: boolean
}

export type ScheduleCommand = (command: () => Promise<ScheduleResult>, onSuccess?: () => void) => void
export function useScheduleWorkspace({
  pages,
  available,
  canManage,
  archived,
  siteId,
  actorId = '',
}: ScheduleWorkspaceProps) {
  const router = useRouter()
  const [result, setResult] = useState<ScheduleResult | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const inFlight = useRef(false)
  const key = actorId && siteId ? 'cms.page-schedule.' + actorId + '.' + siteId : ''

  const single = useSinglePageSchedule({
    pages,
    canManage,
    available,
    archived,
    key,
    pending,
    inFlight,
    result,
    setResult,
    run,
  })
  const retry = useScheduleRetry({ pages, key, pending, inFlight, result, setResult, run })
  const { dirty } = single
  const { retryDirty, clearRetrySelection } = retry
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || retryDirty || pending || inFlight.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, retryDirty, pending])
  function run(command: () => Promise<ScheduleResult>, onSuccess?: () => void) {
    if (inFlight.current) return
    inFlight.current = true
    startTransition(async () => {
      try {
        const outcome = await command()
        setResult(outcome)
        if (outcome.ok) {
          setCancelId(null)
          clearRetrySelection()
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

  return { single, retry, pending, result, setResult, cancelId, setCancelId, run }
}
export type ScheduleWorkspaceModel = ReturnType<typeof useScheduleWorkspace>
