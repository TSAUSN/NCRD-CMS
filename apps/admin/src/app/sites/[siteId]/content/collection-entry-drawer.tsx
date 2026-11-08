import type { CollectionModel } from '@cms/schema'
import { CollectionFieldControl } from '../../../../components/collection-field-control.tsx'
import { Button, Disclosure, Drawer, Field } from '../../../../components/ui/index.ts'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import type { MediaAsset } from '../../../../lib/media-library.ts'
import { reviewTime } from '../../../../lib/review-time.ts'
import type { EntryState } from './collection-entries.ts'
import { entryIdentity } from './collection-record-display.ts'
import styles from './lists.module.css'

/** Edit a single draft record. Saving and asset ownership stay in the workspace. */
export function CollectionEntryDrawer({
  opened,
  noun,
  fields,
  availableMedia,
  pending,
  canEdit,
  canSave,
  error,
  onCancel,
  onSave,
  onChange,
  onImage,
  onDocument,
  onDuplicate,
  onToggleVisibility,
  onKeyChange,
}: {
  opened: EntryState
  noun: string
  fields: CollectionModel['fields']
  availableMedia: MediaAsset[]
  pending: boolean
  canEdit: boolean
  canSave: boolean
  error?: string
  onCancel: () => void
  onSave: () => void
  onChange: (field: string, value: unknown) => void
  onImage: (field: string) => void
  onDocument: (field: string) => void
  onDuplicate: () => void
  onToggleVisibility: () => void
  onKeyChange: (key: string) => void
}) {
  return (
    <Drawer
      density="compact"
      title={(opened.id ? 'Edit ' : 'Add ') + noun}
      onClose={onCancel}
      pending={pending}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!canSave} loading={pending} onClick={onSave}>
            Save {noun}
          </Button>
        </>
      }
    >
      <p className={recordTableStyles.meta}>Save keeps this item private until you publish the list.</p>
      {opened.editedAt && (
        <p className={recordTableStyles.meta}>
          Updated {reviewTime(opened.editedAt)} ·{' '}
          <span title={opened.editedBy ?? undefined}>{opened.editedBy ?? 'Not saved yet'}</span>
        </p>
      )}
      {error !== undefined && <p role="alert">{error}</p>}
      <div className={listInspectorStyles.formStack}>
        {fields.map(field => (
          <CollectionFieldControl
            key={field.key}
            field={field}
            entry={opened}
            media={availableMedia}
            disabled={!canEdit || opened.archived || pending}
            onChange={value => onChange(field.key, value)}
            onChooseImage={() => onImage(field.key)}
            onChooseDocument={() => onDocument(field.key)}
          />
        ))}
      </div>
      {canEdit && (
        <div className={styles.actions}>
          <Button variant="secondary" disabled={pending} onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onToggleVisibility}>
            {opened.archived ? 'Show in list' : 'Hide from list'}
          </Button>
        </div>
      )}
      <Disclosure title="Advanced">
        <Field
          id={'stable-' + entryIdentity(opened)}
          label="Record key"
          help="Pages use this permanent key to identify the item."
        >
          <input
            value={opened.stableKey}
            disabled={!canEdit || pending || opened.id !== null}
            onChange={event => onKeyChange(event.target.value)}
          />
        </Field>
      </Disclosure>
    </Drawer>
  )
}
