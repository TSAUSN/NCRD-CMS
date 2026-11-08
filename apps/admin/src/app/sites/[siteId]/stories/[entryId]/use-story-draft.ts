import type { StoriesSettings } from '@cms/schema'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { openGuardedDocument } from '../../../../../components/document-link.tsx'
import type { StatusLabel } from '../../../../../components/ui/status-pill.tsx'
import type { StoryRecord } from '../../../../../lib/stories-model.ts'
import type { StoryPlacementContext } from '../../../../../lib/story-placement.ts'
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
import { missingNewStoryField, newStoryInput, storyDraftInput } from './story-draft-input.ts'
import { useStoryRecovery } from './use-story-recovery.ts'
import { useStoryExit } from './use-story-exit.ts'

type StorySaveIntent = 'save' | 'publish' | 'schedule' | 'preview' | 'leave' | 'review'

export type StoryEditorProps = {
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
}

export function useStoryDraft({
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
}: StoryEditorProps) {
  const router = useRouter()
  const [value, setValue] = useState(() => storyDraftInput(entry.values, catalog, configured, authorAvailable))
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(storyDraftInput(entry.values, catalog, configured, authorAvailable)),
  )
  const [revision, setRevision] = useState(initialRevision)
  const [pending, start] = useTransition()
  const creationRequest = useRef(newDraft?.requestId)
  const [uncertain, setUncertain] = useState(false)
  const [savedEditor, setSavedEditor] = useState<string>()
  const creationKind = useRef<StorySaveIntent>('save')
  const intentStarted = useRef(false)
  const [notice, setNotice] = useState('')
  const [firstSiteReview, setFirstSiteReview] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [settingsTab, setSettingsTab] = useState('content')
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const inFlight = useRef(false)
  const reviewRequest = useRef<{ signature: string; kind: string; id: string } | null>(null)
  const [submission, setSubmission] = useState<StoryReviewPreparation | null>(null)
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [submissionNote, setSubmissionNote] = useState('')
  const dirty = JSON.stringify(value) !== baseline
  const preview = page ? '/preview/' + page.versionId + '?visit=1&site=draft&lists=draft&v=' + refresh : ''
  const { leaveOpen, finishLeave, cancelLeave, back } = useStoryExit({
    storiesPath: '/sites/' + site.id + '/stories',
    dirty,
    pending,
    inFlight,
  })
  const { recovery, recoveryOpen, setRecoveryOpen, choices, setChoices, acceptRecovery } = useStoryRecovery({
    authorAvailable,
    baseline,
    catalog,
    configured,
    dirty,
    entry,
    inFlight,
    initialRevision,
    newDraft,
    pending,
    revision,
    setBaseline,
    setError,
    setNotice,
    setRevision,
    setValue,
    value,
  })
  // Wait for the save and leave guard to settle before opening the editor document.
  useEffect(() => {
    if (savedEditor && !pending && !dirty) openGuardedDocument(savedEditor, { replace: true })
  }, [savedEditor, pending, dirty])

  const disabled = !rights.editEntries || pending || uncertain || Boolean(recovery || savedEditor)
  const change = <K extends keyof StoryEditInput>(key: K, next: StoryEditInput[K]) => {
    setValue(current => ({ ...current, [key]: next }))
    setNotice('')
  }
  const save = (kind: StorySaveIntent = 'save') => {
    if (inFlight.current || savedEditor) return
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
    const missing = newDraft && !uncertain ? missingNewStoryField(value) : null
    if (missing) {
      setError(true)
      setNotice(missing.message)
      document.getElementById(missing.field)?.focus()
      return
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
          const result = await addStory(site.id, collectionId, revision, newStoryInput(value), creationRequest.current!)
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
          setNotice('Story draft saved. Opening it…')
          setSavedEditor(
            '/sites/' + site.id + '/stories/' + result.entryId + (kind === 'save' ? '' : '?intent=' + kind),
          )
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
          saved = storyDraftInput(result.values, catalog, configured, authorAvailable)
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
  const submitForReview = () => {
    if (!submission) return
    if (inFlight.current) return
    inFlight.current = true
    setError(false)
    setNotice('Sending this saved story for review…')
    start(async () => {
      try {
        const result = await sendStorySubmission(site.id, collectionId, entry.id, submission, submissionNote)
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
  }
  return {
    catalog,
    configured,
    authorAvailable,
    superAdmin,
    site,
    entry,
    placementContext,
    rights,
    newDraft,
    publicationStatus,
    router,
    value,
    setValue,
    pending,
    uncertain,
    savedEditor,
    creationKind,
    notice,
    firstSiteReview,
    photoOpen,
    setPhotoOpen,
    previewOpen,
    setPreviewOpen,
    previewLoaded,
    setPreviewLoaded,
    leaveOpen,
    settingsTab,
    setSettingsTab,
    error,
    setNotice,
    setRefresh,
    submission,
    submissionOpen,
    setSubmissionOpen,
    submissionNote,
    setSubmissionNote,
    finishLeave,
    cancelLeave,
    recovery,
    recoveryOpen,
    setRecoveryOpen,
    choices,
    setChoices,
    acceptRecovery,
    disabled,
    preview,
    change,
    save,
    summaryLength: String(JSON.parse(baseline).summary ?? '').length,
    submitForReview,
    dirty,
    back,
  }
}

export type StoryDraftModel = ReturnType<typeof useStoryDraft>
