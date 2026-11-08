import workspaceFormsStyles from '../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../components/workspace-styles/list-inspector.module.css'
import reviewWorkbenchStyles from '../../components/workspace-styles/review-workbench.module.css'
import ownedStyles from './review-workspace-styles.module.css'
import { Button } from '../../components/ui/index.ts'
import { reviewTime as formatWhen } from '../../lib/review-time.ts'
import { Field } from '../../components/ui/index.ts'
import type { ReviewSubmission } from '../../lib/review-queries.ts'

import type { ReviewModel } from './use-review-model.ts'
import { initials } from './review-display.tsx'

export function FullReviewDiscussion({ model, selected }: { model: ReviewModel; selected: ReviewSubmission }) {
  const {
    comments,
    people,
    setResult,
    pending,
    commentDraft,
    commentBody,
    setCommentBody,
    mentions,
    setMentions,
    postComment,
    toggleResolved,
  } = model
  return (
    <section className={listInspectorStyles.formStack} aria-label="Discussion">
      <h3>Discussion</h3>
      {comments.length === 0 ? (
        <p>No comments yet. Add a comment about anything that should change.</p>
      ) : (
        comments.map(comment => (
          <article className={workspaceFormsStyles.formPanel + ' ' + reviewWorkbenchStyles.panel} key={comment.id}>
            <div className={reviewWorkbenchStyles.workbenchHeader}>
              <div>
                <strong>{comment.authorName}</strong>
                <p>
                  <time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time>
                </p>
              </div>
              {comment.canResolve && (
                <Button variant="secondary" size="s" disabled={pending} onClick={() => toggleResolved(comment)}>
                  {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                </Button>
              )}
            </div>
            <p>{comment.body}</p>
            {comment.mentions.length > 0 && (
              <p className={recordTableStyles.meta}>
                Mentioned{' '}
                {comment.mentions
                  .map(id => people.find(person => person.id === id)?.displayName ?? 'a teammate')
                  .join(', ')}
              </p>
            )}
          </article>
        ))
      )}
      {selected.status === 'open' ? (
        <>
          <Field id="review-comment" label="Add a comment">
            <textarea
              id="review-comment"
              rows={4}
              maxLength={4000}
              value={commentBody}
              disabled={pending}
              onChange={event => setCommentBody(event.target.value)}
            />
          </Field>
          <div className={workspaceFormsStyles.actions} role="group" aria-label="Mention a teammate">
            {people.map(person => (
              <Button
                key={person.id}
                variant="secondary"
                size="s"
                aria-pressed={mentions.includes(person.id)}
                disabled={pending}
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
          {commentDraft.restored && (
            <p role="status">
              {commentDraft.dirty
                ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
            </p>
          )}
          <div className={workspaceFormsStyles.actions}>
            <Button
              variant={selected.canApprove ? 'secondary' : 'primary'}
              disabled={pending || !commentBody.trim()}
              onClick={postComment}
            >
              Add comment
            </Button>
            {commentBody && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  const saved = await commentDraft.saveDraft()
                  if (!saved.ok)
                    setResult({
                      ok: false,
                      kind: 'error',
                      message: saved.message ?? 'The draft could not be saved.',
                    })
                }}
              >
                Save comment draft
              </Button>
            )}
          </div>
        </>
      ) : commentBody ? (
        <section className={reviewWorkbenchStyles.panel + ' ' + workspaceFormsStyles.formPanel}>
          <h3>Your unsent comment</h3>
          <p>{commentBody}</p>
          <p>This private draft has not been added to the review.</p>
          <Button variant="secondary" onClick={commentDraft.clear}>
            Discard comment draft
          </Button>
        </section>
      ) : null}
    </section>
  )
}

export function EmbeddedReviewDiscussion({ model, selected }: { model: ReviewModel; selected: ReviewSubmission }) {
  const {
    actorId,
    comments,
    people,
    setResult,
    pending,
    commentDraft,
    commentBody,
    setCommentBody,
    mentions,
    setMentions,
    postComment,
    toggleResolved,
  } = model
  return (
    <section className={'review-discussion ' + reviewWorkbenchStyles.panel}>
      <div className={'review-panel-head ' + ownedStyles.workbenchHeading}>
        <div>
          <p className="eyebrow">Team context</p>
          <h3>Discussion</h3>
        </div>
        <span>{comments.filter(comment => comment.resolvedAt === null).length} unresolved</span>
      </div>
      <div className="review-comments">
        {comments.length === 0 ? (
          <p className="muted">No comments yet. Add one when context will help the next person.</p>
        ) : (
          comments.map(comment => (
            <article key={comment.id} className={comment.resolvedAt ? 'is-resolved' : undefined}>
              <div className="review-comment-head">
                <span className="review-avatar" aria-hidden="true">
                  {initials(comment.authorName)}
                </span>
                <div>
                  <strong>{comment.authorName}</strong>
                  <small>{formatWhen(comment.createdAt)}</small>
                </div>
                {comment.canResolve && (
                  <button type="button" className="link" disabled={pending} onClick={() => toggleResolved(comment)}>
                    {comment.resolvedAt ? 'Reopen' : 'Resolve'}
                  </button>
                )}
              </div>
              <p>{comment.body}</p>
              {comment.mentions.length > 0 && (
                <small>
                  Mentioned{' '}
                  {comment.mentions
                    .map(id => people.find(person => person.id === id)?.displayName ?? 'a teammate')
                    .join(', ')}
                </small>
              )}
            </article>
          ))
        )}
      </div>
      {selected.status === 'open' ? (
        <div className="review-comment-compose">
          <label htmlFor="review-comment">Add a comment</label>
          <textarea
            id="review-comment"
            rows={3}
            maxLength={4000}
            disabled={pending}
            value={commentBody}
            placeholder="Record context, a question, or a specific change."
            onChange={event => setCommentBody(event.target.value)}
          />
          <div className="review-mentions">
            <span>Mention</span>
            {people.map(person => (
              <button
                key={person.id}
                type="button"
                disabled={pending}
                aria-pressed={mentions.includes(person.id)}
                onClick={() =>
                  setMentions(current =>
                    current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id],
                  )
                }
              >
                @{person.displayName}
              </button>
            ))}
          </div>
          {commentDraft.restored && (
            <p role="status">
              {commentDraft.dirty
                ? 'An earlier comment draft is saved in this browser. Your latest edits are unsaved.'
                : 'A private comment draft is saved in this browser. Add comment sends it to the review.'}
            </p>
          )}
          <div className={workspaceFormsStyles.actions}>
            <button type="button" className="navy" disabled={pending || !commentBody.trim()} onClick={postComment}>
              Add comment
            </button>
            {actorId && commentBody && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  const saved = await commentDraft.saveDraft()
                  if (!saved.ok)
                    setResult({
                      ok: false,
                      kind: 'error',
                      message: saved.message ?? 'The draft could not be saved.',
                    })
                }}
              >
                Save comment draft
              </Button>
            )}
          </div>
        </div>
      ) : actorId && commentBody ? (
        <section className={workspaceFormsStyles.formPanel + ' ' + reviewWorkbenchStyles.panel}>
          <h4>Your unsent comment</h4>
          <p>{commentBody}</p>
          <p>This private draft has not been added to the review.</p>
          <Button variant="secondary" onClick={commentDraft.clear}>
            Discard comment draft
          </Button>
        </section>
      ) : null}
    </section>
  )
}
