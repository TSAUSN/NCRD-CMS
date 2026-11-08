import styles from './lists.module.css'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import ownedStyles from './collections-workspace-styles.module.css'
import {
  Button,
  Card,
  CardHeading,
  CardContent,
  Disclosure,
  Menu,
  Field,
  SegmentedControl,
  StatusPill,
  RecordBoard,
  TextLink,
} from '../../../../components/ui/index.ts'
import { requestClientNavigation } from '../../../../components/navigation-guard.ts'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import { IconPlus } from '../../../../components/icons.tsx'
import { CollectionRecordList } from './collection-record-list.tsx'
import { CollectionPublishingStatus } from './collection-publishing-status.tsx'
import type { CollectionsWorkspaceModel, EntryFilter } from './use-collections-workspace.ts'

function CollectionHeading({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const {
    selected,
    entries,
    entryRevision,
    publishedEntryRevision,
    draftSchemaId,
    publishedSchemaId,
    setNotice,
    entryDirty,
    schemaDirty,
    noun,
  } = workspace.draft
  const { addEntry } = workspace.editing
  const { publishSchemaNow } = workspace.commands
  const { rights, headerActionsId, currentReview, setSchemaOpen, setCsvOpen, pending, openDialog, openCreateDialog } =
    workspace
  if (!selected) return null
  const activeEntryCount = entries.filter(entry => !entry.archived).length
  return (
    <>
      <CardHeading>
        <div>
          <h2 title={selected.name}>{selected.name}</h2>
          <p>
            {activeEntryCount} {activeEntryCount === 1 ? 'item' : 'items'} ·{' '}
            <StatusPill
              compact
              status={
                entryDirty || entryRevision !== publishedEntryRevision || draftSchemaId !== publishedSchemaId
                  ? publishedSchemaId
                    ? 'Live · changes not published'
                    : 'Draft'
                  : 'Live'
              }
            />
          </p>
        </div>
        <div className={workspaceFormsStyles.actions}>
          {' '}
          {rights.editEntries && (
            <Button disabled={pending} onClick={addEntry}>
              <IconPlus size={16} />
              Add {noun}
            </Button>
          )}
          <Menu appearance="button" label="Import / Export">
            <Button
              variant="tertiary"
              disabled={pending}
              onClick={event => openDialog(() => setCsvOpen(true), event.currentTarget)}
            >
              Import / Export CSV
            </Button>
          </Menu>
          {rights.manageSchema && (
            <Menu appearance="button" label="More" accessibleLabel="More list actions">
              {!headerActionsId && (
                <Button variant="tertiary" disabled={pending} onClick={openCreateDialog}>
                  New list
                </Button>
              )}
              <Button
                variant="tertiary"
                disabled={pending || entryDirty}
                onClick={event => {
                  if (!entryDirty)
                    openDialog(() => {
                      setNotice(null)
                      setSchemaOpen(true)
                    }, event.currentTarget)
                }}
              >
                List settings
              </Button>
              {draftSchemaId !== publishedSchemaId && (
                <Button
                  variant="tertiary"
                  disabled={entryDirty || schemaDirty || Boolean(currentReview) || pending}
                  onClick={publishSchemaNow}
                >
                  Publish field changes
                </Button>
              )}
            </Menu>
          )}
        </div>
      </CardHeading>
    </>
  )
}

function CollectionRecords({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const {
    selected,
    entries,
    model,
    entryRevision,
    publishedEntryRevision,
    draftSchemaId,
    publishedSchemaId,
    checked,
    setChecked,
    setNotice,
    entriesNeedResave,
    entryEdits,
    entryDirty,
    anythingDirty,
    invalidEntryKeys,
    noun,
    changes,
  } = workspace.draft
  const { reorder, openEntry, moveEntry } = workspace.editing
  const { saveEntries } = workspace.commands
  const {
    rights,
    availableMedia,
    setSubmitOpen,
    setPublishOpen,
    currentReview,
    view,
    pending,
    busy,
    openDialog,
    visible,
  } = workspace
  if (!selected) return null
  if (!model) return null
  return (
    <>
      <RecordBoard
        label={selected.name + ' records'}
        footerLabel="List publishing status"
        footer={
          <CollectionPublishingStatus
            entryEdits={entryEdits}
            entriesNeedResave={entriesNeedResave}
            changes={changes}
            pending={pending}
            canEdit={rights.editEntries}
            canPublish={rights.publish}
            hasOpenReview={Boolean(currentReview)}
            saveReady={entryDirty && invalidEntryKeys.size === 0}
            submitReady={
              !anythingDirty &&
              !currentReview &&
              !pending &&
              (entryRevision !== publishedEntryRevision || draftSchemaId !== publishedSchemaId)
            }
            publishReady={!entryDirty && entryRevision !== publishedEntryRevision && !currentReview && !pending}
            onSave={saveEntries}
            onSubmit={() => setSubmitOpen(true)}
            onReview={event =>
              openDialog(() => {
                setNotice(null)
                setPublishOpen(true)
              }, event.currentTarget)
            }
          />
        }
      >
        <CollectionRecordList
          model={model}
          listName={selected.name}
          noun={noun}
          entries={entries}
          visible={visible}
          availableMedia={availableMedia}
          checked={checked}
          view={view}
          canEdit={rights.editEntries}
          pending={pending}
          busy={busy}
          reorder={reorder}
          openEntry={openEntry}
          moveEntry={moveEntry}
          select={(key, selected) =>
            setChecked(current => (selected ? [...current, key] : current.filter(id => id !== key)))
          }
        />
      </RecordBoard>
    </>
  )
}

export function SelectedCollection({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const { selected, checked, setChecked, setDeleteOpen, entryEdits, entryDirty } = workspace.draft
  const { bulk } = workspace.editing
  const {
    siteId,
    initial,
    rights,
    router,
    lastReview,
    view,
    setView,
    search,
    setSearch,
    filter,
    setFilter,
    pending,
    busy,
  } = workspace
  if (!selected) return null
  return (
    <>
      <Card density="compact">
        <CollectionHeading model={workspace} />
        <CardContent>
          <div className={styles.listChoices + ' ' + styles.actions}>
            <Link
              href={'/sites/' + siteId + '/content?all=1'}
              aria-disabled={pending || undefined}
              tabIndex={pending ? -1 : undefined}
              onClick={event => {
                if (busy()) event.preventDefault()
              }}
            >
              ← All lists
            </Link>
            <Field id="list-switcher" label="List">
              <select
                value={selected.id}
                disabled={pending}
                onChange={event => {
                  if (busy()) return
                  const href = '?collection=' + event.target.value,
                    go = () => router.push(href)
                  if (requestClientNavigation(go)) go()
                }}
              >
                {initial.collections.map(list => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {rights.manageSchema && entryDirty && (
            <p className="hint">
              {entryEdits
                ? 'Save your item changes before changing or publishing list fields.'
                : 'Save the items to apply saved field changes before publishing.'}
            </p>
          )}
          {selected.usedOn?.length ? (
            <Disclosure title={`Used on ${selected.usedOn.length} ${selected.usedOn.length === 1 ? 'page' : 'pages'}`}>
              <ul className={ownedStyles.usageLinks}>
                {selected.usedOn.map(page => (
                  <li key={page.id}>
                    <TextLink title={page.title} href={'/pages/' + page.id}>
                      {page.title}
                    </TextLink>
                  </li>
                ))}
              </ul>
              <p className="hint">Save a draft, then publish this list to update those pages.</p>
            </Disclosure>
          ) : (
            <p className={recordTableStyles.meta}>Used on: No pages yet.</p>
          )}
          {lastReview && (
            <p className="notice">
              <span>
                {lastReview.status === 'open'
                  ? 'In review'
                  : lastReview.status === 'rejected'
                    ? 'Changes requested'
                    : lastReview.status === 'approved'
                      ? 'Approved and published'
                      : 'Previous review'}
                {lastReview.decisionNote && ': ' + lastReview.decisionNote} ·{' '}
                <TextLink href={`/sites/${siteId}/publishing?collectionReview=${lastReview.id}#collection-reviews`}>
                  View discussion
                </TextLink>
              </span>
            </p>
          )}
          <div className={styles.tools}>
            <Field id="collection-search" label="Search items" density="compact">
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Name or words in any field"
              />
            </Field>
            <SegmentedControl
              appearance="pills"
              size="s"
              label="Filter items"
              value={filter}
              onChange={value => setFilter(value as EntryFilter)}
              options={[
                { value: 'active', label: 'All' },
                { value: 'live', label: 'Live' },
                { value: 'changed', label: 'Draft' },
                { value: 'archived', label: 'Hidden' },
              ]}
            />
            <SegmentedControl
              appearance="pills"
              size="s"
              label="List view"
              value={view}
              onChange={setView}
              options={[
                { value: 'table', label: 'Table' },
                { value: 'cards', label: 'Cards' },
              ]}
            />
          </div>
          {checked.length > 0 && rights.editEntries && (
            <div className={styles.bulk}>
              <strong>{checked.length} selected</strong>
              <Button variant="secondary" size="s" disabled={pending} onClick={() => bulk(true)}>
                Hide
              </Button>
              <Button variant="secondary" size="s" disabled={pending} onClick={() => bulk(false)}>
                Show
              </Button>
              <Button variant="destructive" size="s" disabled={pending} onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
              <Button variant="tertiary" size="s" onClick={() => setChecked([])}>
                Clear selection
              </Button>
            </div>
          )}
          <CollectionRecords model={workspace} />
        </CardContent>
      </Card>
    </>
  )
}
