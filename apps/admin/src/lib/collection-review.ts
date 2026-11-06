import 'server-only'
import { asUser } from '@cms/platform'
import type { CollectionField, CollectionPresentation } from '@cms/schema'
import type { ReviewStatus } from '@cms/domain'

export type CollectionReviewContent = {
  name: string
  schemaId: string | null
  fields: CollectionField[]
  presentation: CollectionPresentation | null
  entries: {
    id: string
    versionId: string | null
    stableKey: string
    sortIndex: number | null
    archived: boolean
    values: Record<string, unknown> | null
  }[]
}
export type CollectionReview = {
  id: string
  siteId: string
  siteName: string
  collectionId: string
  snapshotId: string
  status: ReviewStatus
  note: string
  decisionNote: string
  submittedAt: string
  submittedByName: string
  decidedAt: string | null
  canReview: boolean
  canApprove: boolean
  isCurrent: boolean
  submitted: CollectionReviewContent
  live: CollectionReviewContent
  current: CollectionReviewContent
  commentCount: number
  unresolvedCount: number
}
export type CollectionReviewComment = {
  id: string
  body: string
  mentions: string[]
  authorName: string
  createdAt: string
  resolvedAt: string | null
  canResolve: boolean
}
export function listCollectionReviews(
  userId: string,
  options: { siteId?: string; reviewId?: string; collectionId?: string } = {},
): Promise<CollectionReview[]> {
  return asUser({ userId }, async client =>
    (
      await client.query<{ review: CollectionReview }>('SELECT app.collection_review_queue($1,$2,$3) AS review', [
        options.siteId ?? null,
        options.reviewId ?? null,
        options.collectionId ?? null,
      ])
    ).rows.map(row => row.review),
  )
}
export function listCollectionReviewComments(userId: string, reviewId: string): Promise<CollectionReviewComment[]> {
  return asUser({ userId }, async client =>
    (
      await client.query<{ comment: CollectionReviewComment }>('SELECT app.collection_review_comments($1) AS comment', [
        reviewId,
      ])
    ).rows.map(row => row.comment),
  )
}
