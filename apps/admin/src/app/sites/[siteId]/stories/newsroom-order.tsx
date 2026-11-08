'use client'
import { AddStory } from './add-story.tsx'
import { StoriesHeader } from './header.tsx'
import { Button, ButtonLink, Note } from '../../../../components/ui/index.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import { useNewsroomOrder, type NewsroomOrderProps } from './use-newsroom-order.ts'
import { NewsroomOrderPreview } from './newsroom-order-preview.tsx'

export function StoriesNewsroomOrder(props: NewsroomOrderProps) {
  const { siteId, rights, canCreate } = props
  const model = useNewsroomOrder(props)
  const { state, live, needsReview, entryRevision, notice, error, hasProposal, pending, useSavedOrder, retry } = model
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="order"
        actions={
          <>
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={'/sites/' + siteId + '/stories/tags'}>
                Manage tags
              </ButtonLink>
            )}
            <ButtonLink
              variant="secondary"
              href={'/preview/stories/' + siteId + '?widget=split&first=recent'}
              target="_blank"
              rel="noopener"
            >
              Preview
            </ButtonLink>
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={state.collectionId}
                revision={entryRevision}
                catalog={state.settings}
                media={state.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      {(state.catalogChanged || state.rows.some(row => row.changed)) && (
        <Note tone="warning">
          Draft changes wait for publishing.{' '}
          {rights.publish && (
            <ButtonLink variant="tertiary" size="s" href={'/sites/' + siteId + '/publishing?lists=1'}>
              Review and publish
            </ButtonLink>
          )}
        </Note>
      )}
      {!state.newsroomReady && <Note>A Site admin must update Stories from its list before featuring stories.</Note>}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <Note tone="warning">
          <p role="alert">{error}</p>
          {hasProposal && (
            <div className={workspaceFormsStyles.actions}>
              <Button variant="secondary" disabled={pending} onClick={useSavedOrder}>
                Use saved order
              </Button>
              <Button disabled={pending} onClick={retry}>
                Retry changes
              </Button>
            </div>
          )}
        </Note>
      )}

      <NewsroomOrderPreview model={model} />
    </>
  )
}
