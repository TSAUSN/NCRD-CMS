import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import { ContentOrderList, ContentOrderRow, ContentPreviewCards } from '../../../../components/content-order.tsx'
import { Button, Card, EmptyState, Note } from '../../../../components/ui/index.ts'
import { IconArrowUp, IconArrowDown } from '../../../../components/icons.tsx'
import { storyTitle, storyDate, type NewsroomOrderModel } from './use-newsroom-order.ts'
import shared from '../../../../components/workspace.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'

export function NewsroomOrderPreview({ model }: { model: NewsroomOrderModel }) {
  const {
    featured,
    reorderDisabled,
    featureDrag,
    overFeatured,
    setOverFeatured,
    refusedFeature,
    feature,
    eligibleById,
    reorder,
    editable,
    pending,
    hasProposal,
    move,
    other,
    setError,
    proposal,
    visitor,
  } = model
  return (
    <div className={shared.twoColumns}>
      <div className={shared.stack}>
        <Card
          density="editor"
          title="Featured"
          headerActions={<span className={recordTableStyles.meta}>{featured.length} of 5</span>}
        >
          <p className={recordTableStyles.meta}>These stay first in the Newsroom, in this order. Drag to change it.</p>
          <ContentOrderList
            aria-label="Featured stories"
            className={reorderStyles.list}
            data-reorder-list
            onDragOver={event => {
              if (reorderDisabled || !featureDrag.current) return
              event.preventDefault()
              setOverFeatured(featured.length < 5)
              refusedFeature.current = featured.length >= 5
              event.dataTransfer.dropEffect = refusedFeature.current ? 'none' : 'copy'
            }}
            onDragLeave={event => {
              if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) {
                refusedFeature.current = false
                setOverFeatured(false)
              }
            }}
            onDrop={event => {
              const id = featureDrag.current
              if (!id) return
              event.preventDefault()
              featureDrag.current = null
              setOverFeatured(false)
              feature(id, true)
            }}
          >
            {featured.map((row, index) => (
              <ContentOrderRow
                key={row.id}
                title={storyTitle(row)}
                subtitle={storyDate(row) + (!eligibleById.has(row.id) ? ' · Not currently in feeds' : '')}
                photo={row.photoPreview}
                position={index + 1}
                data-feature-id={row.id}
                {...reorder.row(row.id, reorderDisabled)}
                actions={
                  editable ? (
                    <>
                      <Button
                        variant="tertiary"
                        size="s"
                        disabled={pending || hasProposal || index === 0}
                        aria-label={'Move ' + storyTitle(row) + ' up'}
                        onClick={() => move(row.id, index - 1)}
                      >
                        <IconArrowUp size={16} />
                      </Button>
                      <Button
                        variant="tertiary"
                        size="s"
                        disabled={pending || hasProposal || index === featured.length - 1}
                        aria-label={'Move ' + storyTitle(row) + ' down'}
                        onClick={() => move(row.id, index + 1)}
                      >
                        <IconArrowDown size={16} />
                      </Button>
                      <Button
                        variant="tertiary"
                        size="s"
                        disabled={pending || hasProposal}
                        aria-label={'Unfeature ' + storyTitle(row)}
                        onClick={() => feature(row.id, false)}
                      >
                        <span aria-hidden="true">★</span>
                      </Button>
                    </>
                  ) : undefined
                }
              >
                <DropIndicator
                  marker={
                    overFeatured && index === featured.length - 1 ? { row: row.id, edge: 'after' } : reorder.marker
                  }
                  row={row.id}
                />
              </ContentOrderRow>
            ))}
          </ContentOrderList>
          <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
          {!featured.length && <EmptyState title="No featured stories">Click a story’s star to feature it.</EmptyState>}
          {featured.length < 5 && (
            <p className={recordTableStyles.meta}>Drag a story here, or click its star, to feature it.</p>
          )}
          <h2>Everything else</h2>
          <p className={recordTableStyles.meta}>Newest first, by story date. Change a story’s date to move it here.</p>
          <ContentOrderList aria-label="Other stories">
            {other.map(row => (
              <ContentOrderRow
                key={row.id}
                title={storyTitle(row)}
                subtitle={storyDate(row)}
                photo={row.photoPreview}
                draggable={editable && !pending && !hasProposal}
                onDragStart={event => {
                  featureDrag.current = row.id
                  refusedFeature.current = false
                  event.dataTransfer.effectAllowed = 'copy'
                  event.dataTransfer.setData('text/plain', row.id)
                }}
                onDragEnd={() => {
                  if (featureDrag.current && refusedFeature.current)
                    setError('You can feature up to 5 stories. Remove one first.')
                  refusedFeature.current = false
                  featureDrag.current = null
                  setOverFeatured(false)
                }}
                actions={
                  editable ? (
                    <Button
                      variant="tertiary"
                      size="s"
                      disabled={pending || hasProposal}
                      aria-label={'Feature ' + storyTitle(row)}
                      onClick={() => feature(row.id, true)}
                    >
                      <span aria-hidden="true">☆</span>
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ContentOrderList>
          {!other.length && <p>No other stories yet.</p>}
        </Card>
      </div>
      <Card density="editor" title="What visitors see">
        <p className={recordTableStyles.meta}>
          Newsroom, Recently Published · First 6 stories ·{' '}
          {proposal ? 'Proposed order, not saved yet' : 'Saved draft preview'}
        </p>
        <h2>News and Stories</h2>
        <ContentPreviewCards
          rows={visitor.slice(0, 6).map(row => ({
            id: row.id,
            title: storyTitle(row),
            photo: row.photoPreview,
            ...(featured.some(item => item.id === row.id)
              ? { position: featured.findIndex(item => item.id === row.id) + 1 }
              : {}),
          }))}
        />
        {!visitor.length && <p>No stories are currently eligible for this feed.</p>}
        <Note>
          Featured only changes the Newsroom and other news lists. Sector pages always show by tag, newest first.
        </Note>
        <p className={recordTableStyles.meta}>Order changes go live with Publish.</p>
      </Card>
    </div>
  )
}
