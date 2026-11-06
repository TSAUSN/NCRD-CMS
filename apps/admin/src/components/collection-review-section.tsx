import type { ReactNode } from 'react'
import { collectionReviewRichText } from '../lib/collection-review-richtext.ts'
import type { CollectionField } from '@cms/schema'
import {
  listCollectionReviews,
  listCollectionReviewComments,
  type CollectionReviewContent,
} from '../lib/collection-review.ts'
import { listReviewPeople } from '../lib/review-queries.ts'
import { CollectionReviewPanel } from './collection-review-panel.tsx'
import styles from './collection-review.module.css'
import workspace from './workspace.module.css'

export async function CollectionReviewSection({
  userId,
  siteId,
  selectedId,
  basePath,
  hideWhenEmpty = false,
  fullScreen = false,
  queueHeader,
  initialQuery,
  initialIncludeHistory,
}: {
  userId: string
  siteId?: string
  selectedId?: string
  basePath: string
  /** On a screen with other work, say nothing until there is something to review. */
  hideWhenEmpty?: boolean
  fullScreen?: boolean
  queueHeader?: ReactNode
  initialQuery?: string
  initialIncludeHistory?: boolean
}) {
  const reviews = await listCollectionReviews(userId, siteId ? { siteId } : {})
  const exact = selectedId
    ? ((await listCollectionReviews(userId, { ...(siteId ? { siteId } : {}), reviewId: selectedId }))[0] ?? null)
    : null
  const selected = selectedId ? exact : (reviews.find(review => review.status === 'open') ?? reviews[0] ?? null)
  const listed = selected && !reviews.some(review => review.id === selected.id) ? [selected, ...reviews] : reviews
  if (hideWhenEmpty && !listed.length) return null
  const [comments, people] = selected
    ? await Promise.all([listCollectionReviewComments(userId, selected.id), listReviewPeople(userId, selected.siteId)])
    : [[], []]
  const comparison = selected ? (selected.isCurrent ? selected.live : selected.current) : null
  const snapshots =
    selected && comparison ? (
      <div className={styles.comparison}>
        <Snapshot content={selected.submitted} label="Submitted list" />
        <Snapshot content={comparison} label={selected.isCurrent ? 'Live when submitted' : 'Current saved draft'} />
      </div>
    ) : null
  const panel = (
    <CollectionReviewPanel
      key={selected?.id ?? 'none'}
      fullScreen={fullScreen}
      initialQuery={initialQuery}
      initialIncludeHistory={initialIncludeHistory}
      actorId={userId}
      queueHeader={queueHeader}
      unavailable={Boolean(selectedId && !selected)}
      reviews={listed}
      selected={selected}
      comments={comments}
      people={people}
      basePath={basePath}
    >
      {selected &&
        comparison &&
        (fullScreen ? (
          <section className={workspace.workbenchCompare} aria-label="Saved list changes">
            <h3>Saved list changes</h3>
            <p className={workspace.meta}>{describeChanges(comparison, selected.submitted)}</p>
            <ListChanges
              before={comparison}
              after={selected.submitted}
              beforeLabel={selected.isCurrent ? 'Live when submitted' : 'Current saved draft'}
              afterLabel={
                selected.status === 'approved'
                  ? 'Approved submission'
                  : selected.status === 'open' && selected.isCurrent
                    ? 'After approval'
                    : 'Submitted list'
              }
            />
            <details className={styles.allValues}>
              <summary>All saved values</summary>
              {snapshots}
            </details>
          </section>
        ) : (
          <>
            <p className="notice" role="note">
              {describeChanges(comparison, selected.submitted)}
            </p>
            {snapshots}
          </>
        ))}
    </CollectionReviewPanel>
  )
  if (fullScreen)
    return (
      <section id="collection-reviews" aria-label="List reviews">
        {panel}
      </section>
    )
  return (
    <section id="collection-reviews" className="inbox-section" aria-labelledby="collection-reviews-title">
      <h2 id="collection-reviews-title">List reviews</h2>
      <p>
        Review the submitted fields, items, order and removals together. Approval publishes this saved list everywhere
        pages use it.
      </p>
      {!listed.length ? (
        <p className="notice">No list submissions yet. Save a list’s draft, then choose “Submit for review”.</p>
      ) : (
        panel
      )}
    </section>
  )
}
function describeChanges(before: CollectionReviewContent, after: CollectionReviewContent): string {
  const activeBefore = before.entries.filter(item => !item.archived)
  const activeAfter = after.entries.filter(item => !item.archived)
  const beforeMap = new Map(activeBefore.map(item => [item.id, item]))
  const afterMap = new Map(activeAfter.map(item => [item.id, item]))
  const added = activeAfter.filter(item => !beforeMap.has(item.id)).length
  const removed = activeBefore.filter(item => !afterMap.has(item.id)).length
  const changed = activeAfter.filter(
    item => beforeMap.has(item.id) && JSON.stringify(item.values) !== JSON.stringify(beforeMap.get(item.id)?.values),
  ).length
  const reordered = activeAfter.some(
    item => beforeMap.has(item.id) && item.sortIndex !== beforeMap.get(item.id)?.sortIndex,
  )
  return `${added} added · ${removed} removed · ${changed} changed${reordered ? ' · order changed' : ''}${before.schemaId !== after.schemaId ? ' · fields changed' : ''}. Compare every submitted value below.`
}
function ListChanges({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: CollectionReviewContent
  after: CollectionReviewContent
  beforeLabel: string
  afterLabel: string
}) {
  const oldItems = before.entries.filter(entry => !entry.archived)
  const newItems = after.entries.filter(entry => !entry.archived)
  const fields = [...new Map([...before.fields, ...after.fields].map(field => [field.key, field])).values()]
  const ids = [...new Set([...newItems.map(entry => entry.id), ...oldItems.map(entry => entry.id)])]
  const changed = ids.flatMap(id => {
    const oldItem = oldItems.find(entry => entry.id === id),
      newItem = newItems.find(entry => entry.id === id)
    const present = (value: unknown) => value !== undefined && value !== null && value !== ''
    const values = fields.filter(field =>
      !oldItem
        ? present(newItem?.values?.[field.key])
        : !newItem
          ? present(oldItem.values?.[field.key])
          : JSON.stringify(oldItem.values?.[field.key]) !== JSON.stringify(newItem.values?.[field.key]),
    )
    const oldPosition = oldItems.findIndex(entry => entry.id === id),
      newPosition = newItems.findIndex(entry => entry.id === id)
    if (!values.length && oldPosition === newPosition) return []
    return [{ id, oldItem, newItem, values, oldPosition, newPosition }]
  })
  return (
    <>
      <div className={workspace.comparisonLabels}>
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      {changed.length ? (
        changed.map(({ id, oldItem, newItem, values, oldPosition, newPosition }) => (
          <section
            key={id}
            className={workspace.workbenchCompare + ' ' + styles.changedValues}
            aria-label={
              'Changes to ' +
              itemTitle(
                newItem?.values ?? oldItem?.values ?? null,
                after.presentation?.titleField ?? before.presentation?.titleField,
                Math.max(oldPosition, newPosition) + 1,
              )
            }
          >
            <h4>
              {itemTitle(
                newItem?.values ?? oldItem?.values ?? null,
                after.presentation?.titleField ?? before.presentation?.titleField,
                Math.max(oldPosition, newPosition) + 1,
              )}
            </h4>
            <dl className={workspace.comparisonRows}>
              {oldPosition !== newPosition && (
                <div>
                  <dt>Position in the list</dt>
                  <dd data-changed={oldItem ? 'before' : undefined}>
                    {oldItem ? oldPosition + 1 : 'Not in this version'}
                  </dd>
                  <dd data-changed={newItem ? 'after' : undefined}>{newItem ? newPosition + 1 : 'Removed item'}</dd>
                </div>
              )}
              {values.map(field => (
                <div key={field.key}>
                  <dt>{field.label}</dt>
                  <dd data-changed={oldItem ? 'before' : undefined}>
                    {oldItem ? <FieldValue field={field} value={oldItem.values?.[field.key]} /> : 'Not in this version'}
                  </dd>
                  <dd data-changed={newItem ? 'after' : undefined}>
                    {newItem ? <FieldValue field={field} value={newItem.values?.[field.key]} /> : 'Removed item'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      ) : (
        <p>
          The submitted item values and order match this comparison. Review any field design changes in All saved
          values.
        </p>
      )}
      {before.schemaId !== after.schemaId && (
        <p>Field design changed. Review both field designs in All saved values before approving.</p>
      )}
    </>
  )
}

function Snapshot({ content, label }: { content: CollectionReviewContent; label: string }) {
  return (
    <section className={styles.snapshot} aria-label={label}>
      <h3>{label}</h3>
      <p>
        {content.entries.filter(item => !item.archived).length} active{' '}
        {content.entries.filter(item => !item.archived).length === 1 ? 'item' : 'items'}
      </p>
      <details>
        <summary>Advanced</summary>
        <h4>Field design ({content.fields.length})</h4>
        <ul>
          {content.fields.map(field => (
            <li key={field.key}>
              <strong>{field.label}</strong> · {field.type}
              {field.required ? ' · required' : ''}
              {field.help ? ` · ${field.help}` : ''}
              {field.type === 'select' ? ` · choices: ${field.options.join(', ')}` : ''}
            </li>
          ))}
        </ul>
        {content.presentation && (
          <p>
            Card title: {content.presentation.titleField}. Subtitle: {content.presentation.subtitleField ?? 'none'}.
            Image: {content.presentation.imageField ?? 'none'}. Group: {content.presentation.groupField ?? 'none'}.
          </p>
        )}
      </details>
      {content.entries.length === 0 ? (
        <p className="muted">No items in this saved list.</p>
      ) : (
        <ol className={styles.entries}>
          {content.entries.map(entry => (
            <li key={entry.id}>
              <h4>
                {entry.archived ? 'Removed · ' : ''}
                {itemTitle(entry.values, content.presentation?.titleField, (entry.sortIndex ?? 0) + 1)}
              </h4>
              <details>
                <summary>Advanced</summary>
                <p>
                  Record key: <code>{entry.stableKey}</code>
                </p>
              </details>
              <dl>
                {content.fields.map(field => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>
                      <FieldValue field={field} value={entry.values?.[field.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
function itemTitle(values: Record<string, unknown> | null, titleField: string | undefined, position: number): string {
  const value = titleField ? values?.[titleField] : null
  const title =
    typeof value === 'string'
      ? value
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : ''
  return title || `Item ${position}`
}
function FieldValue({ field, value }: { field: CollectionField; value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="muted">Empty</span>
  if (field.type === 'richtext' && typeof value === 'string')
    return <div dangerouslySetInnerHTML={{ __html: collectionReviewRichText(value) }} />
  if (field.type === 'image' && typeof value === 'object') {
    const img = value as { src?: string; alt?: string; decorative?: boolean }
    return (
      <>
        {safeUrl(img.src) && <img src={img.src} alt={img.alt ?? ''} loading="lazy" />}
        <p>{img.decorative ? 'Decorative image' : `Description: ${img.alt ?? ''}`}</p>
        <small>{img.src}</small>
      </>
    )
  }
  if (field.type === 'url' && typeof value === 'string') return <code>{value}</code>
  return (
    <span>
      {typeof value === 'boolean'
        ? value
          ? 'Yes'
          : 'No'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)}
    </span>
  )
}
function safeUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !/[\s\\]/.test(value) &&
    ((value.startsWith('/') && !value.startsWith('//')) || value.startsWith('https://'))
  )
}
