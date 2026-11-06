'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { STORY_MAP_AREAS, storyTagIds, type StoriesSettings, type StoryTagGroup } from '@cms/schema'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Menu,
  Note,
  PageHeader,
} from '../../../../../components/ui/index.ts'
import { IconDrag, IconPlus, IconTrash } from '../../../../../components/icons.tsx'
import { CatalogList, CatalogRow } from '../../../../../components/catalog-row.tsx'
import { ConfirmDialog } from '../../../../../components/confirm.tsx'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import type { StoriesTagOperation } from '../../../../../lib/stories-tags.ts'
import { changeTags } from './actions.ts'
import shared from '../../../../../components/workspace.module.css'
type Entry = { id: string; values: Record<string, unknown> }
type Edit = {
  group: StoryTagGroup
  id: string | null
  label: string
  keywords: string
  areas: (typeof STORY_MAP_AREAS)[number][]
}
const areaLabels: Record<(typeof STORY_MAP_AREAS)[number], string> = {
  'north-america': 'North America',
  'latin-america-caribbean': 'Latin America & Caribbean',
  europe: 'Europe',
  africa: 'Africa',
  asia: 'Asia',
  oceania: 'Oceania',
}
export function TagManager({
  siteId,
  collectionId,
  initial,
  initialRevision,
  initialEntryRevision,
  initialEntries,
  initialHasDraft,
}: {
  siteId: string
  collectionId: string
  initial: StoriesSettings
  initialRevision: string
  initialEntryRevision: string
  initialEntries: Entry[]
  initialHasDraft: boolean
}) {
  const router = useRouter(),
    [settings, setSettings] = useState(initial),
    [revision, setRevision] = useState(initialRevision),
    [entryRevision, setEntryRevision] = useState(initialEntryRevision),
    [entries, setEntries] = useState(initialEntries),
    [edit, setEdit] = useState<Edit | null>(null),
    [rename, setRename] = useState<{ group: StoryTagGroup; label: string } | null>(null),
    [deleting, setDeleting] = useState<{
      group: StoryTagGroup
      id: string
      label: string
      replacement: string | null
    } | null>(null),
    [confirmSuggestions, setConfirmSuggestions] = useState(false),
    [dragged, setDragged] = useState<{ group: StoryTagGroup; id: string } | null>(null),
    [message, setMessage] = useState(''),
    [error, setError] = useState(false),
    [pending, start] = useTransition(),
    saving = useRef(false),
    focusAfterMove = useRef<{ group: StoryTagGroup; id: string } | null>(null)
  const [hasDraft, setHasDraft] = useState(initialHasDraft)
  const dirty = edit !== null || rename !== null
  useNavigationGuard(() => ({
    dirty,
    pending: pending || saving.current,
    draft: { label: 'Tags', saveDraft: saveBeforeLeaving, discard: close },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty])
  useEffect(() => {
    if (!pending && !saving.current && focusAfterMove.current) {
      const { group, id } = focusAfterMove.current
      document
        .querySelector<HTMLButtonElement>(`[data-group="${group}"][data-tag-id="${CSS.escape(id)}"] button`)
        ?.focus()
      focusAfterMove.current = null
    }
  }, [pending, settings])
  const tags = (group: StoryTagGroup) => (group === 'main' ? settings.mainTags : settings.secondaryTags)
  const count = (group: StoryTagGroup, id: string) =>
    entries.filter(e => storyTagIds(e.values, group).includes(id)).length
  const persist = async (operation: StoriesTagOperation): Promise<{ ok: boolean; message?: string }> => {
    if (saving.current) return { ok: false, message: 'Wait for the current tag save to finish.' }
    saving.current = true
    setError(false)
    setMessage('Saving tag changes…')
    try {
      const result = await changeTags(siteId, collectionId, revision, entryRevision, operation)
      if (!result.ok) {
        setError(true)
        setMessage(result.message)
        return { ok: false, message: result.message }
      }
      if (result.changed) setHasDraft(true)
      setSettings(result.settings)
      setRevision(result.revision)
      setEntryRevision(result.entryRevision)
      setEntries(result.entries)
      setEdit(null)
      setRename(null)
      setDeleting(null)
      setConfirmSuggestions(false)
      setMessage(
        !result.changed
          ? 'No tag changes were needed.'
          : operation.action === 'resuggest'
            ? 'Suggestions saved for unreviewed stories. Reviewed stories kept their tags.'
            : 'Saved as a draft. Publish to update the site.',
      )
      router.refresh()
      return { ok: true }
    } catch {
      const message = 'Tags could not be saved. Your changes are still here. Try again.'
      setError(true)
      setMessage(message)
      return { ok: false, message }
    } finally {
      saving.current = false
    }
  }
  const save = (operation: StoriesTagOperation) =>
    start(async () => {
      await persist(operation)
    })
  async function saveBeforeLeaving(): Promise<{ ok: boolean; message?: string }> {
    if (edit)
      return persist({
        action: edit.id ? 'edit' : 'add',
        group: edit.group,
        ...(edit.id ? { id: edit.id } : {}),
        label: edit.label,
        keywords: draftKeywords,
        areas: edit.areas,
      } as StoriesTagOperation)
    if (rename) return persist({ action: 'rename-group', ...rename })
    return { ok: true }
  }
  const move = (group: StoryTagGroup, id: string, before: string | null) => {
    if (id !== before && !saving.current) {
      focusAfterMove.current = { group, id }
      save({ action: 'move', group, id, before })
    }
  }
  const close = () => {
    if (!saving.current) {
      setEdit(null)
      setRename(null)
      setError(false)
      setMessage('')
    }
  }
  const begin = (group: StoryTagGroup, id: string | null) => {
    const tag = tags(group).find(t => t.id === id)
    setMessage('')
    setError(false)
    setEdit({
      group,
      id,
      label: tag?.label ?? '',
      keywords: tag?.keywords.join(', ') ?? '',
      areas: group === 'secondary' ? (settings.secondaryTags.find(t => t.id === id)?.areas ?? []) : [],
    })
  }
  const draftKeywords = edit
    ? [
        ...new Set(
          edit.keywords
            .split(',')
            .map(k => k.trim())
            .filter(Boolean),
        ),
      ]
    : []
  const saveEdit = () => {
    if (edit)
      save({
        action: edit.id ? 'edit' : 'add',
        group: edit.group,
        ...(edit.id ? { id: edit.id } : {}),
        label: edit.label,
        keywords: draftKeywords,
        areas: edit.areas,
      } as StoriesTagOperation)
  }
  return (
    <>
      <PageHeader
        density="compact"
        showWayfinding={false}
        title="Manage tags"
        lede="Main tags and secondary tags work on every site. Each site names its own."
        actions={
          <>
            <span role="status">
              {pending ? (
                'Saving…'
              ) : (
                <Badge tone={hasDraft ? 'pending' : 'live'}>{hasDraft ? 'Saved as a draft' : 'Live'}</Badge>
              )}
            </span>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmSuggestions(true)}>
              Re-suggest tags for unreviewed stories
            </Button>
            <ButtonLink
              variant="publish"
              href={'/sites/' + siteId + '/publishing?lists=1'}
              aria-disabled={pending || dirty}
              onClick={event => {
                if (pending || dirty) event.preventDefault()
              }}
            >
              Publish…
            </ButtonLink>
          </>
        }
      />
      {message && (
        <Note tone={error ? 'warning' : 'success'}>
          <span role={error ? 'alert' : 'status'}>{message}</span>
        </Note>
      )}
      {(['main', 'secondary'] as const).map(group => (
        <Card
          key={group}
          density="catalog"
          title={
            <span className={shared.actions}>
              {group === 'main' ? settings.mainLabel : settings.secondaryLabel}
              <Badge>{group === 'main' ? 'Main tag' : 'Secondary tag'}</Badge>
            </span>
          }
          description={
            group === 'main'
              ? 'Each one can have its own page. A story can carry several.'
              : 'Used for filters and World View.'
          }
          headerActions={
            <>
              <Button
                variant="secondary"
                size="s"
                disabled={pending}
                onClick={() => {
                  setMessage('')
                  setRename({ group, label: group === 'main' ? settings.mainLabel : settings.secondaryLabel })
                }}
              >
                Rename level
              </Button>
              <Button
                variant="secondary"
                size="s"
                disabled={pending || tags(group).length >= 100}
                onClick={() => begin(group, null)}
              >
                <IconPlus size={16} />
                {group === 'main' && settings.mainLabel === 'Project Sectors'
                  ? 'Add sector'
                  : group === 'secondary' && settings.secondaryLabel === 'Regions'
                    ? 'Add region'
                    : 'Add tag'}
              </Button>
            </>
          }
        >
          {tags(group).length ? (
            <CatalogList
              aria-label={group === 'main' ? settings.mainLabel : settings.secondaryLabel}
              onDragOver={event => {
                if (dragged?.group === group) event.preventDefault()
              }}
              onDrop={event => {
                if (event.target === event.currentTarget && dragged?.group === group) {
                  event.preventDefault()
                  move(group, dragged.id, null)
                  setDragged(null)
                }
              }}
            >
              {tags(group).map((tag, index) => (
                <CatalogRow
                  descriptionWrap
                  key={tag.id}
                  data-group={group}
                  data-tag-id={tag.id}
                  data-dragging={(dragged?.id === tag.id && dragged.group === group) || undefined}
                  onDragOver={event => {
                    if (dragged?.group === group) event.preventDefault()
                  }}
                  onDrop={event => {
                    if (dragged?.group === group) {
                      event.preventDefault()
                      event.stopPropagation()
                      const box = event.currentTarget.getBoundingClientRect(),
                        before =
                          event.clientY > box.top + box.height / 2 ? (tags(group)[index + 1]?.id ?? null) : tag.id
                      move(group, dragged.id, before)
                      setDragged(null)
                    }
                  }}
                  leading={
                    <IconButton
                      tooltip={'Reorder ' + tag.label}
                      variant="tertiary"
                      size="s"
                      disabled={pending}
                      draggable={!pending}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onDragStart={event => {
                        event.dataTransfer.setData('text/plain', tag.id)
                        event.dataTransfer.effectAllowed = 'move'
                        setDragged({ group, id: tag.id })
                      }}
                      onDragEnd={() => setDragged(null)}
                      onKeyDown={event => {
                        if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                          event.preventDefault()
                          const next = event.key === 'ArrowUp' ? index - 1 : index + 2
                          if (
                            (event.key === 'ArrowUp' && index === 0) ||
                            (event.key === 'ArrowDown' && index === tags(group).length - 1)
                          )
                            return
                          move(group, tag.id, tags(group)[next]?.id ?? null)
                        }
                      }}
                    >
                      <IconDrag size={16} />
                    </IconButton>
                  }
                  title={
                    <>
                      <strong title={tag.label}>{tag.label}</strong>
                      <small title={tag.id}>{tag.id}</small>
                    </>
                  }
                  description={
                    <span title={tag.keywords.join(', ')}>
                      {tag.keywords.length ? tag.keywords.join(', ') : 'No keyword suggestions'}
                    </span>
                  }
                  meta={count(group, tag.id) + ' ' + (count(group, tag.id) === 1 ? 'story' : 'stories')}
                  actions={
                    <Menu label="•••" accessibleLabel={'Actions for ' + tag.label}>
                      <Button
                        variant="tertiary"
                        size="s"
                        disabled={pending}
                        aria-label={'Rename ' + tag.label}
                        onClick={() => begin(group, tag.id)}
                      >
                        Rename
                      </Button>
                      <Button
                        aria-label={'Delete ' + tag.label}
                        variant="tertiary"
                        size="s"
                        disabled={pending}
                        onClick={() => {
                          setMessage('')
                          setDeleting({
                            group,
                            id: tag.id,
                            label: tag.label,
                            replacement: tags(group).find(t => t.id !== tag.id)?.id ?? null,
                          })
                        }}
                      >
                        <IconTrash size={16} />
                        Delete
                      </Button>
                    </Menu>
                  }
                />
              ))}
            </CatalogList>
          ) : (
            <EmptyState title="No tags yet">Add a tag to begin organizing this site’s stories.</EmptyState>
          )}
        </Card>
      ))}
      <div className={shared.actions}>
        <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories'}>
          Done
        </ButtonLink>
        <span className={shared.meta}>Drag the grip to reorder. With the grip focused, use Alt + Up or Down.</span>
      </div>
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
          <div className={shared.compactFields}>
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
            <p className={shared.meta}>
              New stories are tagged from these words, then wait for review. Existing stories are only changed if you
              press Re-suggest.
            </p>
            {edit.id && (
              <p className={shared.meta}>
                Renaming keeps this tag's identity, so existing stories and page filters stay connected.
              </p>
            )}
            {edit.group === 'secondary' && (
              <fieldset className={shared.formChoices} disabled={pending}>
                <legend>World View map area</legend>
                <div className={shared.compactFields}>
                  {STORY_MAP_AREAS.map(area => (
                    <label key={area} className={shared.checkRow}>
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
                <p className={shared.meta}>
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
          <div className={shared.compactFields}>
            <p>
              {count(deleting.group, deleting.id)}{' '}
              {count(deleting.group, deleting.id) === 1 ? 'story uses' : 'stories use'} this tag.
            </p>
            {tags(deleting.group).some(t => t.id !== deleting.id) && (
              <div className={shared.optionCard} data-layout="row" data-selected={deleting.replacement !== null}>
                <label className={shared.checkRow}>
                  <input
                    className={shared.visuallyHidden}
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
                  <Field id="delete-tag-move" label={<span className={shared.visuallyHidden}>Move stories to</span>}>
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
            <div className={shared.optionCard} data-layout="row" data-selected={deleting.replacement === null}>
              <label className={shared.checkRow}>
                <input
                  className={shared.visuallyHidden}
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
            <p className={shared.meta}>This deletion is saved as a draft.</p>
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
