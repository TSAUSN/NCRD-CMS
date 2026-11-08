import type { Dispatch, SetStateAction } from 'react'
import { isDirty, type EditorState, type SaveQueue } from '@cms/domain'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { PageEditorProps } from './editor-types.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type Current<T> = { current: T }
type Set<T> = Dispatch<SetStateAction<T>>
type Start = (action: () => Promise<void>) => void
import { loadPageSavedReview } from './page-review-actions.ts'
import { preparePageSchedule } from './page-schedule-actions.ts'
import type { PagePublishReview } from './editor-publish-dialogs.tsx'

type Inputs = {
  draft: {
    props: Pick<PageEditorProps, 'pageId'>
    currentEditor: Current<EditorState>
    queue: Current<SaveQueue<SaveSnapshot>>
    savedVersionId: Current<string | null>
    setResult: Set<ActionResult | null>
    startTransition: Start
  }
  review: {
    reviewFlight: Current<boolean>
    transitionPending: boolean
    setReviewBusy: Set<boolean>
    setPageReview: Set<PagePublishReview | null>
    flushForReview: () => Promise<boolean>
    setPublishReviewOpen: Set<boolean>
    pageReview: PagePublishReview | null
    publish: () => void
  }
  schedule: {
    scheduleFlight: Current<boolean>
    setScheduling: Set<boolean>
    setScheduleFirstReview: Set<boolean>
    scheduleRequest: Current<{ signature: string; id: string } | null>
    router: { push: (href: string) => void }
  }
}

/** Check the exact saved revision before opening a publish or schedule decision. */
export function savedReviewCommands({ draft, review, schedule }: Inputs) {
  const { props, currentEditor, queue, savedVersionId, setResult, startTransition } = draft
  const {
    reviewFlight,
    transitionPending,
    setReviewBusy,
    setPageReview,
    flushForReview,
    setPublishReviewOpen,
    pageReview,
    publish,
  } = review
  const { scheduleFlight, setScheduling, setScheduleFirstReview, scheduleRequest, router } = schedule
  const openPagePublishReview = () => {
    if (reviewFlight.current || transitionPending) return
    reviewFlight.current = true
    setReviewBusy(true)
    setResult(null)
    setPageReview(null)
    startTransition(async () => {
      try {
        if (!(await flushForReview())) return
        const versionId = savedVersionId.current
        const currentRevision = String(queue.current.revision())
        if (!versionId) {
          setResult({ ok: false, kind: 'error', message: 'Save a draft before reviewing this page.' })
          return
        }
        const outcome = await loadPageSavedReview(props.pageId, currentRevision, versionId)
        if (!outcome.ok) {
          setResult({ ok: false, kind: 'error', message: outcome.message })
          return
        }
        if (
          isDirty(currentEditor.current) ||
          queue.current.busy() ||
          versionId !== savedVersionId.current ||
          currentRevision !== String(queue.current.revision())
        ) {
          setResult({
            ok: false,
            kind: 'error',
            message: 'You made more edits while changes were checked. Save the latest draft and choose Publish again.',
          })
          return
        }
        setResult(null)
        setPageReview(outcome)
        setPublishReviewOpen(true)
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The saved changes could not be checked. Your draft is still here. Try again before publishing.',
        })
      } finally {
        reviewFlight.current = false
      }
    })
  }
  const confirmPagePublishReview = () => {
    setPublishReviewOpen(false)
    if (
      !pageReview ||
      isDirty(currentEditor.current) ||
      queue.current.busy() ||
      pageReview.versionId !== savedVersionId.current ||
      pageReview.revision !== String(queue.current.revision())
    ) {
      setResult({
        ok: false,
        kind: 'error',
        message: 'The page changed after review. Save the latest draft and choose Publish again.',
      })
      return
    }
    publish()
  }

  const schedulePageReview = () => {
    if (scheduleFlight.current || transitionPending) return
    scheduleFlight.current = true
    setScheduling(true)
    setScheduleFirstReview(false)
    setResult(null)
    startTransition(async () => {
      try {
        if (!(await flushForReview())) return
        const versionId = savedVersionId.current
        if (!versionId) {
          setResult({ ok: false, kind: 'error', message: 'Save a draft before scheduling this page.' })
          return
        }
        const currentRevision = String(queue.current.revision())
        const signature = versionId + ':' + currentRevision
        if (scheduleRequest.current?.signature !== signature)
          scheduleRequest.current = { signature, id: crypto.randomUUID() }
        setResult({
          ok: true,
          revision: Number(currentRevision),
          versionId,
          message: 'Preparing the saved page review. Nothing is scheduled yet. This can take up to a minute…',
        })
        const outcome = await preparePageSchedule(props.pageId, currentRevision, versionId, scheduleRequest.current.id)
        if (!outcome.ok) {
          setScheduleFirstReview('firstSiteReview' in outcome && outcome.firstSiteReview === true)
          setResult({ ok: false, kind: 'error', message: outcome.message })
          return
        }
        if (
          isDirty(currentEditor.current) ||
          queue.current.busy() ||
          savedVersionId.current !== versionId ||
          String(queue.current.revision()) !== currentRevision
        ) {
          setResult({
            ok: false,
            kind: 'error',
            message:
              'You made more edits while the review was prepared. Save the latest draft and choose Schedule again. Nothing is scheduled.',
          })
          return
        }
        router.push('/sites/' + outcome.siteId + '/publishing?release=' + outcome.releaseId + '&intent=schedule')
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The review could not be confirmed. Your saved draft is private. Check Publish before retrying.',
        })
      } finally {
        scheduleFlight.current = false
      }
    })
  }
  return { openPagePublishReview, confirmPagePublishReview, schedulePageReview }
}
