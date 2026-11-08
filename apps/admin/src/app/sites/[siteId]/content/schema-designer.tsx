'use client'
import selectionControlsStyles from '../../../../components/workspace-styles/selection-controls.module.css'
import { Button, Disclosure, Menu } from '../../../../components/ui/index.ts'
import { useCollectionSchemaDraft } from './use-collection-schema-draft.ts'
import {
  applyStarterUpgrade,
  type CollectionField,
  type CollectionFieldType,
  type CollectionModel as CollectionModelValue,
} from '@cms/schema'
import { type ActionResult } from '../../../../lib/action-result.ts'
import { IconAlert, IconCollection, IconDrag, IconMore, IconPlus } from '../../../../components/icons.tsx'
import { Dialog } from './collection-dialog.tsx'

const FIELD_TYPES: { value: CollectionFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'richtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'url', label: 'Link' },
  { value: 'image', label: 'Photo' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'select', label: 'Choice' },
]

export function SchemaDesigner({
  initial,
  pending,
  notice,
  onClose,
  onSave,
}: {
  initial: CollectionModelValue
  pending: boolean
  notice: ActionResult | null
  onClose: () => void
  onSave: (model: CollectionModelValue) => Promise<ActionResult | undefined> | undefined
}) {
  const {
    draft,
    setDraft,
    parsed,
    validationMessage,
    dirty,
    dismiss,
    upgrade,
    updateField,
    removeField,
    move,
    addField,
    selectOptions,
  } = useCollectionSchemaDraft({ initial, pending, onClose, onSave })
  return (
    <Dialog
      title="List settings"
      lede="Choose useful fields and clear labels for this list. Advanced holds the permanent field keys."
      onClose={dismiss}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={dismiss}>
            Cancel
          </Button>
          <Button
            disabled={!parsed.success || pending || !dirty}
            onClick={() => {
              if (parsed.success) onSave(parsed.data)
            }}
          >
            {pending ? 'Saving…' : 'Save fields'}
          </Button>
        </>
      }
    >
      <fieldset
        disabled={pending}
        className="schema-designer"
        aria-label="List fields"
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {upgrade && (
          <div className="notice notice-info schema-upgrade" role="status">
            <p>
              This list began from an earlier {upgrade.name} starter. The current starter also has{' '}
              {upgrade.missing.map(field => field.label).join(', ')}. Adding them changes only the editor form: they are
              optional, existing items keep their content and start them empty, and nothing changes publicly until you
              publish.
            </p>
            <button
              type="button"
              className="secondary small"
              onClick={() => setDraft(current => applyStarterUpgrade(current))}
            >
              <IconPlus size={15} /> Add these fields
            </button>
          </div>
        )}
        <section className="schema-fields">
          <div className="schema-section-head">
            <div>
              <p className="eyebrow">Editor form</p>
              <h3>Fields</h3>
            </div>
            <button type="button" className="secondary small" onClick={addField}>
              <IconPlus size={15} /> Add field
            </button>
          </div>
          {draft.fields.map((field, index) => (
            <article key={`${field.key}-${index}`} className="schema-field-card">
              <div className="schema-field-move">
                <IconDrag size={16} />
                <span>{index + 1}</span>
                <Menu label={<IconMore size={16} />} accessibleLabel={`Actions for field ${field.label}`}>
                  <Button
                    variant="tertiary"
                    aria-label={`Move ${field.label} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="tertiary"
                    aria-label={`Move ${field.label} down`}
                    disabled={index === draft.fields.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="tertiary"
                    aria-label={`Remove ${field.label}`}
                    disabled={draft.fields.length === 1}
                    onClick={() => removeField(index)}
                  >
                    Remove field
                  </Button>
                </Menu>
              </div>
              <div className="schema-field-form">
                <div className="field">
                  <label>
                    Label
                    <input value={field.label} onChange={event => updateField(index, { label: event.target.value })} />
                  </label>
                </div>
                <Disclosure title="Advanced">
                  <div className="field">
                    <label>
                      Field key
                      <input value={field.key} onChange={event => updateField(index, { key: event.target.value })} />
                    </label>
                  </div>
                </Disclosure>
                <div className="field">
                  <label>
                    Field type
                    <select
                      value={field.type}
                      onChange={event => updateField(index, { type: event.target.value as CollectionFieldType })}
                    >
                      {FIELD_TYPES.map(option => (
                        <option value={option.value} key={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className={selectionControlsStyles.checkRow}>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={event => updateField(index, { required: event.target.checked })}
                  />{' '}
                  Required
                </label>
                <div className="field schema-help">
                  <label>
                    Guidance
                    <input
                      value={field.help ?? ''}
                      placeholder="Optional help for editors"
                      onChange={event => updateField(index, { help: event.target.value || undefined })}
                    />
                  </label>
                </div>
                {field.type === 'select' && (
                  <div className="field schema-options">
                    <label>
                      Choices
                      <textarea
                        rows={3}
                        value={field.options.join('\n')}
                        onChange={event =>
                          updateField(index, {
                            options: event.target.value
                              .split('\n')
                              .map(value => value.trim())
                              .filter(Boolean),
                          } as Partial<CollectionField>)
                        }
                      />
                    </label>
                    <small>One choice per line.</small>
                  </div>
                )}
              </div>
            </article>
          ))}
        </section>
        <aside className="schema-presentation">
          <p className="eyebrow">Item cards</p>
          <h3>How items are identified</h3>
          <p>Choose which fields people see while browsing this list.</p>
          <div className="field">
            <label>
              Title field
              <select
                value={draft.presentation.titleField}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    presentation: { ...current.presentation, titleField: event.target.value },
                  }))
                }
              >
                {selectOptions(['text', 'richtext', 'date', 'select']).map(field => (
                  <option value={field.key} key={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PresentationSelect
            label="Subtitle field"
            value={draft.presentation.subtitleField}
            options={selectOptions(['text', 'richtext', 'date', 'select'])}
            onChange={value =>
              setDraft(current => ({ ...current, presentation: { ...current.presentation, subtitleField: value } }))
            }
          />
          <PresentationSelect
            label="Image field"
            value={draft.presentation.imageField}
            options={selectOptions(['image'])}
            onChange={value =>
              setDraft(current => ({ ...current, presentation: { ...current.presentation, imageField: value } }))
            }
          />
          <PresentationSelect
            label="Group items by"
            value={draft.presentation.groupField}
            options={selectOptions(['text', 'date', 'select'])}
            onChange={value =>
              setDraft(current => ({ ...current, presentation: { ...current.presentation, groupField: value } }))
            }
          />
          <div className="schema-card-preview">
            <p className="eyebrow">Preview</p>
            <div>
              <span>
                <IconCollection size={18} />
              </span>
              <span>
                <strong>
                  {draft.fields.find(field => field.key === draft.presentation.titleField)?.label || 'Title'}
                </strong>
                <small>
                  {draft.fields.find(field => field.key === draft.presentation.subtitleField)?.label || 'Item'}
                </small>
              </span>
              <b>Changed</b>
            </div>
          </div>
        </aside>
      </fieldset>
      {!parsed.success && (
        <p className="notice notice-error collection-dialog-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{validationMessage}</span>
        </p>
      )}
      {notice && !notice.ok && (
        <p className="notice notice-error collection-dialog-notice" role="alert">
          <IconAlert size={16} />
          <span className="notice-body">{notice.message}</span>
        </p>
      )}
    </Dialog>
  )
}

function PresentationSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: CollectionField[]
  onChange: (value: string | null) => void
}) {
  return (
    <div className="field">
      <label>
        {label}
        <select value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
          <option value="">None</option>
          {options.map(field => (
            <option value={field.key} key={field.key}>
              {field.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
