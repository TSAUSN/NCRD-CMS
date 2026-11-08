import { useCommentDraft } from '../../components/use-comment-draft.ts'
import { requestClientNavigation } from '../../components/navigation-guard.ts'
import type { ReleasePresentation } from '../../lib/release-copy.ts'
import { useEffect, useMemo, useState, useTransition, useRef, type ReactNode } from 'react'
import type { ReadinessReport } from '@cms/domain'
import {
  addReviewComment,
  approveReviewSubmission,
  rejectReviewSubmission,
  resolveReviewComment,
} from '../actions/reviews.ts'
import { type ActionResult } from '../../lib/action-result.ts'
import type { ReviewComment, ReviewPerson, ReviewSubmission } from '../../lib/review-queries.ts'

export type Filter = 'waiting' | 'returned' | 'decided' | 'all'

export type ReviewWorkspaceProps = {
  fullScreen?: boolean
  actorId?: string
  queueHeader?: ReactNode
  unavailable?: boolean
  comparison?: ReleasePresentation | null
  initialQuery?: string
  initialFilter?: string
  reviews: ReviewSubmission[]
  selected: ReviewSubmission | null
  comments: ReviewComment[]
  people: ReviewPerson[]
  readiness: ReadinessReport | null
  basePath: string
}

export function useReviewModel({
  fullScreen = false,
  actorId = '',
  queueHeader,
  unavailable = false,
  comparison,
  initialQuery = '',
  initialFilter,
  reviews,
  selected,
  comments,
  people,
  readiness,
  basePath,
}: ReviewWorkspaceProps) {
  const [filter, setFilter] = useState<Filter>(
    ['waiting', 'returned', 'decided', 'all'].includes(initialFilter ?? '')
      ? (initialFilter as Filter)
      : fullScreen && selected?.status === 'rejected'
        ? 'returned'
        : fullScreen && selected && selected.status !== 'open'
          ? 'decided'
          : 'waiting',
  )
  const [query, setQuery] = useState(initialQuery)
  const [result, setResult] = useState<ActionResult | null>(null)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [sampleOpen, setSampleOpen] = useState(false)
  const [samplesConfirmed, setSamplesConfirmed] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [pending, startTransition] = useTransition()
  const commentDraft = useCommentDraft(
    actorId,
    selected?.id ?? '',
    pending,
    Boolean(actorId),
    fullScreen ? undefined : 'your page review comment (saved only in this browser)',
  )
  const { body: commentBody, setBody: setCommentBody, mentions, setMentions } = commentDraft
  const [tab, setTab] = useState('changes')
  const [phase, setPhase] = useState<'approve' | 'return' | 'comment' | 'resolve' | null>(null)
  const lastStatus = useRef(selected?.status)
  useEffect(() => {
    if (fullScreen && selected && lastStatus.current !== selected.status)
      setFilter(selected.status === 'open' ? 'waiting' : selected.status === 'rejected' ? 'returned' : 'decided')
    lastStatus.current = selected?.status
  }, [fullScreen, selected?.status])

  // Every draft control below belongs to one immutable request. A route change
  // swaps `selected` without remounting this workbench; clear the old request's
  // words before they can be posted or used as a decision on the new one.
  useEffect(() => {
    setResult(null)
    setConfirmApprove(false)
    setSampleOpen(false)
    setSamplesConfirmed(false)
    setRejectOpen(false)
    setRejectReason('')
    setOverrideOpen(false)
    setOverrideReason('')
  }, [selected?.id])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return reviews.filter(review => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'waiting' && review.status === 'open') ||
        (filter === 'returned' && review.status === 'rejected') ||
        (filter === 'decided' && (review.status === 'approved' || review.status === 'superseded'))
      const matchesQuery =
        !needle ||
        [review.pageTitle, review.siteName, review.submittedByName, review.requestNote].some(value =>
          value.toLowerCase().includes(needle),
        )
      return matchesFilter && matchesQuery
    })
  }, [filter, query, reviews])

  function approve(override?: string, sampleConsent = samplesConfirmed) {
    if (!selected) return
    setPhase('approve')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        if (override) data.set('overrideReason', override)
        if (sampleConsent) data.set('sampleContentConfirmed', 'true')
        const outcome = await approveReviewSubmission(data)
        setResult(outcome)
        if (!outcome.ok && outcome.kind === 'blocked') {
          if (outcome.report.blocking.some(finding => finding.rule === 'sample_content') && !sampleConsent)
            setSampleOpen(true)
          else setOverrideOpen(true)
        }
        if (outcome.ok) {
          window.dispatchEvent(new Event('cms:inbox-changed'))
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function reject(reason: string) {
    if (!selected) return
    setPhase('return')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        data.set('reason', reason)
        const outcome = await rejectReviewSubmission(data)
        setResult(outcome)
        if (outcome.ok) {
          window.dispatchEvent(new Event('cms:inbox-changed'))
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function postComment() {
    if (!selected || !commentBody.trim()) return
    setPhase('comment')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('submissionId', selected.id)
        data.set('body', commentBody)
        data.set('mentions', JSON.stringify(mentions))
        const outcome = await addReviewComment(data)
        setResult(outcome)
        if (outcome.ok) {
          commentDraft.clear()
          // The action revalidates this route; a second refresh can overtake its result.
        }
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  function toggleResolved(comment: ReviewComment) {
    setPhase('resolve')
    startTransition(async () => {
      try {
        const data = new FormData()
        data.set('commentId', comment.id)
        data.set('resolved', String(comment.resolvedAt === null))
        const outcome = await resolveReviewComment(data)
        setResult(outcome)
        // resolveReviewComment revalidates this route with the saved result.
      } catch {
        setResult({
          ok: false,
          kind: 'error',
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }

  const chooseDecision = (run: () => void) => {
    if (!actorId || requestClientNavigation(run)) run()
  }
  const presentation = selected?.story ?? comparison
  const notes = comments.filter(comment => comment.resolvedAt === null).length
  const canDecide = selected?.status === 'open' && selected.isCurrent && selected.canReview
  return {
    actorId,
    queueHeader,
    unavailable,
    reviews,
    selected,
    comments,
    people,
    readiness,
    basePath,
    filter,
    setFilter,
    query,
    setQuery,
    result,
    setResult,
    confirmApprove,
    setConfirmApprove,
    rejectOpen,
    setRejectOpen,
    rejectReason,
    setRejectReason,
    sampleOpen,
    setSampleOpen,
    setSamplesConfirmed,
    overrideOpen,
    setOverrideOpen,
    overrideReason,
    setOverrideReason,
    pending,
    commentDraft,
    commentBody,
    setCommentBody,
    mentions,
    setMentions,
    tab,
    setTab,
    phase,
    visible,
    approve,
    reject,
    postComment,
    toggleResolved,
    chooseDecision,
    presentation,
    notes,
    canDecide,
  }
}

export type ReviewModel = ReturnType<typeof useReviewModel>
