'use client'
import {
  STORY_DRAFT_GROUPS,
  recoverStoryDraft,
  chooseStoryDraft,
  type StoryDraftGroup,
} from '../../../../../lib/story-draft-recovery.ts'
import { storyPhotoInput } from '../../../../../lib/story-photo-input.ts'
import { MediaPicker } from '../../../../pages/[pageId]/media-picker.tsx'
import { ImageFocusControl } from '../../../../../components/image-focus-control.tsx'
import { storyVisible, storyTagIds, type StoriesSettings } from '@cms/schema'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ContentEditor } from '../../../../../components/content-editor.tsx'
import {
  Card,
  Dialog,
  Disclosure,
  Field,
  ResizablePanel,
  Tabs,
  StatusPill,
  ChoiceGroup,
} from '../../../../../components/ui/index.ts'
import type { StatusLabel } from '../../../../../components/ui/status-pill.tsx'
import frame from '../../../../../components/content-editor.module.css'
import { Button } from '../../../../../components/ui/button.tsx'
import { useNavigationGuard } from '../../../../../components/navigation-guard.ts'
import { RichTextField } from '../../../../pages/[pageId]/rich-text-field.tsx'
import { storyTags, storyFeedState, storyDate, type StoryRecord } from '../../../../../lib/stories-model.ts'
import { storyPlacement, type StoryPlacementContext } from '../../../../../lib/story-placement.ts'
import type { StoryEditInput } from '../../../../../lib/stories-edit.ts'
import type { CollectionRights } from '../../../../../lib/collection-queries.ts'
import type { StoryReviewPreparation } from '../../../../../lib/story-review.ts'
import {
  addStory,
  saveStory,
  prepareStoryPublication,
  prepareStorySubmission,
  sendStorySubmission,
} from '../actions.ts'
import styles from '../stories.module.css'
import workspaceFormsStyles from '../../../../../components/workspace-styles/workspace-forms.module.css'
import recordTableStyles from '../../../../../components/workspace-styles/record-table.module.css'
import selectionControlsStyles from '../../../../../components/workspace-styles/selection-controls.module.css'
function input(
  values: Record<string, unknown>,
  catalog: StoriesSettings,
  configured: boolean,
  authorAvailable = false,
): StoryEditInput {
  return {
    ...(authorAvailable ? { author: String(values.author ?? '') } : {}),
    title: String(values.title ?? ''),
    summary: String(values.summary ?? ''),
    tags: storyTags(values, catalog),
    ...(configured ? { regions: storyTagIds(values, 'secondary') } : {}),
    region: String(values.region ?? ''),
    published_date: String(values.published_date ?? ''),
    countries: String(values.countries ?? ''),
    body: String(values.body ?? ''),
    body_is_sample: values.body_is_sample === true,
    ...(storyPhotoInput(values.photo) ? { photo: storyPhotoInput(values.photo) } : {}),
  }
}
export function StoryEditor({
  catalog,
  configured,
  authorAvailable = false,
  superAdmin,
  site,
  collectionId,
  initialRevision,
  entry,
  placementContext,
  rights,
  page,
  newDraft,
  initialIntent,
  publicationStatus = 'Draft',
}: {
  publicationStatus?: StatusLabel
  newDraft?: { requestId: string }
  initialIntent?: 'preview' | 'publish' | 'schedule' | 'review'
  catalog: StoriesSettings
  configured: boolean
  authorAvailable?: boolean
  superAdmin: boolean
  site: { id: string; name: string }
  collectionId: string
  initialRevision: string
  entry: StoryRecord & { id: string }
  placementContext: StoryPlacementContext | null
  rights: CollectionRights
  page: { id: string; versionId: string } | null
}) {
  const router = useRouter(),
    [value, setValue] = useState(() => input(entry.values, catalog, configured, authorAvailable)),
    [baseline, setBaseline] = useState(() => JSON.stringify(input(entry.values, catalog, configured, authorAvailable))),
    [revision, setRevision] = useState(initialRevision),
    [pending, start] = useTransition(),
    creationRequest = useRef(newDraft?.requestId),
    [uncertain, setUncertain] = useState(false),
    creationKind = useRef<'save' | 'publish' | 'schedule' | 'preview' | 'leave' | 'review'>('save'),
    intentStarted = useRef(false),
    [notice, setNotice] = useState(''),
    [firstSiteReview, setFirstSiteReview] = useState(false),
    [photoOpen, setPhotoOpen] = useState(false),
    [previewOpen, setPreviewOpen] = useState(false),
    [previewLoaded, setPreviewLoaded] = useState(false),
    [leaveOpen, setLeaveOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState('content'),
    [error, setError] = useState(false),
    [refresh, setRefresh] = useState(0),
    [width, setWidth] = useState(600),
    area = useRef<HTMLDivElement>(null),
    inFlight = useRef(false),
    reviewRequest = useRef<{ signature: string; kind: string; id: string } | null>(null)
  const [submission, setSubmission] = useState<StoryReviewPreparation | null>(null),
    [submissionOpen, setSubmissionOpen] = useState(false),
    [submissionNote, setSubmissionNote] = useState('')
  const leaveDestination = useRef<(() => void) | null>(null)
  const finishLeave = () => {
    const proceed = leaveDestination.current
    leaveDestination.current = null
    setLeaveOpen(false)
    if (proceed) proceed()
    else router.push('/sites/' + site.id + '/stories')
  }
  const cancelLeave = () => {
    leaveDestination.current = null
    setLeaveOpen(false)
  }
  const seenServerRevision = useRef(initialRevision),
    [recovery, setRecovery] = useState<
      ({ saved: StoryEditInput; revision: string } & ReturnType<typeof recoverStoryDraft>) | null
    >(null),
    [recoveryOpen, setRecoveryOpen] = useState(false),
    [choices, setChoices] = useState<Partial<Record<StoryDraftGroup, 'mine' | 'saved'>>>({})
  const dirty = JSON.stringify(value) !== baseline,
    disabled = !rights.editEntries || pending || uncertain || Boolean(recovery),
    preview = page ? '/preview/' + page.versionId + '?visit=1&site=draft&lists=draft&v=' + refresh : ''
  useNavigationGuard(() => ({
    dirty,
    pending: pending || inFlight.current,
    requestLeave: proceed => {
      if (!leaveOpen) {
        leaveDestination.current = proceed
        setLeaveOpen(true)
      }
    },
  }))
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty || pending) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [dirty, pending])
  useEffect(() => {
    if (!area.current) return
    const observer = new ResizeObserver(records => setWidth(records[0]?.contentRect.width ?? 600))
    observer.observe(area.current)
    return () => observer.disconnect()
  }, [previewOpen])

  useEffect(() => {
    if (newDraft || pending || inFlight.current || initialRevision === seenServerRevision.current) return
    seenServerRevision.current = initialRevision
    const saved = input(entry.values, catalog, configured, authorAvailable)
    if (!dirty) {
      setValue(saved)
      setBaseline(JSON.stringify(saved))
      setRevision(initialRevision)
      setRecovery(null)
      if (initialRevision !== revision) setNotice('The latest saved story is loaded.')
      return
    }
    const next = recoverStoryDraft(JSON.parse(baseline), value, saved)
    setRecovery({ ...next, saved, revision: initialRevision })
    setChoices({})
    setRecoveryOpen(true)
    setError(true)
    setNotice('Saved Stories changed. Your words are still here. Review the saved changes before saving again.')
  }, [initialRevision, revision, pending, newDraft, entry.values, catalog, configured, baseline, dirty, value])
  const acceptRecovery = () => {
    if (!recovery) return
    const merged = chooseStoryDraft(recovery, recovery.saved, choices)
    if (!merged) return
    setValue(merged)
    setBaseline(JSON.stringify(recovery.saved))
    setRevision(recovery.revision)
    setRecovery(null)
    setRecoveryOpen(false)
    setError(false)
    setNotice('Your selected changes are ready. Save draft to keep them; nothing has been published.')
  }
  const describeGroup = (draft: StoryEditInput, id: StoryDraftGroup) => {
    const group = STORY_DRAFT_GROUPS.find(group => group.id === id)!
    return (
      group.fields
        .map(field => {
          const item = draft[field]
          if (field === 'body_is_sample') return item ? 'Marked as sample content' : ''
          if (field === 'photo') return draft.photo ? draft.photo.description : 'No photo'
          if (Array.isArray(item))
            return item
              .map(id => [...catalog.mainTags, ...catalog.secondaryTags].find(tag => tag.id === id)?.label ?? id)
              .join(', ')
          return field === 'body'
            ? (new DOMParser().parseFromString(String(item ?? ''), 'text/html').body.textContent ?? '')
            : String(item ?? '')
        })
        .filter(Boolean)
        .join(' · ') || 'Empty'
    )
  }
  const change = <K extends keyof StoryEditInput>(key: K, next: StoryEditInput[K]) => {
    setValue(current => ({ ...current, [key]: next }))
    setNotice('')
  }
  const placementValues = {
      ...entry.values,
      ...value,
      tags: value.tags.join(','),
      regions: (value.regions ?? (value.region ? [value.region] : [])).join(','),
    },
    current = { ...entry, values: placementValues },
    feed = storyFeedState(current),
    placementSignature = JSON.stringify(
      placementContext?.fields.map(field => (placementValues as Record<string, unknown>)[field] ?? null) ?? [],
    )
  const placement = useMemo(
    () => (placementContext ? storyPlacement(placementContext, placementValues, catalog) : null),
    [placementContext, catalog, placementSignature],
  )
  const mainPlaces = placement?.places.filter(place => !place.article) ?? [],
    relatedPlaces = placement?.places.filter(place => place.article) ?? []
  const save = (kind: 'save' | 'publish' | 'schedule' | 'preview' | 'leave' | 'review' = 'save') => {
    if (inFlight.current) return
    if (recovery) {
      setRecoveryOpen(true)
      return
    }
    if ((kind === 'publish' || kind === 'schedule') && !value.published_date) {
      setError(true)
      setNotice('Choose a story date before publishing or scheduling. Saving the date keeps this story private.')
      const field = document.getElementById('story-date')
      field?.focus()
      field?.scrollIntoView({ block: 'center' })
      return
    }
    if (newDraft && !uncertain) {
      const missing = !value.title.trim()
        ? ['story-title', 'Add a title.']
        : !value.summary.trim()
          ? ['story-summary', 'Add a summary.']
          : !value.photo?.id
            ? ['story-photo-picker', 'Choose a lead photo and describe it.']
            : !value.photo.description.trim()
              ? ['story-photo-description', 'Describe the lead photo.']
              : null
      if (missing) {
        setError(true)
        setNotice(missing[1]!)
        document.getElementById(missing[0]!)?.focus()
        return
      }
    }
    inFlight.current = true
    creationKind.current = kind
    setFirstSiteReview(false)
    setError(false)
    setNotice(
      kind === 'save' || kind === 'preview' || kind === 'leave'
        ? 'Saving story draft…'
        : 'Saving draft and preparing its review. This can take up to a minute…',
    )
    start(async () => {
      try {
        if (newDraft) {
          const result = await addStory(
            site.id,
            collectionId,
            revision,
            {
              title: value.title,
              summary: value.summary,
              ...(value.author !== undefined ? { author: value.author } : {}),
              tags: value.tags,
              regions: value.regions,
              region: value.region,
              published_date: value.published_date,
              countries: value.countries,
              body: value.body,
              photoId: value.photo?.id ?? '',
              photoAlt: value.photo?.description ?? '',
              photoFocus: value.photo?.focus,
            },
            creationRequest.current!,
          )
          if (!result.ok) {
            setUncertain(false)
            setError(true)
            setNotice(result.message)
            return
          }
          setBaseline(JSON.stringify(value))
          setUncertain(false)
          if (kind === 'leave') {
            finishLeave()
            return
          }
          router.push('/sites/' + site.id + '/stories/' + result.entryId + (kind === 'save' ? '' : '?intent=' + kind))
          return
        }
        let saved = value
        if (dirty) {
          const result = await saveStory(site.id, collectionId, entry.id, revision, value)
          if (!result.ok) {
            setError(true)
            setNotice(result.message)
            if (result.conflict) router.refresh()
            return
          }
          saved = input(result.values, catalog, configured, authorAvailable)
          setValue(saved)
          setBaseline(JSON.stringify(saved))
          setRevision(result.revision)
          setRefresh(n => n + 1)
        }
        if (kind === 'save' || kind === 'preview' || kind === 'leave') {
          setNotice(
            rights.publish
              ? 'Story draft saved. Publish to update the site.'
              : 'Story draft saved. Nothing is published.',
          )
          if (kind === 'preview') {
            setPreviewLoaded(false)
            setPreviewOpen(true)
            setRefresh(n => n + 1)
          }
          if (kind === 'leave') {
            finishLeave()
          } else router.refresh()
          return
        }
        if (kind === 'review') {
          const result = await prepareStorySubmission(site.id, collectionId, entry.id)
          if (!result.ok) {
            setError(true)
            setNotice(result.message)
            return
          }
          setSubmission(result.prepared)
          setSubmissionOpen(true)
          setNotice('')
          return
        }
        setNotice('Checking this story and its feed pages. Nothing is published yet…')
        const signature = JSON.stringify(saved)
        if (reviewRequest.current?.signature !== signature || reviewRequest.current.kind !== kind)
          reviewRequest.current = { signature, kind, id: crypto.randomUUID() }
        const result = await prepareStoryPublication(site.id, entry.id, reviewRequest.current.id)
        if (!result.ok) {
          setFirstSiteReview('firstSiteReview' in result && result.firstSiteReview === true)
          setError(true)
          setNotice(result.message)
          return
        }
        router.push(
          '/sites/' +
            site.id +
            '/publishing?release=' +
            result.releaseId +
            (kind === 'schedule' ? '&intent=schedule' : ''),
        )
      } catch {
        setError(true)
        if (newDraft) {
          setUncertain(true)
          setNotice(
            'The draft result could not be confirmed. Your words are here. Retry draft save to check the saved result before making more changes.',
          )
        } else
          setNotice(
            'The result could not be confirmed. Your words are still here. Check the saved story or History before retrying.',
          )
      } finally {
        inFlight.current = false
      }
    })
  }

  useEffect(() => {
    if (initialIntent && !intentStarted.current) {
      intentStarted.current = true
      window.history.replaceState(window.history.state, '', window.location.pathname)
      save(initialIntent)
    }
  }, [initialIntent])
  const back = () => {
    if (pending || inFlight.current) return
    if (dirty) {
      leaveDestination.current = null
      setLeaveOpen(true)
    } else router.push('/sites/' + site.id + '/stories')
  }
  const summaryLength = String(JSON.parse(baseline).summary ?? '').length
  const contentFields = (
    <div className={frame.rail}>
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
    </div>
  )
  const advancedFields = (
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
  )
  return (
    <>
      <ContentEditor
        locationLabel={site.name + ' / Stories'}
        title={value.title || (newDraft ? 'New story' : 'Untitled story')}
        status={pending ? 'Saving…' : dirty ? 'Unsaved changes' : newDraft ? 'Not saved yet' : 'All changes saved'}
        pending={pending}
        onBack={back}
        actions={
          <>
            <StatusPill compact status={publicationStatus} />
            <Button variant="secondary" size="standard" disabled={pending || uncertain} onClick={() => save('preview')}>
              Preview
            </Button>
            {rights.editEntries && (
              <Button variant="secondary" size="standard" onClick={() => save()} disabled={disabled}>
                Save draft
              </Button>
            )}
            {rights.editEntries && !rights.publish && (
              <Button size="standard" disabled={disabled} onClick={() => save('review')}>
                Submit for review
              </Button>
            )}
            {rights.publish && (
              <>
                <Button variant="secondary" size="standard" disabled={disabled} onClick={() => save('schedule')}>
                  Schedule
                </Button>
                <Button variant="publish" size="standard" disabled={disabled} onClick={() => save('publish')}>
                  Publish
                </Button>
              </>
            )}
          </>
        }
        notice={
          notice || firstSiteReview ? (
            <>
              {notice && (
                <p role={error ? 'alert' : 'status'} className={styles.status + (error ? ' ' + styles.error : '')}>
                  {notice}
                </p>
              )}
              {!newDraft && error && !recovery && (
                <Button variant="secondary" disabled={pending} onClick={() => router.refresh()}>
                  Check saved story
                </Button>
              )}
              {recovery && (
                <Button variant="secondary" disabled={pending} onClick={() => setRecoveryOpen(true)}>
                  Review saved changes
                </Button>
              )}
              {uncertain && (
                <Button variant="secondary" loading={pending} onClick={() => save(creationKind.current)}>
                  Retry draft save
                </Button>
              )}
              {firstSiteReview && (
                <Button variant="secondary" onClick={() => router.push('/sites/' + site.id + '/publishing?lists=1')}>
                  Review first site publication
                </Button>
              )}
            </>
          ) : undefined
        }
        aside={
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
                {settingsTab === 'advanced' ? advancedFields : contentFields}
              </Tabs>
            ) : (
              contentFields
            )}
          </ResizablePanel>
        }
      >
        <Card density="editor">
          <div className={frame.fields}>
            <Field id="story-title" label="Title">
              <input
                value={value.title}
                maxLength={180}
                onChange={event => change('title', event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Field
              id="story-summary"
              label={
                <>
                  Summary <span className={frame.help}>(used on cards and in search, up to 155 characters)</span>
                </>
              }
              counter={value.summary.length + ' / 155'}
              help={
                summaryLength > 155 ? (
                  <span className={frame.help}>
                    The existing summary has {summaryLength} characters. Keep it unchanged, or shorten it to 155 when
                    editing.
                  </span>
                ) : undefined
              }
            >
              <textarea
                aria-label="Summary"
                value={value.summary}
                maxLength={Math.max(155, summaryLength)}
                rows={3}
                onChange={event => change('summary', event.target.value)}
                disabled={disabled}
              />
            </Field>
          </div>
        </Card>
        <Card title={<span id="story-text-label">Story text</span>} density="editor" className={frame.text}>
          <RichTextField
            id="story-body"
            labelId="story-text-label"
            value={value.body}
            onChange={next => change('body', next)}
            disabled={disabled}
            sourceMode={false}
          />
          {(value.body_is_sample || entry.values.body_is_sample === true) && (
            <label className={selectionControlsStyles.checkRow}>
              <input
                type="checkbox"
                checked={value.body_is_sample}
                onChange={event => change('body_is_sample', event.target.checked)}
                disabled={disabled}
              />
              This body is sample content
            </label>
          )}
        </Card>
      </ContentEditor>
      {submissionOpen && submission && (
        <Dialog
          title="Send story for review"
          size="large"
          pending={pending}
          onClose={() => {
            if (!pending) setSubmissionOpen(false)
          }}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setSubmissionOpen(false)}>
                Cancel
              </Button>
              <Button
                loading={pending}
                onClick={() => {
                  if (inFlight.current) return
                  inFlight.current = true
                  setError(false)
                  setNotice('Sending this saved story for review…')
                  start(async () => {
                    try {
                      const result = await sendStorySubmission(
                        site.id,
                        collectionId,
                        entry.id,
                        submission,
                        submissionNote,
                      )
                      if (!result.ok) {
                        setError(true)
                        setNotice(result.message)
                        return
                      }
                      setSubmissionOpen(false)
                      router.push('/inbox?review=' + result.submissionId)
                    } catch {
                      setError(true)
                      setNotice('The review result could not be confirmed. Retry to check the same request.')
                    } finally {
                      inFlight.current = false
                    }
                  })
                }}
              >
                Submit for review
              </Button>
            </>
          }
        >
          <p>{submission.presentation.summary}</p>
          <p>This sends only this saved story and its article to a reviewer. Nothing is published.</p>
          {!submission.hasDate && (
            <p>A story date is required before publication. You can return to the story to choose one.</p>
          )}
          <Disclosure title="What changed">
            <dl>
              {submission.presentation.cells.map((cell, index) => (
                <div key={index}>
                  <dt>{cell.label}</dt>
                  <dd>{cell.after}</dd>
                </div>
              ))}
            </dl>
          </Disclosure>
          <Field id="story-review-note" label="Note for the reviewer (optional)">
            <textarea
              maxLength={4096}
              rows={3}
              value={submissionNote}
              disabled={pending}
              onChange={event => setSubmissionNote(event.target.value)}
            />
          </Field>
          {notice && <p role={error ? 'alert' : 'status'}>{notice}</p>}
        </Dialog>
      )}
      {previewOpen && (
        <Dialog
          title="Saved story preview"
          size="large"
          onClose={() => setPreviewOpen(false)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPreviewLoaded(false)
                  setRefresh(n => n + 1)
                }}
              >
                Refresh preview
              </Button>
              <Button onClick={() => setPreviewOpen(false)}>Done</Button>
            </>
          }
        >
          <p className={frame.help}>This private preview uses saved story and site drafts. Nothing is published.</p>
          {!previewLoaded && preview && <p role="status">Loading saved preview…</p>}
          <div
            className={styles.preview + ' ' + styles.previewArea}
            ref={area}
            style={{ height: 'var(--stories-preview-height)' }}
          >
            {preview ? (
              <iframe
                title="Saved story preview"
                src={preview}
                onLoad={() => setPreviewLoaded(true)}
                tabIndex={-1}
                style={{ width: 1440, height: 560 / (width / 1440), transform: 'scale(' + width / 1440 + ')' }}
              />
            ) : (
              <p role="status">The saved article preview is unavailable. Return to Stories and reopen this story.</p>
            )}
          </div>
        </Dialog>
      )}
      {leaveOpen && (
        <Dialog
          title="Before you leave"
          role="alertdialog"
          onClose={() => {
            if (!pending) cancelLeave()
          }}
          pending={pending}
          footer={
            <>
              <Button variant="secondary" onClick={cancelLeave} disabled={pending}>
                Keep editing
              </Button>
              <Button variant="secondary" disabled={pending} onClick={finishLeave}>
                Discard changes
              </Button>
              <Button loading={pending} disabled={uncertain} onClick={() => save('leave')}>
                Save draft and leave
              </Button>
            </>
          }
        >
          <p>This story has unsaved changes. Save a draft before leaving, or discard the changes.</p>
          {error && notice && <p role="alert">{notice}</p>}
        </Dialog>
      )}
      {recoveryOpen && recovery && (
        <Dialog
          title="Review saved story changes"
          onClose={() => setRecoveryOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRecoveryOpen(false)}>
                Cancel
              </Button>
              <Button disabled={recovery.conflicts.some(id => !choices[id])} onClick={acceptRecovery}>
                Keep selected changes
              </Button>
            </>
          }
        >
          <p>
            Your unsaved words are kept. Changes to different fields are combined. Nothing is saved or published until
            you choose Save draft.
          </p>
          {recovery.conflicts.length === 0 ? (
            <p>The saved changes affect different fields. You can keep both sets of changes.</p>
          ) : (
            recovery.conflicts.map(id => (
              <fieldset key={id} className={workspaceFormsStyles.formChoices}>
                <legend>{STORY_DRAFT_GROUPS.find(group => group.id === id)!.label}: both versions changed</legend>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={'recover-' + id}
                    checked={choices[id] === 'mine'}
                    onChange={() => setChoices(current => ({ ...current, [id]: 'mine' }))}
                  />
                  Keep my {STORY_DRAFT_GROUPS.find(group => group.id === id)!.label.toLowerCase()}
                </label>
                <Disclosure title="My changes">
                  <p className={frame.help}>{describeGroup(value, id)}</p>
                  {id === 'photo' && value.photo && (
                    <img
                      className={frame.image}
                      src={'/media/' + value.photo.id + '/wide'}
                      alt={value.photo.description}
                    />
                  )}
                </Disclosure>
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={'recover-' + id}
                    checked={choices[id] === 'saved'}
                    onChange={() => setChoices(current => ({ ...current, [id]: 'saved' }))}
                  />
                  Use saved {STORY_DRAFT_GROUPS.find(group => group.id === id)!.label.toLowerCase()}
                </label>
                <Disclosure title="Saved changes">
                  <p className={frame.help}>{describeGroup(recovery.saved, id)}</p>
                  {id === 'photo' && recovery.saved.photo && (
                    <img
                      className={frame.image}
                      src={'/media/' + recovery.saved.photo.id + '/wide'}
                      alt={recovery.saved.photo.description}
                    />
                  )}
                </Disclosure>
              </fieldset>
            ))
          )}
        </Dialog>
      )}
      {photoOpen && (
        <MediaPicker
          requireDescription
          siteId={site.id}
          initialAssets={[]}
          currentValue={
            value.photo
              ? {
                  media_id: value.photo.id,
                  src: '/media/' + value.photo.id + '/wide',
                  alt: value.photo.description,
                  decorative: false,
                  focal: value.photo.focus,
                }
              : undefined
          }
          onClose={() => setPhotoOpen(false)}
          onChoose={photo => {
            if (photo.media_id)
              change('photo', { id: photo.media_id, description: photo.alt, focus: photo.focal ?? null })
            setPhotoOpen(false)
          }}
        />
      )}
    </>
  )
}
