'use client'
import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import { flatReorderIntent } from '../../../../components/ui/flat-reorder.ts'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { ContentOrderList, ContentOrderRow, ContentPreviewCards } from '../../../../components/content-order.tsx'
import { useEffect, useRef, useState, useTransition } from 'react'
import { orderedNewsroomStories, storyFeatureRank, storyAllowedInFeeds, storyDateInFeed } from '@cms/schema'
import { AddStory } from './add-story.tsx'
import { StoriesHeader } from './header.tsx'
import { Button, ButtonLink, Card, EmptyState, Note } from '../../../../components/ui/index.ts'
import { IconArrowUp, IconArrowDown } from '../../../../components/icons.tsx'
import { useNavigationGuard } from '../../../../components/navigation-guard.ts'
import { storyListLive, storyInSource } from '../../../../lib/story-list.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import { saveStoryNewsroomOrder, saveStoryListPatch, reloadStoryList } from './actions.ts'
import shared from '../../../../components/workspace.module.css'
type State = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
type Intent = { kind: 'order'; ids: string[] } | { kind: 'feature'; id: string; value: boolean }
export function StoriesNewsroomOrder({
  siteId,
  initial,
  rights,
  canCreate,
}: {
  siteId: string
  initial: State
  rights: CollectionRights
  canCreate: boolean
}) {
  const [state, setState] = useState(initial),
    [proposal, setProposal] = useState<string[] | null>(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [pending, start] = useTransition(),
    busy = useRef(false),
    intent = useRef<Intent | null>(null),
    featureDrag = useRef<string | null>(null),
    [overFeatured, setOverFeatured] = useState(false),
    refusedFeature = useRef(false),
    saved = useRef(initial)
  const ordered = orderedNewsroomStories(state.rows),
    featured = proposal
      ? proposal.flatMap(id => state.rows.filter(row => row.id === id))
      : ordered.filter(row => storyFeatureRank(row.values)),
    other = state.rows.filter(row => !featured.some(f => f.id === row.id)),
    eligible = ordered.filter(
      row => storyAllowedInFeeds(row.values, state.settings) && storyDateInFeed(row.values.published_date),
    ),
    visitor = proposal
      ? [
          ...proposal.flatMap(id => eligible.filter(row => row.id === id)),
          ...eligible.filter(row => !proposal.includes(row.id)),
        ]
      : eligible,
    editable = rights.editEntries && state.newsroomReady
  useEffect(() => {
    if (busy.current || intent.current) return
    saved.current = initial
    setState(initial)
  }, [initial])
  async function run(next: Intent): Promise<{ ok: boolean; message?: string }> {
    if (busy.current) return { ok: false, message: 'Wait for the current Story change to finish.' }
    intent.current = next
    busy.current = true
    setError('')
    setNotice('Saving Newsroom order…')
    try {
      const base = saved.current,
        result =
          next.kind === 'order'
            ? await saveStoryNewsroomOrder(
                siteId,
                base.collectionId,
                base.catalogRevision,
                base.entryRevision,
                next.ids,
              )
            : await saveStoryListPatch(siteId, base.collectionId, next.id, base.catalogRevision, base.entryRevision, {
                action: 'featured',
                value: next.value,
              })
      if (!result.ok) {
        setError(result.message)
        setNotice('Your proposed order is not confirmed. Retry, or use the saved order.')
        return { ok: false, message: result.message }
      }
      const entries = 'entries' in result ? result.entries : undefined,
        rows = base.rows.map(row => {
          const changed = entries?.find(e => e.id === row.id)
          return changed ? { ...row, values: changed.values, changed: changed.changed } : row
        })
      const current = { ...base, rows, catalogRevision: result.catalogRevision, entryRevision: result.entryRevision }
      saved.current = current
      setState(current)
      intent.current = null
      setProposal(null)
      setNotice('Newsroom order saved.')
      return { ok: true }
    } catch {
      const message =
        'The result could not be confirmed. Your proposed order is still here. Check the saved order before retrying.'
      setError(message)
      return { ok: false, message }
    } finally {
      busy.current = false
    }
  }
  const apply = (next: Intent, ids: string[]) => {
    if (pending || busy.current) return
    setProposal(ids)
    start(async () => {
      await run(next)
    })
  }
  async function discard() {
    if (busy.current) return
    const latest = await reloadStoryList(siteId)
    if (!latest.ok) {
      setError(latest.message)
      return
    }
    const current = { ...saved.current, ...latest, media: saved.current.media }
    saved.current = current
    setState(current)
    setProposal(null)
    intent.current = null
    setError('')
    setNotice('Saved Newsroom order restored. Unsaved proposal discarded.')
  }
  useNavigationGuard(() => ({
    dirty: intent.current !== null,
    pending: pending || busy.current,
    draft: {
      label: 'Newsroom order',
      saveDraft: () => (intent.current ? run(intent.current) : Promise.resolve({ ok: true })),
      discard,
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (intent.current || busy.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  function feature(id: string, value: boolean) {
    if (!editable || pending || intent.current) return
    const ids = featured.map(row => row.id)
    if (value && ids.length >= 5) {
      setError('You can feature up to 5 stories. Remove one first.')
      return
    }
    apply({ kind: 'feature', id, value }, value ? [...ids, id] : ids.filter(key => key !== id))
  }
  function move(id: string, to: number) {
    if (!editable || pending || intent.current) return
    const ids = featured.map(row => row.id),
      from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    ids.splice(from, 1)
    ids.splice(to, 0, id)
    apply({ kind: 'order', ids }, ids)
  }
  const title = (row: State['rows'][number]) => String(row.values.title ?? 'Untitled story'),
    date = (row: State['rows'][number]) => String(row.values.published_date ?? '')
  const reorderDisabled = !editable || pending || Boolean(intent.current)
  const reorder = useReorderableList({
    mimeType: 'application/x-cms-featured-story',
    decide: point =>
      flatReorderIntent(
        featured.map(row => row.id),
        point,
      ),
    apply: ({ from, to }) => {
      const row = featured[from]!
      move(row.id, to)
      return title(row) + ' moved to position ' + (to + 1) + '.'
    },
  })
  const live = state.rows.filter(row => storyListLive(row, state.publishedSettings)).length,
    needsReview = state.rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
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
                revision={saved.current.entryRevision}
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
          {intent.current && (
            <div className={shared.actions}>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await discard()
                  })
                }
              >
                Use saved order
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    if (intent.current) await run(intent.current)
                  })
                }
              >
                Retry changes
              </Button>
            </div>
          )}
        </Note>
      )}
      <div className={shared.twoColumns}>
        <div className={shared.stack}>
          <Card
            density="editor"
            title="Featured"
            headerActions={<span className={shared.meta}>{featured.length} of 5</span>}
          >
            <p className={shared.meta}>These stay first in the Newsroom, in this order. Drag to change it.</p>
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
                  title={title(row)}
                  subtitle={date(row) + (!eligible.some(item => item.id === row.id) ? ' · Not currently in feeds' : '')}
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
                          disabled={pending || Boolean(intent.current) || index === 0}
                          aria-label={'Move ' + title(row) + ' up'}
                          onClick={() => move(row.id, index - 1)}
                        >
                          <IconArrowUp size={16} />
                        </Button>
                        <Button
                          variant="tertiary"
                          size="s"
                          disabled={pending || Boolean(intent.current) || index === featured.length - 1}
                          aria-label={'Move ' + title(row) + ' down'}
                          onClick={() => move(row.id, index + 1)}
                        >
                          <IconArrowDown size={16} />
                        </Button>
                        <Button
                          variant="tertiary"
                          size="s"
                          disabled={pending || Boolean(intent.current)}
                          aria-label={'Unfeature ' + title(row)}
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
            {!featured.length && (
              <EmptyState title="No featured stories">Click a story’s star to feature it.</EmptyState>
            )}
            {featured.length < 5 && <p className={shared.meta}>Drag a story here, or click its star, to feature it.</p>}
            <h2>Everything else</h2>
            <p className={shared.meta}>Newest first, by story date. Change a story’s date to move it here.</p>
            <ContentOrderList aria-label="Other stories">
              {other.map(row => (
                <ContentOrderRow
                  key={row.id}
                  title={title(row)}
                  subtitle={date(row)}
                  photo={row.photoPreview}
                  draggable={editable && !pending && !intent.current}
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
                        disabled={pending || Boolean(intent.current)}
                        aria-label={'Feature ' + title(row)}
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
          <p className={shared.meta}>
            Newsroom, Recently Published · First 6 stories ·{' '}
            {proposal ? 'Proposed order, not saved yet' : 'Saved draft preview'}
          </p>
          <h2>News and Stories</h2>
          <ContentPreviewCards
            rows={visitor.slice(0, 6).map(row => ({
              id: row.id,
              title: title(row),
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
          <p className={shared.meta}>Order changes go live with Publish.</p>
        </Card>
      </div>
    </>
  )
}
