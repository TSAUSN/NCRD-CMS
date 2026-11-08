import type { CollectionModel } from '@cms/schema'
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { Disclosure } from '../../../../components/ui/index.ts'
import type { EntryState } from './collection-entries.ts'
import type { collectionPublicationChanges } from './collection-workspace-model.ts'
import styles from './lists.module.css'

const readableValue = (value: unknown): string =>
  typeof value === 'string'
    ? value.replace(/<[^>]*>/g, '').trim() || 'Empty'
    : typeof value === 'boolean'
      ? value
        ? 'Yes'
        : 'No'
      : typeof value === 'number'
        ? String(value)
        : value && typeof value === 'object'
          ? 'Picture selected'
          : 'Empty'

/** Show the saved version that publishing will send to all pages using the list. */
export function CollectionPublicationReview({
  listName,
  publicationChanges,
  fields,
  savedEntries,
  pending,
  error,
  onCancel,
  onPublish,
}: {
  listName: string
  publicationChanges: ReturnType<typeof collectionPublicationChanges>
  fields: CollectionModel['fields']
  savedEntries: readonly EntryState[]
  pending: boolean
  error?: string
  onCancel: () => void
  onPublish: () => void
}) {
  return (
    <ConfirmDialog
      tone="publish"
      title={`Publish ${listName}?`}
      what={
        <div className={styles.publication}>
          <p>The saved items, order and removals will become live on every page that uses this list.</p>
          {publicationChanges.length ? (
            <ul>
              {publicationChanges.map(item => (
                <li key={item.key}>
                  <strong>{item.title}</strong>
                  <ul>
                    {item.changes.map((change, index) => (
                      <li key={index}>{change}</li>
                    ))}
                  </ul>
                  <Disclosure title="View item details">
                    <dl>
                      {fields.map(field => (
                        <div key={field.key}>
                          <dt>{field.label}</dt>
                          <dd>
                            {readableValue(
                              savedEntries.find(entry => (entry.id ?? entry.stableKey) === item.key)?.values[field.key],
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </Disclosure>
                </li>
              ))}
            </ul>
          ) : (
            <p>No visible content differences.</p>
          )}
        </div>
      }
      reassurance="Other saved work stays private until published."
      confirmLabel="Publish this list"
      pending={pending}
      error={error}
      onCancel={onCancel}
      onConfirm={onPublish}
    />
  )
}
