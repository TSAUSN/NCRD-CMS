import type { CollectionReview, CollectionReviewComment } from '../lib/collection-review.ts'
import type { ReviewPerson } from '../lib/review-queries.ts'
import { reviewTime } from '../lib/review-time.ts'
import {
  addCollectionReviewComment,
  resolveCollectionReviewComment,
  type CollectionReviewResult,
} from '../app/collection-review-actions.ts'
import { Button, Field } from './ui/index.ts'
import type { useCommentDraft } from './use-comment-draft.ts'
import workspaceFormsStyles from './workspace-styles/workspace-forms.module.css'
import listInspectorStyles from './workspace-styles/list-inspector.module.css'

export type RunCollectionReviewAction = (
  action: (data: FormData) => Promise<CollectionReviewResult>,
  values: Record<string, string>,
  comment?: boolean,
) => void

export function CollectionReviewDiscussion({
  selected,
  fullScreen,
  comments,
  people,
  pending,
  actorId,
  commentDraft,
  act,
  setResult,
}: {
  selected: CollectionReview
  fullScreen: boolean
  comments: CollectionReviewComment[]
  people: ReviewPerson[]
  pending: boolean
  actorId: string
  commentDraft: ReturnType<typeof useCommentDraft>
  act: RunCollectionReviewAction
  setResult: (result: CollectionReviewResult) => void
}) {
  const { body, setBody, mentions, setMentions } = commentDraft
  const personNames = new Map(people.map(person => [person.id, person.displayName]))
  return (
    <section className={fullScreen ? listInspectorStyles.formStack : 'review-discussion'} aria-label="Discussion">
      <h3>Discussion</h3>
      {!comments.length && <p className="muted">No comments yet. Add context or ask about a specific field.</p>}
      <div className="review-comments">
        {comments.map(comment => (
          <article key={comment.id} className={comment.resolvedAt ? 'is-resolved' : undefined}>
            <div className="review-comment-head">
              <strong>{comment.authorName}</strong>
              <small>{reviewTime(comment.createdAt)}</small>
              {comment.canResolve && (
                <Button
                  variant="secondary"
                  size="s"
                  disabled={pending}
                  onClick={() =>
                    act(resolveCollectionReviewComment, {
                      commentId: comment.id,
                      resolved: String(!comment.resolvedAt),
                    })
                  }
                >
                  {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                </Button>
              )}
            </div>
            <p>{comment.body}</p>
            {comment.mentions.length > 0 && (
              <small>Mentioned {comment.mentions.map(id => personNames.get(id) ?? 'a teammate').join(', ')}</small>
            )}
          </article>
        ))}
      </div>
      {selected.status === 'open' ? (
        <>
          <Field id="collection-review-comment" label="Add a comment">
            <textarea
              id="collection-review-comment"
              rows={3}
              maxLength={4000}
              disabled={pending}
              value={body}
              onChange={event => setBody(event.target.value)}
            />
          </Field>
          <div className={workspaceFormsStyles.actions} role="group" aria-label="Mention a teammate">
            {people.map(person => (
              <Button
                key={person.id}
                variant="secondary"
                size="s"
                disabled={pending}
                aria-pressed={mentions.includes(person.id)}
                onClick={() =>
                  setMentions(current =>
                    current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id],
                  )
                }
              >
                @{person.displayName}
              </Button>
            ))}
          </div>
          {actorId && commentDraft.restored && (
            <p role="status">
              {commentDraft.dirty
                ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
            </p>
          )}
          <div className={workspaceFormsStyles.actions}>
            <Button
              disabled={pending || !body.trim()}
              onClick={() =>
                act(
                  addCollectionReviewComment,
                  { reviewId: selected.id, body, mentions: JSON.stringify(mentions) },
                  true,
                )
              }
            >
              Add comment
            </Button>
            {actorId && body && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  const saved = await commentDraft.saveDraft()
                  if (!saved.ok) setResult({ ok: false, message: saved.message ?? 'The draft could not be saved.' })
                }}
              >
                Save comment draft
              </Button>
            )}
          </div>
        </>
      ) : actorId && body ? (
        <>
          <h4>Your unsent comment</h4>
          <p>{body}</p>
          <p>This private draft has not been added to the review.</p>
          <Button variant="secondary" onClick={commentDraft.clear}>
            Discard comment draft
          </Button>
        </>
      ) : null}
    </section>
  )
}
