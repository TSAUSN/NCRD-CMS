'use client'
import { useCommentDraft } from './use-comment-draft.ts'
import { requestClientNavigation } from './navigation-guard.ts'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react'
import type { CollectionReview, CollectionReviewComment } from '../lib/collection-review.ts'
import type { ReviewPerson } from '../lib/review-queries.ts'
import { decideCollectionReview, type CollectionReviewResult } from '../app/collection-review-actions.ts'
import { Button } from './ui/index.ts'
import { ConfirmDialog, ReasonDialog } from './confirm.tsx'
import { CollectionReviewDiscussion, type RunCollectionReviewAction } from './collection-review-discussion.tsx'
import { CompactCollectionReview, FullCollectionReview } from './collection-review-views.tsx'

export function CollectionReviewPanel({
  reviews,
  selected,
  comments,
  people,
  basePath,
  children,
  fullScreen = false,
  actorId = '',
  queueHeader,
  unavailable = false,
  initialQuery = '',
  initialIncludeHistory,
}: {
  reviews: CollectionReview[]
  selected: CollectionReview | null
  comments: CollectionReviewComment[]
  people: ReviewPerson[]
  basePath: string
  children: ReactNode
  fullScreen?: boolean
  actorId?: string
  queueHeader?: ReactNode
  unavailable?: boolean
  initialQuery?: string
  initialIncludeHistory?: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<CollectionReviewResult | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [reason, setReason] = useState('')
  const commentDraft = useCommentDraft(
    actorId,
    selected?.id ?? '',
    pending,
    Boolean(actorId),
    fullScreen ? undefined : 'your list review comment (saved only in this browser)',
  )
  const [tab, setTab] = useState('changes')
  const [query, setQuery] = useState(initialQuery)
  const [includeHistory, setIncludeHistory] = useState(initialIncludeHistory ?? selected?.status !== 'open')
  const act: RunCollectionReviewAction = (action, values, comment = false) => {
    startTransition(async () => {
      const data = new FormData()
      for (const [key, value] of Object.entries(values)) data.set(key, value)
      try {
        const outcome = await action(data)
        setResult(outcome)
        if (outcome.ok) {
          if (comment) commentDraft.clear()
          window.dispatchEvent(new Event('cms:inbox-changed'))
          router.refresh()
        }
      } catch {
        setResult({
          ok: false,
          message: 'The result could not be confirmed. Check the saved review status before trying again.',
        })
      }
    })
  }
  useEffect(() => {
    if (selected?.status !== 'open') setIncludeHistory(true)
  }, [selected?.status])
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return reviews.filter(
      item =>
        (includeHistory || item.status === 'open') &&
        (!term ||
          [item.submitted.name, item.siteName, item.submittedByName, item.note].some(value =>
            value.toLowerCase().includes(term),
          )),
    )
  }, [reviews, includeHistory, query])
  const chooseDecision = (run: () => void) => {
    if (!actorId || requestClientNavigation(run)) run()
  }
  const dialogs = (
    <>
      {' '}
      {confirm && selected && (
        <ConfirmDialog
          tone="publish"
          title="Publish this submitted list?"
          what={`The submitted items, order and removals in “${selected.submitted.name}” will become live wherever pages use this list.`}
          reassurance="A changed draft cannot replace the content you reviewed."
          confirmLabel="Approve and publish list"
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false)
            act(decideCollectionReview, { reviewId: selected.id, approve: 'true' })
          }}
        />
      )}
      {returnOpen && selected && (
        <ReasonDialog
          title="Return this list for changes?"
          explanation="The author will see your feedback in the list workspace. Live content stays as it is."
          label="What should change?"
          value={reason}
          onChange={setReason}
          confirmLabel="Return with feedback"
          onCancel={() => setReturnOpen(false)}
          onConfirm={() => {
            if (!reason.trim()) return
            setReturnOpen(false)
            act(decideCollectionReview, { reviewId: selected.id, approve: 'false', reason })
          }}
        />
      )}
    </>
  )
  const decision =
    selected?.status === 'open' && selected.canReview ? (
      <>
        <Button
          variant="secondary"
          disabled={pending || !selected.isCurrent}
          onClick={() => chooseDecision(() => setReturnOpen(true))}
        >
          Return with feedback
        </Button>
        <Button
          variant="publish"
          disabled={pending || !selected.isCurrent || !selected.canApprove}
          onClick={() => chooseDecision(() => setConfirm(true))}
        >
          Approve and publish list
        </Button>
      </>
    ) : null

  const discussion = selected && (
    <CollectionReviewDiscussion
      selected={selected}
      fullScreen={fullScreen}
      comments={comments}
      people={people}
      pending={pending}
      actorId={actorId}
      commentDraft={commentDraft}
      act={act}
      setResult={setResult}
    />
  )
  const view = {
    visible,
    selected,
    basePath,
    children,
    includeHistory,
    setIncludeHistory,
    decision,
    discussion,
    dialogs,
    result,
  }
  return fullScreen ? (
    <FullCollectionReview
      {...view}
      queueHeader={queueHeader}
      unavailable={unavailable}
      reviewCount={reviews.length}
      query={query}
      setQuery={setQuery}
      pending={pending}
      checkSavedStatus={() => chooseDecision(() => router.refresh())}
      tab={tab}
      setTab={setTab}
      unresolvedComments={comments.filter(comment => !comment.resolvedAt).length}
    />
  ) : (
    <CompactCollectionReview {...view} />
  )
}
