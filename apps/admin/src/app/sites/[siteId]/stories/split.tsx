'use client'
import { useEffect, useState } from 'react'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { storyInSource, storyListLive } from '../../../../lib/story-list.ts'
import { storySourceStatusLine } from '../../../../lib/story-source-status.ts'
import { splitChoiceQuery, type SplitChoice } from '../../../../lib/story-widget-choice.ts'
import { ScaledPreview } from '../../../../components/scaled-preview.tsx'
import { Button, ButtonLink, Card, Dialog, Field, Note } from '../../../../components/ui/index.ts'
import { StoriesHeader } from './header.tsx'
import { AddStory } from './add-story.tsx'
import { AddStoryWidget } from './add-widget.tsx'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
type State = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
export function StoriesSplit({
  siteId,
  state,
  rights,
  canCreate,
  initial,
}: {
  siteId: string
  state: State
  rights: CollectionRights
  canCreate: boolean
  initial: SplitChoice
}) {
  const [choice, setChoice] = useState(initial)
  const [preview, setPreview] = useState(initial)
  const [full, setFull] = useState(false)
  const [saved, setSaved] = useState<{ pageId: string; title: string } | null>(null)
  const base = '/sites/' + siteId + '/stories'
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreview(choice)
      const q = splitChoiceQuery(choice)
      q.delete('widget')
      q.set('view', 'split')
      window.history.replaceState(window.history.state, '', base + '?' + q.toString())
    }, 250)
    return () => clearTimeout(timer)
  }, [choice, base])
  function value<K extends keyof SplitChoice>(key: K, next: SplitChoice[K]) {
    setChoice(current => ({ ...current, [key]: next }))
    setSaved(null)
  }
  const live = state.rows.filter(row => storyListLive(row, state.publishedSettings)).length
  const needsReview = state.rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
  const mainView =
    state.settings.mainLabel === 'Project Sectors' ? 'By Project Sector' : 'By ' + state.settings.mainLabel
  const url = (settings: SplitChoice) => '/preview/stories/' + siteId + '?' + splitChoiceQuery(settings)
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="split"
        sourceStatus={storySourceStatusLine(state.settings.source, state.sourceStatus)}
        actions={
          <>
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={base + '/tags'}>
                Manage tags
              </ButtonLink>
            )}
            <Button variant="secondary" onClick={() => setFull(true)}>
              Preview
            </Button>
            {canCreate && rights.editEntries && (
              <AddStory
                siteId={siteId}
                collectionId={state.collectionId}
                revision={state.entryRevision}
                catalog={state.settings}
                media={state.media.filter(asset => asset.status === 'ready' && asset.deliveryUrl !== null)}
              />
            )}
          </>
        }
      />
      {saved && (
        <Note tone="success">
          {saved.title}: added Split View as a draft. <Link href={'/pages/' + saved.pageId}>Open page</Link> to review
          and publish.
        </Note>
      )}
      <div className={workspacePreviewStyles.settingsPreview}>
        <Card title="Split View section" density="summary">
          <div className={workspaceFormsStyles.compactFields}>
            <p className={recordTableStyles.meta}>
              A full news page with three ways to browse, all from tags. Add it to the Newsroom or any page.
            </p>
            <Field id="split-heading" label="Heading">
              <input
                id="split-heading"
                maxLength={160}
                value={choice.heading}
                onChange={event => value('heading', event.target.value)}
              />
            </Field>
            <Field id="split-introduction" label="Introduction">
              <textarea
                id="split-introduction"
                maxLength={2000}
                rows={3}
                value={choice.introduction}
                onChange={event => value('introduction', event.target.value)}
              />
            </Field>
            <Field id="split-first" label="View shown first">
              <select
                id="split-first"
                value={choice.first}
                onChange={event => value('first', event.target.value as SplitChoice['first'])}
              >
                <option value="recent">Recently Published</option>
                <option value="sectors">{mainView}</option>
                <option value="map">By Map</option>
              </select>
            </Field>
            <Field id="split-size" label={'Stories per "Show more"'}>
              <select
                id="split-size"
                value={choice.size}
                onChange={event => value('size', event.target.value as SplitChoice['size'])}
              >
                {['3', '6', '9', '12', '24'].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            {rights.manageSchema && state.ready && (
              <AddStoryWidget siteId={siteId} kind="split" choice={choice} onSaved={setSaved} />
            )}{' '}
            {!rights.manageSchema && (
              <p className={recordTableStyles.meta}>A Site admin can add this section to a page.</p>
            )}
            {!state.ready && (
              <Note tone="warning">A Site admin must save the Story tags before this section can be added.</Note>
            )}
          </div>
        </Card>
        <div className={workspacePreviewStyles.previewPanel}>
          <ScaledPreview
            width={1280}
            src={url(preview)}
            title="Split View draft preview"
            bounded
            readySelector="[data-cms-story-kind=split]"
            backLabel="Back to Split View preview"
          />
          <p className={recordTableStyles.meta}>
            Saved draft stories · Preview choices are kept in this address. Nothing is published.
          </p>
        </div>
      </div>
      {full && (
        <Dialog
          title="Preview Split View"
          size="wide"
          onClose={() => setFull(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setFull(false)}>
                Cancel
              </Button>
              <Button onClick={() => setFull(false)}>Done</Button>
            </>
          }
        >
          <ScaledPreview
            width={1280}
            src={url(choice)}
            title="Split View full preview"
            readySelector="[data-cms-story-kind=split]"
            backLabel="Back to Split View preview"
          />
        </Dialog>
      )}
    </>
  )
}
