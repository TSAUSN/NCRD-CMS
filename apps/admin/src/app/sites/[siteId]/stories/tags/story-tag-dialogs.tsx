import { STORY_MAP_AREAS } from '@cms/schema'
import { Button, Dialog, Field, Note } from '../../../../../components/ui/index.ts'
import { ConfirmDialog } from '../../../../../components/confirm.tsx'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
import type { TagManagerModel } from './use-tag-manager.ts'
const areaLabels: Record<(typeof STORY_MAP_AREAS)[number], string> = {
  'north-america': 'North America',
  'latin-america-caribbean': 'Latin America & Caribbean',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia',
  oceania: 'Oceania',
}
export function StoryTagDialogs({ model }: { model: TagManagerModel }) {
  const {
    settings,
    edit,
    setEdit,
    rename,
    setRename,
    deleting,
    setDeleting,
    confirmSuggestions,
    setConfirmSuggestions,
    message,
    error,
    pending,
    tags,
    count,
    save,
    close,
    draftKeywords,
    saveEdit,
  } = model
  return (
    <>
      {edit && (
        <Dialog
          density="compact"
          size="medium"
          showClose={false}
          title={
            edit.id
              ? 'Edit ' + (tags(edit.group).find(t => t.id === edit.id)?.label ?? 'tag')
              : edit.group === 'main' && settings.mainLabel === 'Project Sectors'
                ? 'Add a project sector'
                : edit.group === 'secondary' && settings.secondaryLabel === 'Regions'
                  ? 'Add a region'
                  : 'Add a tag'
          }
          pending={pending}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button disabled={!edit.label.trim() || draftKeywords.length > 50} loading={pending} onClick={saveEdit}>
                {edit.id ? 'Save tag' : 'Add tag'}
              </Button>
            </>
          }
        >
          <div className={workspaceFormsStyles.compactFields}>
            <Field id="tag-name" label="Name">
              <input
                autoFocus
                value={edit.label}
                maxLength={80}
                disabled={pending}
                onChange={event => setEdit({ ...edit, label: event.target.value })}
              />
            </Field>
            <Field id="tag-keywords" label="Suggest it for stories that mention">
              <input
                value={edit.keywords}
                disabled={pending}
                onChange={event => setEdit({ ...edit, keywords: event.target.value })}
              />
            </Field>
            <p className={recordTableStyles.meta}>
              New stories are tagged from these words, then wait for review. Existing stories are only changed if you
              press Re-suggest.
            </p>
            {edit.id && (
              <p className={recordTableStyles.meta}>
                Renaming keeps this tag's identity, so existing stories and page filters stay connected.
              </p>
            )}
            {edit.group === 'secondary' && (
              <fieldset className={workspaceFormsStyles.formChoices} disabled={pending}>
                <legend>World View map area</legend>
                <div className={workspaceFormsStyles.compactFields}>
                  {STORY_MAP_AREAS.map(area => (
                    <label key={area} className={selectionControlsStyles.checkRow}>
                      <input
                        type="checkbox"
                        checked={edit.areas.includes(area)}
                        onChange={event =>
                          setEdit({
                            ...edit,
                            areas: event.target.checked ? [...edit.areas, area] : edit.areas.filter(v => v !== area),
                          })
                        }
                      />
                      {areaLabels[area]}
                    </label>
                  ))}
                </div>
                <p className={recordTableStyles.meta}>
                  If regions share an area, the first region in this list is used on the map.
                </p>
              </fieldset>
            )}
            {error && <p role="alert">{message}</p>}
          </div>
        </Dialog>
      )}
      {rename && (
        <Dialog
          density="compact"
          size="medium"
          showClose={false}
          title="Rename level"
          pending={pending}
          onClose={close}
          footer={
            <>
              <Button variant="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                loading={pending}
                disabled={!rename.label.trim()}
                onClick={() => save({ action: 'rename-group', ...rename })}
              >
                Save name
              </Button>
            </>
          }
        >
          <Field
            id="tag-group-name"
            label={rename.group === 'main' ? 'Main tag level name' : 'Secondary tag level name'}
          >
            <input
              autoFocus
              value={rename.label}
              maxLength={80}
              disabled={pending}
              onChange={event => setRename({ ...rename, label: event.target.value })}
            />
          </Field>
          {error && <p role="alert">{message}</p>}
        </Dialog>
      )}
      {deleting && (
        <Dialog
          density="compact"
          size="medium"
          showClose={false}
          title={'Delete “' + deleting.label + '”?'}
          pending={pending}
          onClose={() => {
            if (!pending) setDeleting(null)
          }}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={pending}
                onClick={() =>
                  save({ action: 'delete', group: deleting.group, id: deleting.id, replacement: deleting.replacement })
                }
              >
                Delete tag
              </Button>
            </>
          }
        >
          <div className={workspaceFormsStyles.compactFields}>
            <p>
              {count(deleting.group, deleting.id)}{' '}
              {count(deleting.group, deleting.id) === 1 ? 'story uses' : 'stories use'} this tag.
            </p>
            {tags(deleting.group).some(t => t.id !== deleting.id) && (
              <div
                className={selectionControlsStyles.optionCard}
                data-layout="row"
                data-selected={deleting.replacement !== null}
              >
                <label className={selectionControlsStyles.checkRow}>
                  <input
                    className={selectionControlsStyles.visuallyHidden}
                    type="radio"
                    name="delete-tag-choice"
                    checked={deleting.replacement !== null}
                    disabled={pending}
                    onChange={() =>
                      setDeleting({
                        ...deleting,
                        replacement: tags(deleting.group).find(t => t.id !== deleting.id)!.id,
                      })
                    }
                  />
                  Move its stories to another tag
                </label>
                {deleting.replacement !== null && (
                  <Field
                    id="delete-tag-move"
                    label={<span className={selectionControlsStyles.visuallyHidden}>Move stories to</span>}
                  >
                    <select
                      value={deleting.replacement}
                      disabled={pending}
                      onChange={event => setDeleting({ ...deleting, replacement: event.target.value })}
                    >
                      {tags(deleting.group)
                        .filter(t => t.id !== deleting.id)
                        .map(t => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
              </div>
            )}
            <div
              className={selectionControlsStyles.optionCard}
              data-layout="row"
              data-selected={deleting.replacement === null}
            >
              <label className={selectionControlsStyles.checkRow}>
                <input
                  className={selectionControlsStyles.visuallyHidden}
                  type="radio"
                  name="delete-tag-choice"
                  checked={deleting.replacement === null}
                  disabled={pending}
                  onChange={() => setDeleting({ ...deleting, replacement: null })}
                />
                Just remove the tag
              </label>
              <small>The stories keep their other tags.</small>
            </div>
            <Note tone="warning">
              Pages filtering by it will show their “no stories yet” line until you choose another tag for them.
            </Note>
            <p className={recordTableStyles.meta}>This deletion is saved as a draft.</p>
            {error && <p role="alert">{message}</p>}
          </div>
        </Dialog>
      )}
      {confirmSuggestions && (
        <ConfirmDialog
          title="Re-suggest tags for unreviewed stories?"
          what="Replace the main and secondary tags on stories that have not been reviewed, using the current keywords."
          reassurance="Reviewed stories keep their tags. Suggestions save as a draft and wait for publishing."
          tone="primary"
          confirmLabel="Re-suggest tags"
          pending={pending}
          onCancel={() => setConfirmSuggestions(false)}
          onConfirm={() => save({ action: 'resuggest' })}
          error={error ? message : undefined}
        />
      )}
    </>
  )
}
