import type { Dispatch, SetStateAction } from 'react'
import { isDirty, type EditorState, type SaveQueue } from '@cms/domain'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { PageEditorProps } from './editor-types.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type Current<T> = { current: T }
type Set<T> = Dispatch<SetStateAction<T>>
type Start = (action: () => Promise<void>) => void
import { commitBaseline, type EditorDocument } from '@cms/domain'
import { publishPage, publishPageTogether } from '../../actions/page-publish.ts'
import { submitPageForReview } from '../../actions/reviews.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { SampleConfirmation } from './editor-publish-dialogs.tsx'

type Inputs = {
  draft: {
    props: Pick<PageEditorProps, 'pageId'>
    currentEditor: Current<EditorState>
    queue: Current<SaveQueue<SaveSnapshot>>
    savedVersionId: Current<string | null>
    setResult: Set<ActionResult | null>
    startTransition: Start
  }
  publishState: {
    remainingSamples: readonly unknown[]
    setSampleConfirmation: Set<SampleConfirmation | null>
    latestSave: Current<(kind: 'checkpoint') => Promise<ActionResult | null>>
    state: EditorState
    setState: Set<EditorState>
    setRevision: Set<PageEditorProps['revision']>
    setPublishedVersionId: Set<string | null>
    openingSnapshot: Current<SaveSnapshot | null>
    setReview: Set<PageEditorProps['openReview']>
    setReviewFeedback: Set<PageEditorProps['latestReviewFeedback']>
  }
  canvas: {
    isolatedCurrent: Current<{ enabled: boolean; flush: () => Promise<boolean> }>
    canvasRefreshBlocked: Current<boolean>
    needsRender: Current<boolean>
    renderCanvas: (snapshot: EditorDocument) => void
    changeSitePreview: (next: SitePreviewContext) => void
  }
}

/** Publish or request review through the same queue as draft saves. */
export function publicationCommands({ draft, publishState, canvas }: Inputs) {
  const { props, currentEditor, queue, savedVersionId, setResult, startTransition } = draft
  const {
    remainingSamples,
    setSampleConfirmation,
    latestSave,
    state,
    setState,
    setRevision,
    setPublishedVersionId,
    openingSnapshot,
    setReview,
    setReviewFeedback,
  } = publishState
  const { isolatedCurrent, canvasRefreshBlocked, needsRender, renderCanvas, changeSitePreview } = canvas
  const publish = (overrideReason?: string, together = false, siteWide = false, samplesConfirmed = false) => {
    if (remainingSamples.length && !samplesConfirmed) {
      setSampleConfirmation({ ...(overrideReason ? { overrideReason } : {}), together, siteWide })
      return
    }
    setResult(null)
    startTransition(async () => {
      try {
        // Publishing goes through the same queue, so it can never overtake an
        // autosave already in flight or reuse a revision that autosave consumed.
        // Saving first also guarantees it publishes what is on screen.
        if (
          isolatedCurrent.current.enabled &&
          !canvasRefreshBlocked.current &&
          !(await isolatedCurrent.current.flush())
        )
          return
        if (isDirty(currentEditor.current)) {
          const saved = await latestSave.current('checkpoint')
          if (!saved) return // a conflict or failure; the notice is already up
        }

        const snapshot: SaveSnapshot = {
          document: currentEditor.current.document,
          sectionOrigins: currentEditor.current.sectionOrigins,
        }
        const queued = await queue.current.enqueue({
          snapshot,
          run: async (currentRevision, sending) => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('content', JSON.stringify(sending.document.sections))
            data.set('metaTitle', sending.document.meta.title ?? '')
            data.set('metaDescription', sending.document.meta.description ?? '')
            if (overrideReason) data.set('overrideReason', overrideReason)
            if (samplesConfirmed) data.set('sampleContentConfirmed', 'true')

            const outcome = together ? await publishPageTogether(data) : await publishPage(data)
            setResult(outcome)
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })

        if (queued.status !== 'acknowledged') return
        setRevision(queued.revision)
        setPublishedVersionId(savedVersionId.current)
        openingSnapshot.current = structuredClone(queued.snapshot)
        // The saved site design just went live, so the live one is what to show.
        if (siteWide) changeSitePreview('published')
        // What is now live becomes the origin: after publishing, "what have I
        // changed" restarts from the snapshot that was actually published.
        setState(current => commitBaseline(current, queued.snapshot.document, queued.snapshot.sectionOrigins))
        // Publishing writes no new version, so this only ever has anything to do
        // when the save above left the canvas owed a render.
        if (needsRender.current) renderCanvas(queued.snapshot.document)
      } catch (error) {
        // Without this a failed publish produced an unhandled rejection and no
        // user-visible notice at all.
        setResult({
          ok: false,
          kind: 'error',
          message:
            'The publication result could not be confirmed. Reload and check the live page before trying again; the server may have completed the request.',
        })
      }
    })
  }

  const submitForReview = (note: string) => {
    startTransition(async () => {
      try {
        // A review request freezes an exact stored version. Save first so the
        // reviewer never receives yesterday's canvas with today's note.
        if (
          isolatedCurrent.current.enabled &&
          !canvasRefreshBlocked.current &&
          !(await isolatedCurrent.current.flush())
        )
          return
        if (isDirty(currentEditor.current)) {
          const saved = await latestSave.current('checkpoint')
          if (!saved) return
        }

        const snapshot: SaveSnapshot = {
          document: state.document,
          sectionOrigins: state.sectionOrigins,
        }
        let submittedVersion: string | null = null
        const queued = await queue.current.enqueue({
          snapshot,
          run: async currentRevision => {
            const data = new FormData()
            data.set('pageId', props.pageId)
            data.set('revision', String(currentRevision))
            data.set('note', note)
            const outcome = await submitPageForReview(data)
            setResult(outcome)
            if (outcome.ok && outcome.versionId) {
              submittedVersion = outcome.versionId
              savedVersionId.current = outcome.versionId
            }
            return outcome.ok
              ? { ok: true, revision: outcome.revision }
              : { ok: false, conflict: outcome.kind === 'conflict' }
          },
        })
        if (queued.status !== 'acknowledged' || submittedVersion === null) return
        setRevision(queued.revision)
        setReview({ id: '', versionId: submittedVersion })
        setReviewFeedback(null)
      } catch (error) {
        setResult({
          ok: false,
          kind: 'error',
          message: `Could not submit for review: ${(error as Error).message}. Your draft is still saved.`,
        })
      }
    })
  }
  return { publish, submitForReview }
}
