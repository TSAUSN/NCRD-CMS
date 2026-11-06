'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@cms/domain'
import { asUser } from '@cms/platform'
import { currentSession } from '../lib/session.ts'

export type CollectionReviewResult = { ok: boolean; message: string; reviewId?: string }
async function command(sql: string, values: unknown[], message: string): Promise<CollectionReviewResult> {
  const session = await currentSession()
  if (!session) return { ok: false, message: 'Sign in again to continue.' }
  try {
    const id = await asUser(
      { userId: session.principal.userId },
      async client => (await client.query<{ id: string }>(sql, values)).rows[0]!.id,
    )
    revalidatePath('/inbox')
    revalidatePath('/sites', 'layout')
    return { ok: true, message, reviewId: id }
  } catch (error) {
    if (error instanceof DomainError)
      return {
        ok: false,
        message:
          error.kind === 'stale_revision'
            ? 'This review no longer matches the saved list. Compare the submitted content with the current draft, then submit the draft again.'
            : error.kind === 'not_authorized'
              ? 'You do not have permission to make this change.'
              : error.message,
      }
    return { ok: false, message: 'The request could not be completed. Reload and try again.' }
  }
}
export async function submitCollectionReview(data: FormData): Promise<CollectionReviewResult> {
  return command(
    'SELECT app.submit_collection_for_review($1,$2,$3,$4) AS id',
    [data.get('collectionId'), data.get('schemaRevision'), data.get('entryRevision'), data.get('note') ?? ''],
    'Submitted for review. Your saved list is waiting for an editor; the live site has not changed.',
  )
}
export async function decideCollectionReview(data: FormData): Promise<CollectionReviewResult> {
  const approve = data.get('approve') === 'true'
  return command(
    'SELECT app.decide_collection_review($1,$2,$3) AS id',
    [data.get('reviewId'), approve, data.get('reason') ?? ''],
    approve ? 'Approved and published the submitted list.' : 'Returned with feedback. The live site has not changed.',
  )
}
export async function addCollectionReviewComment(data: FormData): Promise<CollectionReviewResult> {
  return command(
    'SELECT app.add_collection_review_comment($1,$2,$3::jsonb) AS id',
    [data.get('reviewId'), data.get('body'), data.get('mentions') ?? '[]'],
    'Comment added.',
  )
}
export async function resolveCollectionReviewComment(data: FormData): Promise<CollectionReviewResult> {
  return command(
    'SELECT app.resolve_collection_review_comment($1,$2) AS id',
    [data.get('commentId'), data.get('resolved') === 'true'],
    'Comment updated.',
  )
}
