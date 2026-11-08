import { storyPhotoInput } from '../../../../../lib/story-photo-input.ts'
import { ImageFocusControl } from '../../../../../components/image-focus-control.tsx'
import { storyVisible } from '@cms/schema'
import { useMemo } from 'react'
import { Card, Disclosure, Field, ResizablePanel, Tabs, ChoiceGroup } from '../../../../../components/ui/index.ts'
import frame from '../../../../../components/content-editor.module.css'
import { Button } from '../../../../../components/ui/button.tsx'
import { storyFeedState, storyDate, type StoryRecord } from '../../../../../lib/stories-model.ts'
import { storyPlacement } from '../../../../../lib/story-placement.ts'
import type { StoryEditInput } from '../../../../../lib/stories-edit.ts'
import styles from '../stories.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
import type { StoryDraftModel } from './use-story-draft.ts'

function storyPlacementValues(entry: StoryRecord, value: StoryEditInput) {
  return {
    ...entry.values,
    ...value,
    tags: value.tags.join(','),
    regions: (value.regions ?? (value.region ? [value.region] : [])).join(','),
  }
}

function StoryLeadPhoto({ model }: { model: StoryDraftModel }) {
  const { entry, rights, value, setPhotoOpen, disabled, change } = model
  return (
    <>
      <Card title="Lead photo" density="editor">
        <div className={frame.fields}>
          {rights.editEntries && (
            <Button
              id="story-photo-picker"
              variant="secondary"
              size="s"
              onClick={() => setPhotoOpen(true)}
              disabled={disabled}
            >
              {value.photo ? 'Change photo' : 'Choose photo'}
            </Button>
          )}
          {value.photo ? (
            <>
              <Field id="story-photo-description" label="Photo description (required)">
                <textarea
                  rows={3}
                  maxLength={1000}
                  required
                  value={value.photo.description}
                  onChange={event => change('photo', { ...value.photo!, description: event.target.value })}
                  disabled={disabled}
                />
              </Field>
              <img
                className={frame.image}
                src={'/media/' + value.photo.id + '/wide'}
                alt={value.photo.description}
                style={{
                  objectPosition: value.photo.focus
                    ? `${value.photo.focus.x * 100}% ${value.photo.focus.y * 100}%`
                    : undefined,
                }}
              />
              <Disclosure title="Adjust focus point">
                <ImageFocusControl
                  src={'/media/' + value.photo.id + '/wide'}
                  value={value.photo.focus}
                  onChange={focus => change('photo', { ...value.photo!, focus })}
                  disabled={disabled}
                />
              </Disclosure>
            </>
          ) : (
            <p className={frame.help}>Choose a photo from Media and describe what matters in this story.</p>
          )}
          {entry.values.photo_is_sample === true && value.photo?.id === storyPhotoInput(entry.values.photo)?.id && (
            <p className={frame.help}>This photo is marked for replacement.</p>
          )}
        </div>
      </Card>
    </>
  )
}

function StoryDetails({ model }: { model: StoryDraftModel }) {
  const { catalog, configured, authorAvailable, entry, value, setValue, setNotice, disabled, change } = model
  const feed = storyFeedState({ ...entry, values: storyPlacementValues(entry, value) })
  return (
    <>
      <Card title="Details" density="editor">
        <div className={frame.fields}>
          <fieldset className={workspaceFormsStyles.formChoices} disabled={disabled}>
            <legend>{catalog.mainLabel}</legend>
            <div className={styles.chips}>
              {catalog.mainTags.map(sector => (
                <button
                  key={sector.id}
                  type="button"
                  className={selectionControlsStyles.tagChip}
                  data-group="main"
                  title={sector.label}
                  aria-pressed={value.tags.includes(sector.id)}
                  onClick={() =>
                    change(
                      'tags',
                      value.tags.includes(sector.id)
                        ? value.tags.filter(id => id !== sector.id)
                        : [...value.tags, sector.id],
                    )
                  }
                >
                  {sector.label}
                </button>
              ))}
            </div>
          </fieldset>
          {configured ? (
            <fieldset className={workspaceFormsStyles.formChoices} disabled={disabled}>
              <legend>{catalog.secondaryLabel}</legend>
              <ChoiceGroup layout="balanced">
                {catalog.secondaryTags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    className={selectionControlsStyles.tagChip}
                    data-group="secondary"
                    title={tag.label}
                    aria-pressed={(value.regions ?? []).includes(tag.id)}
                    onClick={() => {
                      const next = (value.regions ?? []).includes(tag.id)
                        ? (value.regions ?? []).filter(id => id !== tag.id)
                        : [...(value.regions ?? []), tag.id]
                      setValue(current => ({ ...current, regions: next, region: next[0] ?? '' }))
                      setNotice('')
                    }}
                  >
                    {tag.label}
                  </button>
                ))}
              </ChoiceGroup>
            </fieldset>
          ) : (
            <Field id="story-region" label="Region">
              <select value={value.region} onChange={event => change('region', event.target.value)} disabled={disabled}>
                {catalog.secondaryTags.map(region => (
                  <option key={region.id} value={region.id}>
                    {region.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="story-countries" label="Countries">
            <input
              value={value.countries}
              maxLength={300}
              onChange={event => change('countries', event.target.value)}
              disabled={disabled}
            />
          </Field>
          <Field
            id="story-date"
            label="Story date (optional)"
            help={
              <span className={frame.help}>
                {!value.published_date
                  ? 'No publication day chosen. This draft stays out of story feeds.'
                  : feed.active
                    ? 'In story feeds until ' + storyDate(feed.leavesOn) + ' (13 months).'
                    : 'Outside the 13-month feed window. A published article stays available at its own address.'}{' '}
                Saving a date does not schedule publication.
              </span>
            }
          >
            <input
              type="date"
              value={value.published_date}
              onChange={event => change('published_date', event.target.value)}
              disabled={disabled}
            />
          </Field>
          {authorAvailable && (
            <Field id="story-author" label="Author (optional)">
              <input
                value={value.author ?? ''}
                maxLength={120}
                onChange={event => change('author', event.target.value)}
                disabled={disabled}
              />
            </Field>
          )}
        </div>
      </Card>
    </>
  )
}

function StoryPlacements({ model }: { model: StoryDraftModel }) {
  const { catalog, entry, placementContext, newDraft, router, value } = model
  const placementValues = storyPlacementValues(entry, value)
  const placementSignature = JSON.stringify(
    placementContext?.fields.map(field => (placementValues as Record<string, unknown>)[field] ?? null) ?? [],
  )
  const placement = useMemo(
    () => (placementContext ? storyPlacement(placementContext, placementValues, catalog) : null),
    [placementContext, catalog, placementSignature],
  )
  const mainPlaces = placement?.places.filter(place => !place.article) ?? []
  const relatedPlaces = placement?.places.filter(place => place.article) ?? []
  return (
    <>
      <Card title="Where it will show" density="editor">
        {placement ? (
          <>
            <p className={frame.help}>
              {placement.privateSite
                ? 'This site is private. These are the saved draft feeds for its first publication. The publication review decides which drafts go live.'
                : 'These are the places this story will appear after it is published, based on its saved tags and other published stories. Other page drafts are not included.'}
            </p>
            {placement.hasArticle ? (
              <ul aria-label="Story page" className={styles.shows}>
                <li>This story page{!value.published_date ? ' · choose a date and publish first' : ''}</li>
              </ul>
            ) : (
              <p className={frame.help}>
                {newDraft
                  ? 'Saving this draft creates its story page. Publish after review to make it public.'
                  : !storyVisible(placementValues)
                    ? 'This story is kept out of pages and feeds. Check Hide from feeds and the connected source status in Stories.'
                    : "This story's page is not available. Ask a Site admin to check its article before publishing."}
              </p>
            )}
            {mainPlaces.length > 0 && (
              <ul aria-label="Page feeds" className={styles.shows}>
                {mainPlaces.map(place => (
                  <li key={place.id}>
                    <strong>{place.title}</strong>
                    <p className={frame.help}>{place.views.join(' · ')}</p>
                  </li>
                ))}
              </ul>
            )}
            {relatedPlaces.length > 0 && (
              <Disclosure
                title={
                  <>
                    Related stories on {relatedPlaces.length} article {relatedPlaces.length === 1 ? 'page' : 'pages'}
                  </>
                }
              >
                <ul aria-label="Related article feeds" className={styles.shows}>
                  {relatedPlaces.map(place => (
                    <li key={place.id}>
                      {place.title}
                      <p className={frame.help}>{place.views.join(' · ')}</p>
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
            {placement.reason && <p className={frame.help}>{placement.reason}</p>}
            {placement.future && (
              <p className={frame.help}>
                Feed placement is shown from {storyDate(placement.asOf)}, the chosen story day. A future story day keeps
                it out of feeds until then; it does not schedule publication.
              </p>
            )}
            <p className={frame.help}>
              Automatic feeds keep eligible stories for 13 months. Placement can change as other stories publish or
              leave a feed.
            </p>
          </>
        ) : (
          <>
            <p className={frame.help}>
              Feed placements could not be checked. Your story is still here. Try again before publishing.
            </p>
            <Button variant="secondary" size="s" onClick={() => router.refresh()}>
              Try again
            </Button>
          </>
        )}
      </Card>
    </>
  )
}

function StoryAdvancedFields({ model }: { model: StoryDraftModel }) {
  const { entry, value, disabled, change } = model
  return (
    <>
      <Card title="Advanced" density="editor">
        <div className={frame.fields}>
          <Field id="story-html" label="HTML source">
            <textarea
              rows={8}
              value={value.body}
              onChange={event => change('body', event.target.value)}
              disabled={disabled}
            />
          </Field>
          {Boolean(entry.values.old_address) && (
            <div>
              <strong>Original story address</strong>
              <p className={recordTableStyles.truncateValue} title={String(entry.values.old_address)}>
                {String(entry.values.old_address)}
              </p>
            </div>
          )}
        </div>
      </Card>
    </>
  )
}

export function StorySettings({ model }: { model: StoryDraftModel }) {
  const { superAdmin, settingsTab, setSettingsTab } = model
  const contentFields = (
    <div className={frame.rail}>
      <StoryLeadPhoto model={model} />
      <StoryDetails model={model} />
      <StoryPlacements model={model} />
    </div>
  )
  return (
    <>
      <ResizablePanel
        storageKey="cms.story-editor.panel-width"
        label="Story settings"
        min={340}
        max={480}
        initial={340}
        className={frame.rail}
      >
        {superAdmin ? (
          <Tabs
            label="Story settings"
            value={settingsTab}
            tabs={[
              { value: 'content', label: 'Content' },
              { value: 'advanced', label: 'Advanced' },
            ]}
            onChange={setSettingsTab}
          >
            {settingsTab === 'advanced' ? <StoryAdvancedFields model={model} /> : contentFields}
          </Tabs>
        ) : (
          contentFields
        )}
      </ResizablePanel>
    </>
  )
}
