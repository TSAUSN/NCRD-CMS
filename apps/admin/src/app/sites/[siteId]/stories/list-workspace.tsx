'use client'
import { Button, ButtonLink, Dialog, EmptyState, Note, TextLink } from '../../../../components/ui/index.ts'
import { StoryListRowView } from '../../../../components/story-list-row.tsx'
import { storyPreviewHref } from '../../../../lib/story-list.ts'
import { AddStory } from './add-story.tsx'
import { storySourceCapabilities } from '@cms/schema'
import { storySourceStatusLine } from '../../../../lib/story-source-status.ts'
import { StoriesHeader } from './header.tsx'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import listInspectorStyles from '../../../../components/workspace-styles/list-inspector.module.css'
import { useStoryListDraft, type StoryListProps } from './list-draft.ts'
import { StoryListFilters } from './list-filters.tsx'

export function StoriesList(props: StoryListProps) {
  const { siteId, initial, rights, canCreate } = props
  const {
    sourceStatus,
    checking,
    checkMessage,
    checkFailed,
    newStories,
    retryCheck,
    checkSource,
    search,
    filters,
    setFilters,
    live,
    needsReview,
    settings,
    publishedSettings,
    rows,
    visible,
    newsroomReady,
    updating,
    savedDraft,
    queued,
    notice,
    failure,
    errorOpen,
    setErrorOpen,
    entryRevision,
    canRetry,
    enqueue,
    retry,
    discard,
    updateWritingTools,
  } = useStoryListDraft(props)
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="stories"
        sourceStatus={checking ? 'Checking feed…' : storySourceStatusLine(settings.source, sourceStatus)}
        actions={
          <>
            {rights.manageSchema && initial.ready && storySourceCapabilities(settings.source).canCheck && (
              <Button
                variant="secondary"
                disabled={checking || queued > 0 || Boolean(failure)}
                onClick={() => void checkSource()}
              >
                {checking ? 'Checking stories…' : retryCheck ? 'Retry check' : 'Check for new stories'}
              </Button>
            )}
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories/tags'}>
                Manage tags
              </ButtonLink>
            )}
            {queued || failure || checking ? (
              <Button variant="secondary" disabled>
                Preview
              </Button>
            ) : (
              <ButtonLink variant="secondary" href={storyPreviewHref(siteId, filters)} target="_blank" rel="noopener">
                Preview
              </ButtonLink>
            )}
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={initial.collectionId}
                revision={entryRevision}
                catalog={settings}
                media={initial.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      {checkMessage && (
        <p className={recordTableStyles.meta} role={checkFailed ? 'alert' : 'status'}>
          {checkMessage}
          {newStories > 0 && (
            <Button
              variant="tertiary"
              size="s"
              onClick={() => setFilters({ q: '', status: 'review', main: '', secondary: '' })}
            >
              Review new stories
            </Button>
          )}
        </p>
      )}
      {savedDraft && (
        <Note tone="warning">
          Draft changes wait for publishing.{' '}
          {rights.publish && <TextLink href={'/sites/' + siteId + '/publishing?lists=1'}>Review and publish</TextLink>}
        </Note>
      )}
      {!newsroomReady && (
        <Note>
          Update Stories to use Feature, Newsroom order and Author.{' '}
          {rights.manageSchema && (
            <Button
              variant="secondary"
              loading={updating}
              disabled={checking || queued > 0 || Boolean(failure)}
              onClick={updateWritingTools}
            >
              Update Stories
            </Button>
          )}
        </Note>
      )}
      {!initial.ready && (
        <Note>
          Existing stories are available. A Site admin must finish the Stories update before quick tagging is available.
        </Note>
      )}
      {notice && (
        <p className={recordTableStyles.meta} role={failure ? 'alert' : 'status'}>
          {notice} {queued > 0 && !failure && `(${queued} queued)`}
          {failure && (
            <Button variant="tertiary" size="s" onClick={() => setErrorOpen(true)}>
              Review unsaved changes
            </Button>
          )}
        </p>
      )}

      <StoryListFilters
        search={search}
        filters={filters}
        setFilters={setFilters}
        settings={settings}
        visibleCount={visible.length}
        totalCount={rows.length}
      />
      <div className={listInspectorStyles.listRows} aria-label="Stories">
        {visible.map(row => (
          <StoryListRowView
            key={row.id}
            row={row}
            settings={settings}
            publishedSettings={publishedSettings}
            siteId={siteId}
            editable={rights.editEntries && initial.ready}
            featureEditable={newsroomReady}
            pending={checking || updating}
            onChange={patch => enqueue(row.id, patch)}
          />
        ))}
        {!visible.length && (
          <EmptyState
            title={rows.length ? 'No stories match these filters' : 'No stories yet'}
            action={
              rows.length ? (
                <Button
                  variant="secondary"
                  onClick={() => setFilters({ q: '', status: 'all', main: '', secondary: '' })}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {rows.length
              ? 'Try another search or clear the filters.'
              : 'Add a story to start. It stays private until it is published.'}
          </EmptyState>
        )}
      </div>
      {errorOpen && (
        <Dialog
          density="compact"
          size="medium"
          title="Story changes weren't saved"
          role="alertdialog"
          onClose={() => setErrorOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setErrorOpen(false)}>
                Cancel
              </Button>
              <Button variant={canRetry ? 'secondary' : 'primary'} onClick={discard}>
                Discard unsaved changes
              </Button>
              {canRetry && <Button onClick={retry}>Retry changes</Button>}
            </>
          }
        >
          <div className={workspaceFormsStyles.compactFields}>
            <p>{failure}</p>
            <p>
              {queued} queued {queued === 1 ? 'change is' : 'changes are'} still here. Saved story text and photos are
              preserved.
            </p>
            {!canRetry && (
              <p>A story or tag is no longer available. Discard the queued choices, then use the current list.</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
