'use client'
import { useEffect, useState } from 'react'
import type { StoryTagFilter } from '@cms/schema'
import { Button } from '../../../components/ui/index.ts'
import { GuardedLink as Link } from '../../../components/guarded-link.tsx'
import shared from '../../../components/workspace.module.css'
import workspaceFormsStyles from '../../../components/workspace-styles/workspace-forms.module.css'
import chips from '../../../components/story-list-row.module.css'
import type { CollectionBindingOption, StoryFeedTags } from '../../../lib/collection-binding.ts'
import { storyFeedBinding, storyFeedChoice, storyFeedMaximum } from '../../../lib/story-feed-choice.ts'
function useStoryFeedTags(siteId: string, definitionId: string, definitionVersion: number, fieldId: string) {
  const [catalog, setCatalog] = useState<StoryFeedTags | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setCatalog(null)
    const params = new URLSearchParams({ definition: definitionId, version: String(definitionVersion), field: fieldId })
    void fetch('/api/sites/' + encodeURIComponent(siteId) + '/collection-options?' + params, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw Error('Story choices could not be loaded. Your saved choices are unchanged.')
        const data = (await response.json()) as { options: CollectionBindingOption[] }
        if (!controller.signal.aborted)
          setCatalog(data.options.find(option => option.readerKey === 'stories')?.storyTags ?? null)
      })
      .catch(error => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError)
              ? error.message
              : 'Story choices could not be loaded. Your saved choices are unchanged.',
          )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [siteId, definitionId, definitionVersion, fieldId, reload])
  return { catalog, error, loading, retry: () => setReload(n => n + 1) }
}
export function StoryStartViewField({
  id,
  value,
  onChange,
  siteId,
  definitionId,
  definitionVersion,
  fieldId,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  siteId: string
  definitionId: string
  definitionVersion: number
  fieldId: string
}) {
  const { catalog, error, loading, retry } = useStoryFeedTags(siteId, definitionId, definitionVersion, fieldId)
  if (loading) return <p role="status">Loading story views…</p>
  if (error)
    return (
      <div className={shared.denseStack}>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  return (
    <select id={id} value={String(value ?? 'recent')} onChange={event => onChange(event.target.value)}>
      <option value="recent">Recently Published</option>
      <option value="sectors">
        {catalog?.mainLabel === 'Project Sectors' ? 'By Project Sector' : 'By ' + (catalog?.mainLabel ?? 'main tag')}
      </option>
      <option value="map">By Map</option>
    </select>
  )
}
export function StoryStartRegionField({
  id,
  value,
  onChange,
  siteId,
  definitionId,
  definitionVersion,
  fieldId,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  siteId: string
  definitionId: string
  definitionVersion: number
  fieldId: string
}) {
  const { catalog, error, loading, retry } = useStoryFeedTags(siteId, definitionId, definitionVersion, fieldId)
  const selected = String(value ?? '')
  if (loading) return <p role="status">Loading regions…</p>
  if (error)
    return (
      <div className={shared.denseStack}>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  if (!catalog) return <p>Ask a Site admin to turn on Stories and add regions.</p>
  return (
    <select id={id} value={selected} onChange={event => onChange(event.target.value)}>
      <option value="">None, ask visitors to pick</option>
      {selected && !catalog.secondaryTags.some(tag => tag.id === selected) && (
        <option value={selected}>Region no longer available — choose another</option>
      )}
      {catalog.secondaryTags.map(tag => (
        <option key={tag.id} value={tag.id}>
          {tag.label}
        </option>
      ))}
    </select>
  )
}
export function StoryPerRegionField({
  id,
  value,
  onChange,
  siteId,
  definitionId,
  definitionVersion,
  fieldId,
  path,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  siteId: string
  definitionId: string
  definitionVersion: number
  fieldId: string
  path: string
}) {
  const { catalog, error, loading, retry } = useStoryFeedTags(siteId, definitionId, definitionVersion, fieldId)
  const maximum = catalog ? storyFeedMaximum(catalog, path) : 200
  const selected = String(value ?? '200')
  const choices = [200, 3, 6, 9, 12, 24].filter(n => n === 200 || n <= maximum)
  if (loading) return <p role="status">Loading story limits…</p>
  if (error)
    return (
      <div className={shared.denseStack}>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  return (
    <>
      <select id={id} value={selected} onChange={event => onChange(event.target.value)}>
        {!choices.some(n => String(n) === selected) && (
          <option value={selected}>{selected} — choose a current limit</option>
        )}
        {choices.map(n => (
          <option key={n} value={n}>
            {n === 200 ? (maximum === 6 ? 'All (up to 6)' : 'All') : n}
          </option>
        ))}
      </select>
      {maximum === 6 && <p className="hint">SAWSO sector pages show up to 6 stories per region.</p>}
    </>
  )
}
export function StoriesFeedField({
  id,
  value,
  onChange,
  siteId,
  definitionId,
  definitionVersion,
  fieldId,
  path,
  world = false,
  split = false,
}: {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  siteId: string
  definitionId: string
  definitionVersion: number
  fieldId: string
  path: string
  world?: boolean
  split?: boolean
}) {
  const { catalog, error, loading, retry } = useStoryFeedTags(siteId, definitionId, definitionVersion, fieldId)
  const choice = storyFeedChoice(value)
  const maximum = world || split ? 200 : catalog ? storyFeedMaximum(catalog, path) : 200
  const limit = world || split ? 200 : (choice.selection?.limit ?? 6)
  function change(tags: StoryTagFilter, count = limit) {
    onChange(storyFeedBinding(value, tags, Math.min(count, maximum)))
  }
  if (loading) return <p role="status">Loading story choices…</p>
  if (error)
    return (
      <div className={shared.denseStack}>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      </div>
    )
  if (!catalog)
    return (
      <p role="status">
        Stories are not set up for this site. Ask a Site admin to turn them on in Settings. Your saved choices are
        unchanged.
      </p>
    )
  if (split)
    return (
      <div id={id}>
        <p>
          Uses this site’s current stories and tags. Hidden and older stories stay out of feeds; unreviewed stories
          follow the site setting.
        </p>
        <Link href={'/sites/' + siteId + '/stories'} target="_blank" rel="noopener">
          Open Stories in a new tab
        </Link>
      </div>
    )
  return (
    <div id={id} className="subfields">
      <p>
        {world
          ? 'Counts matching stories across regions. Choose main tags, or leave the group empty to allow any.'
          : 'Shows the newest matching stories. Choose any tag in each group; leave a group empty to allow any.'}
      </p>
      {(world ? (['main'] as const) : (['main', 'secondary'] as const)).map(group => {
        const tags = group === 'main' ? catalog.mainTags : catalog.secondaryTags
        const label = group === 'main' ? catalog.mainLabel : catalog.secondaryLabel
        const missing = choice.tags[group].filter(id => !tags.some(tag => tag.id === id))
        return (
          <div key={group} role="group" aria-label={label} className={shared.denseStack}>
            <strong>{label}</strong>
            <div className={workspaceFormsStyles.actions}>
              {tags.map(tag => (
                <button
                  type="button"
                  key={tag.id}
                  className={chips.chip}
                  data-group={group}
                  aria-pressed={choice.tags[group].includes(tag.id)}
                  onClick={() =>
                    change({
                      ...choice.tags,
                      [group]: choice.tags[group].includes(tag.id)
                        ? choice.tags[group].filter(id => id !== tag.id)
                        : choice.tags[group].length < 100
                          ? [...choice.tags[group], tag.id]
                          : choice.tags[group],
                    })
                  }
                >
                  {tag.label}
                </button>
              ))}
              {missing.map(tag => (
                <button
                  type="button"
                  key={tag}
                  className={chips.chip}
                  data-group={group}
                  aria-pressed="true"
                  onClick={() => change({ ...choice.tags, [group]: choice.tags[group].filter(id => id !== tag) })}
                >
                  Remove unavailable tag
                </button>
              ))}
            </div>
            {choice.tags[group].length >= 100 && (
              <p className="hint">100 tags selected. Remove a tag before choosing another.</p>
            )}
            {!tags.length && <p className="hint">No tags in this group yet. An empty group allows any story.</p>}
          </div>
        )
      })}
      {choice.keepEarlierFilter && (
        <p className="hint">
          An earlier matching rule also applies: {choice.selection?.filter?.value}. Your choices keep it.
        </p>
      )}
      {world && choice.tags.secondary.length > 0 && (
        <p>
          This section has an earlier region limit.{' '}
          <Button variant="secondary" onClick={() => change({ ...choice.tags, secondary: [] })}>
            Clear region limits
          </Button>
        </p>
      )}
      {!world && (
        <>
          <label htmlFor={id + '-limit'}>Maximum stories</label>
          <select id={id + '-limit'} value={limit} onChange={event => change(choice.tags, Number(event.target.value))}>
            {limit > maximum && (
              <option value={limit}>
                {limit} — choose {maximum} or fewer
              </option>
            )}
            {Array.from({ length: maximum }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </>
      )}
      <p className="hint">
        {!world && maximum === 6 ? 'SAWSO sector pages show up to 6 stories. ' : ''}Feeds keep stories for 13 months.
        Cards fit the number of stories and stay available on phones.
      </p>
      <Link href={'/sites/' + siteId + '/stories'} target="_blank" rel="noopener">
        Open Stories in a new tab
      </Link>
    </div>
  )
}
