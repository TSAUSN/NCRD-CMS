'use client'
import { useEffect, useState } from 'react'
import { GuardedLink as Link } from '../../../../components/guarded-link.tsx'
import type { CollectionRights } from '../../../../lib/collection-queries.ts'
import type { getStoryListState } from '../../../../lib/stories-workspace.ts'
import { storyInSource, storyListLive } from '../../../../lib/story-list.ts'
import { storySourceStatusLine } from '../../../../lib/story-source-status.ts'
import { worldChoiceQuery, type WorldChoice } from '../../../../lib/story-widget-choice.ts'
import { ScaledPreview } from '../../../../components/scaled-preview.tsx'
import { Button, ButtonLink, Card, Dialog, Field, Note } from '../../../../components/ui/index.ts'
import { StoriesHeader } from './header.tsx'
import { AddStory } from './add-story.tsx'
import { addWorld, loadWorldPages } from './actions.ts'
import workspaceFormsStyles from '../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../components/workspace-styles/record-table.module.css'
import workspacePreviewStyles from '../../../../components/workspace-styles/workspace-preview.module.css'
import ownedStyles from './world-styles.module.css'
type State = NonNullable<Awaited<ReturnType<typeof getStoryListState>>>
type Page = { id: string; title: string; slug: string; revision: string }
export function StoriesWorld({
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
  initial: WorldChoice
}) {
  const [choice, setChoice] = useState(initial),
    [preview, setPreview] = useState(initial),
    [open, setOpen] = useState(false),
    [pages, setPages] = useState<Page[]>([]),
    [loading, setLoading] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [pageId, setPageId] = useState(''),
    [search, setSearch] = useState(''),
    [saved, setSaved] = useState<{ pageId: string; title: string } | null>(null)
  const base = '/sites/' + siteId + '/stories',
    live = state.rows.filter(row => storyListLive(row, state.publishedSettings)).length,
    needsReview = state.rows.filter(row => storyInSource(row.values) && row.values.reviewed !== true).length
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreview(choice)
      const q = worldChoiceQuery(choice)
      q.delete('widget')
      q.set('view', 'world')
      window.history.replaceState(window.history.state, '', base + '?' + q.toString())
    }, 250)
    return () => clearTimeout(timer)
  }, [choice, base])
  function value<K extends keyof WorldChoice>(key: K, next: WorldChoice[K]) {
    setChoice(current => ({ ...current, [key]: next }))
    setSaved(null)
  }
  async function load() {
    setLoading(true)
    setError('')
    try {
      const result = await loadWorldPages(siteId)
      if (result.ok) {
        setPages(result.pages)
        setPageId('')
      } else setError(result.message)
    } catch {
      setError('Pages could not be loaded. Try again.')
    } finally {
      setLoading(false)
    }
  }
  async function add() {
    const page = pages.find(p => p.id === pageId)
    if (!page) return
    setPending(true)
    setError('')
    try {
      const result = await addWorld(siteId, page.id, page.revision, choice)
      if (result.ok) {
        setSaved({ pageId: page.id, title: page.title })
        setOpen(false)
      } else setError(result.message)
    } catch {
      setError(
        'The connection was interrupted. Try Add as draft again with the same page choice. A saved section will not be added twice.',
      )
    } finally {
      setPending(false)
    }
  }
  const mainLabel =
      state.settings.mainLabel === 'Project Sectors'
        ? 'Only these project sectors'
        : 'Only these ' + state.settings.mainLabel.toLowerCase(),
    mainSummary = choice.main.length
      ? state.settings.mainTags
          .filter(t => choice.main.includes(t.id))
          .map(t => t.label)
          .join(', ')
      : 'All'
  return (
    <>
      <StoriesHeader
        siteId={siteId}
        live={live}
        needsReview={needsReview}
        view="world"
        sourceStatus={storySourceStatusLine(state.settings.source, state.sourceStatus)}
        actions={
          <>
            {rights.manageSchema && (
              <ButtonLink variant="secondary" href={base + '/tags'}>
                Manage tags
              </ButtonLink>
            )}
            <ButtonLink variant="secondary" href={'/preview/stories/' + siteId + '?' + worldChoiceQuery(choice)}>
              Preview
            </ButtonLink>
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
          {saved.title}: added World View as a draft. <Link href={'/pages/' + saved.pageId}>Open page</Link> to review
          and publish.
        </Note>
      )}
      <div className={workspacePreviewStyles.settingsPreview}>
        <Card title="World View section" density="summary">
          <div className={workspaceFormsStyles.compactFields}>
            <p className={recordTableStyles.meta}>Add this section to any page from the library. No code to copy.</p>
            <Field id="world-heading" label="Heading above the map">
              <input
                id="world-heading"
                maxLength={160}
                value={choice.heading}
                onChange={event => value('heading', event.target.value)}
              />
            </Field>
            <Field id="world-region" label="Region shown when the page opens">
              <select id="world-region" value={choice.region} onChange={event => value('region', event.target.value)}>
                <option value="">None, ask visitors to pick</option>
                {state.settings.secondaryTags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.label}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <label id="world-main-label">{mainLabel}</label>
              <details className={ownedStyles.choiceDetails}>
                <summary aria-labelledby="world-main-label">{mainSummary}</summary>
                <div className={workspaceFormsStyles.compactFields}>
                  {state.settings.mainTags.length ? (
                    state.settings.mainTags.map(tag => (
                      <label key={tag.id} className={workspaceFormsStyles.actions}>
                        <input
                          type="checkbox"
                          checked={choice.main.includes(tag.id)}
                          onChange={event =>
                            value(
                              'main',
                              event.target.checked ? [...choice.main, tag.id] : choice.main.filter(id => id !== tag.id),
                            )
                          }
                        />
                        {tag.label}
                      </label>
                    ))
                  ) : (
                    <p className={recordTableStyles.meta}>A Site admin can add main tags in Manage tags.</p>
                  )}
                  {choice.main.length > 0 && (
                    <Button variant="tertiary" onClick={() => value('main', [])}>
                      All main tags
                    </Button>
                  )}
                </div>
              </details>
            </div>
            <Field id="world-limit" label="Stories per region">
              <select
                id="world-limit"
                value={choice.limit}
                onChange={event => value('limit', event.target.value as WorldChoice['limit'])}
              >
                {['200', '3', '6', '9', '12', '24'].map(n => (
                  <option key={n} value={n}>
                    {n === '200' ? 'All' : n}
                  </option>
                ))}
              </select>
            </Field>
            <p className={recordTableStyles.meta}>
              Regions with no live stories stay grey. Map areas are set in Manage tags.
            </p>
            {rights.manageSchema && state.ready && (
              <div className={workspaceFormsStyles.actions}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setOpen(true)
                    setSearch('')
                    void load()
                  }}
                >
                  Add to a page…
                </Button>
              </div>
            )}
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
            src={'/preview/stories/' + siteId + '?' + worldChoiceQuery(preview)}
            title="World View draft preview"
            readySelector="[data-cms-stories-widget]"
          />
          <p className={recordTableStyles.meta}>
            Saved draft stories · Preview choices are kept in this address. Nothing is published.
          </p>
        </div>
      </div>
      {open && (
        <Dialog
          title="Add World View to a page"
          density="compact"
          onClose={() => {
            if (!pending) setOpen(false)
          }}
          pending={pending}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={loading || pending || !pageId} onClick={() => void add()}>
                {pending ? 'Adding section…' : 'Add as draft'}
              </Button>
            </>
          }
        >
          <div className={workspaceFormsStyles.compactFields}>
            <p>The section will be added at the end of the page as a private draft. Existing content stays in place.</p>
            {error && (
              <Note tone="warning">
                {error}{' '}
                <Button variant="secondary" onClick={() => void load()} disabled={pending || loading}>
                  Reload page choices
                </Button>
              </Note>
            )}
            {loading ? (
              <p role="status">Loading pages…</p>
            ) : (
              <>
                <Field id="world-page-search" label="Search pages">
                  <input id="world-page-search" value={search} onChange={event => setSearch(event.target.value)} />
                </Field>
                <Field id="world-page" label="Page">
                  <select id="world-page" value={pageId} onChange={event => setPageId(event.target.value)}>
                    <option value="">Choose a page</option>
                    {pages
                      .filter(page => (page.title + ' ' + page.slug).toLowerCase().includes(search.toLowerCase()))
                      .map(page => (
                        <option key={page.id} value={page.id}>
                          {page.title} — /{page.slug}
                        </option>
                      ))}
                  </select>
                </Field>
                {!pages.length && <p>No eligible pages are available. Chapter pages do not use Stories.</p>}
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
