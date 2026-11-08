import { MediaPicker } from '../../../pages/[pageId]/media-picker.tsx'
import { ConfirmDialog, ReasonDialog } from '../../../../components/confirm.tsx'
import type { ImagePlacementValue } from '../../../../lib/media-library.ts'
import { CreateCollectionDialog } from './create-collection-dialog.tsx'
import { SchemaDesigner } from './schema-designer.tsx'
import { CsvDialog } from './csv-dialog.tsx'
import { CollectionEntryDrawer } from './collection-entry-drawer.tsx'
import { CollectionPublicationReview } from './collection-publication-review.tsx'
import { entryIdentity } from './collection-record-display.ts'
import { DocumentPickerDialog } from './document-picker-dialog.tsx'
import type { CollectionsWorkspaceModel } from './use-collections-workspace.ts'

export function CollectionWorkspaceDialogs({ model: workspace }: { model: CollectionsWorkspaceModel }) {
  const {
    selected,
    entries,
    setEntries,
    model,
    savedEntries,
    revision,
    checked,
    deleteOpen,
    setDeleteOpen,
    notice,
    setNotice,
    entryDirty,
    publicationChanges,
    invalidEntryKeys,
    noun,
    opened,
  } = workspace.draft
  const { updateEntry, setValue, duplicateEntry, cancelEntry, bulk } = workspace.editing
  const { submitForReview, saveEntries, publishEntriesNow, saveSchemaDraft } = workspace.commands
  const {
    siteId,
    siteName,
    rights,
    documents,
    actorId,
    router,
    availableMedia,
    setChosenMedia,
    submitOpen,
    setSubmitOpen,
    publishOpen,
    setPublishOpen,
    submitNote,
    setSubmitNote,
    createOpen,
    setCreateOpen,
    schemaOpen,
    setSchemaOpen,
    csvOpen,
    setCsvOpen,
    imageFor,
    setImageFor,
    documentFor,
    setDocumentFor,
    uploadedDocuments,
    setUploadedDocuments,
    pending,
    busy,
    openDialog,
    imageValue,
  } = workspace
  return (
    <>
      {publishOpen && selected && (
        <CollectionPublicationReview
          listName={selected.name}
          publicationChanges={publicationChanges}
          fields={model?.fields ?? []}
          savedEntries={savedEntries}
          pending={pending}
          error={notice && !notice.ok ? notice.message : undefined}
          onCancel={() => {
            if (!busy()) setPublishOpen(false)
          }}
          onPublish={publishEntriesNow}
        />
      )}
      {submitOpen && (
        <ReasonDialog
          pending={pending}
          required={false}
          title="Submit this list for review?"
          explanation="An editor will inspect the saved items, order and removals before publishing."
          label="What should the reviewer know?"
          value={submitNote}
          onChange={value => {
            if (!busy()) setSubmitNote(value)
          }}
          confirmLabel="Submit for review"
          onCancel={() => {
            if (!busy()) setSubmitOpen(false)
          }}
          onConfirm={submitForReview}
        />
      )}
      {deleteOpen && (
        <ConfirmDialog
          title={`Delete ${checked.length} selected items?`}
          what="The selected items will be removed from this list when you save and publish."
          reassurance="Their earlier content is kept in history. Hidden items can be restored."
          confirmLabel="Delete selected items"
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => {
            bulk(true)
            setDeleteOpen(false)
          }}
        />
      )}
      {opened && model && (
        <CollectionEntryDrawer
          opened={opened}
          noun={noun}
          fields={model.fields}
          availableMedia={availableMedia}
          pending={pending}
          canEdit={rights.editEntries}
          canSave={rights.editEntries && entryDirty && invalidEntryKeys.size === 0}
          error={notice && !notice.ok ? notice.message : undefined}
          onCancel={cancelEntry}
          onSave={saveEntries}
          onChange={(fieldKey, value) => setValue(entryIdentity(opened), fieldKey, value)}
          onImage={fieldKey => openDialog(() => setImageFor({ entryKey: entryIdentity(opened), fieldKey }))}
          onDocument={fieldKey => openDialog(() => setDocumentFor({ entryKey: entryIdentity(opened), fieldKey }))}
          onDuplicate={() => duplicateEntry(opened)}
          onToggleVisibility={() =>
            updateEntry(entryIdentity(opened), entry => ({ ...entry, archived: !entry.archived }))
          }
          onKeyChange={stableKey => updateEntry(entryIdentity(opened), entry => ({ ...entry, stableKey }))}
        />
      )}
      {createOpen && (
        <CreateCollectionDialog
          siteId={siteId}
          siteName={siteName}
          onDraftCreated={() => {
            setNotice({
              ok: true,
              revision,
              versionId: null,
              message: 'List saved as a private draft. Nothing was published.',
            })
            router.refresh()
          }}
          onClose={() => setCreateOpen(false)}
          onCreatedAfterClose={() => {
            setNotice({
              ok: true,
              revision,
              versionId: null,
              message: 'The list was created after you closed the window. Your current list is unchanged.',
            })
            router.refresh()
          }}
          onResult={result => {
            setCreateOpen(false)
            router.push(`/sites/${siteId}/content?collection=${result.collectionId}`)
            router.refresh()
          }}
        />
      )}
      {schemaOpen && selected && model && (
        <SchemaDesigner
          initial={model}
          pending={pending}
          notice={notice}
          onClose={() => setSchemaOpen(false)}
          onSave={saveSchemaDraft}
        />
      )}
      {csvOpen && selected && model && (
        <CsvDialog
          actorId={actorId}
          siteId={siteId}
          collectionId={selected.id}
          name={selected.name}
          model={model}
          entries={entries}
          canImport={rights.editEntries && !pending}
          onClose={() => setCsvOpen(false)}
          onImport={imported => {
            if (busy() || !rights.editEntries) return
            setEntries(current => [
              ...current,
              ...imported.map((entry, offset) => ({
                ...entry,
                clientId: crypto.randomUUID(),
                schemaVersionId: null,
                revision: 0,
                sortIndex: current.filter(item => !item.archived).length + offset,
                publishedSortIndex: null,
                publishedValues: null,
                archived: false,
                publishedArchived: false,
              })),
            ])
            setCsvOpen(false)
          }}
        />
      )}
      {imageFor && (
        <MediaPicker
          siteId={siteId}
          initialAssets={availableMedia}
          currentValue={
            imageValue && typeof imageValue === 'object' ? (imageValue as Partial<ImagePlacementValue>) : undefined
          }
          onClose={() => setImageFor(null)}
          onSelectedAsset={asset => setChosenMedia(current => [asset, ...current.filter(item => item.id !== asset.id)])}
          onChoose={({ src, alt, decorative }) => {
            setValue(imageFor.entryKey, imageFor.fieldKey, { src, alt, decorative })
            setImageFor(null)
          }}
        />
      )}
      {documentFor && (
        <DocumentPickerDialog
          siteId={siteId}
          documents={[
            ...uploadedDocuments,
            ...documents.filter(document => !uploadedDocuments.some(upload => upload.id === document.id)),
          ]}
          onClose={() => setDocumentFor(null)}
          onUploaded={document =>
            setUploadedDocuments(current => [document, ...current.filter(item => item.id !== document.id)])
          }
          onChoose={document => {
            setValue(documentFor.entryKey, documentFor.fieldKey, document.url)
            setDocumentFor(null)
          }}
        />
      )}
    </>
  )
}
