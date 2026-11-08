import { useNavigationGuard, requestLocalDraftNavigation } from '../../../../components/navigation-guard.ts'
import { localScheduleTime as resolveScheduleTime } from '../../../../lib/local-schedule-time.ts'
import { useEffect, useRef, useState } from 'react'
import type { PageRow } from '../../../../lib/queries.ts'
import { schedulePage, type ScheduleResult } from './schedule-actions.ts'
import type { RefObject } from 'react'
import type { ScheduleCommand, ScheduleWorkspaceProps } from './use-schedule-workspace.ts'
import { validScheduleChoices, validScheduleRequest } from './schedule-choice-recovery.ts'
type ScheduleDraftInputs = Pick<ScheduleWorkspaceProps, 'pages' | 'canManage' | 'available' | 'archived'> & {
  key: string
  pending: boolean
  inFlight: RefObject<boolean>
  result: ScheduleResult | null
  setResult: (value: ScheduleResult | null) => void
  run: ScheduleCommand
}

export function useSinglePageSchedule({
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
}: ScheduleDraftInputs) {
  const [pageId, setPageId] = useState(pages[0]?.id ?? '')
  const [selected, setSelected] = useState<PageRow | null>(pages[0] ?? null)
  const [action, setAction] = useState<'publish' | 'unpublish'>('publish')
  const [time, setTime] = useState('')
  const [zone, setZone] = useState('your device time zone')
  const [override, setOverride] = useState('')
  const requestId = useRef<string | null>(null)
  const [baseline, setBaseline] = useState('')
  const [saved, setSaved] = useState(false)
  const [draftError, setDraftError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const pin = selected
    ? {
        revision: selected.revision,
        draft_version_id: selected.draft_version_id,
        published_version_id: selected.published_version_id,
      }
    : null
  const fields = { pageId, action, time, zone, override, pin }
  const signature = JSON.stringify(fields)
  const dirty = canManage && available && !archived && !!baseline && signature !== baseline
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
    const page = pages[0]
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
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
        const record = JSON.parse(localStorage.getItem(key) ?? 'null')
        const data = record?.fields
        if (
          record?.version === 1 &&
          validScheduleChoices(data) &&
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
          if (validScheduleRequest(record.requestId)) requestId.current = record.requestId
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
  useNavigationGuard(singleLeave)
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
  const scheduleZone = zone === 'your device time zone' ? Intl.DateTimeFormat().resolvedOptions().timeZone : zone
  const scheduleTime = resolveScheduleTime(time, scheduleZone)
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

  function editTime(value: string) {
    setTime(value)
    requestId.current = null
  }
  function editOverride(value: string) {
    setOverride(value)
    requestId.current = null
  }
  function toggleForm() {
    const toggle = () => setFormOpen(value => !value)
    if (!formOpen || requestLocalDraftNavigation(singleLeave, toggle)) toggle()
  }
  function submit() {
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
  }
  return {
    dirty,
    zone,
    formOpen,
    toggleForm,
    submit,
    saved,
    clearChoices,
    draftError,
    pageId,
    action,
    choosePage,
    time,
    editTime,
    scheduleTime,
    current,
    versionId,
    changed,
    override,
    editOverride,
  }
}
