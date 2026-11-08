import type { Dispatch, SetStateAction } from 'react'
import { apply, commitSaved, type EditorDocument, type EditorState, type SaveQueue } from '@cms/domain'
import { archivePage, unpublishPage } from '../../actions/page-lifecycle.ts'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { PageDetailsInput } from '../../../lib/page-details.ts'
import { duplicatePageAction } from './page-copy-actions.ts'
import { savePageDetailsAction } from './page-details-actions.ts'
import type { PageEditorProps } from './editor-types.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type Set<T> = Dispatch<SetStateAction<T>>
type Current<T> = { current: T }
type PageDanger = 'unpublish' | 'archive' | null

type Inputs = {
  draft: {
    props: Pick<PageEditorProps, 'pageId' | 'siteHref'>
    flushForReview: () => Promise<boolean>
    currentEditor: Current<EditorState>
    queue: Current<SaveQueue<SaveSnapshot>>
    savedVersionId: Current<string | null>
    setState: Set<EditorState>
    setResult: Set<ActionResult | null>
    setRevision: Set<number>
    renderCanvas: (snapshot: EditorDocument) => void
  }
  lifecycle: {
    pageDanger: PageDanger
    setPageDanger: Set<PageDanger>
    transitionPending: boolean
    startTransition: (action: () => Promise<void>) => void
    clearPublication: () => void
    setReview: Set<PageEditorProps['openReview']>
    openAfterPageAction: (href: string) => void
  }
}

/** Save page settings, duplicate a page, or remove it from publication. */
export function pageCommands({ draft, lifecycle }: Inputs) {
  const {
    props,
    flushForReview,
    currentEditor,
    queue,
    savedVersionId,
    setState,
    setResult,
    setRevision,
    renderCanvas,
  } = draft
  const {
    pageDanger,
    setPageDanger,
    transitionPending,
    startTransition,
    clearPublication,
    setReview,
    openAfterPageAction,
  } = lifecycle
  async function duplicateCurrentPage() {
    if (transitionPending) return
    startTransition(async () => {
      if (!(await flushForReview())) return
      let destination: string | null = null
      const result = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async revision => {
          const copied = await duplicatePageAction(props.pageId, revision)
          if (!copied.ok) {
            setResult(copied)
            return { ok: false, conflict: copied.kind === 'conflict' }
          }
          destination = copied.pageId
          return { ok: true, revision }
        },
      })
      if (result.status === 'acknowledged' && destination) openAfterPageAction('/pages/' + destination)
      else if (result.status === 'failed')
        setResult({
          ok: false,
          kind: 'error',
          message: 'The page could not be duplicated. Check your connection and try again.',
        })
    })
  }
  async function saveDetails(input: PageDetailsInput) {
    if (!(await flushForReview())) return null
    let result: Awaited<ReturnType<typeof savePageDetailsAction>> | undefined
    const queued = await queue.current.enqueue({
      snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
      run: async revision => {
        result = await savePageDetailsAction(input, revision)
        if (!result.ok) {
          setResult(result)
          return { ok: false, conflict: result.kind === 'conflict' }
        }
        if (result.versionId) savedVersionId.current = result.versionId
        return { ok: true, revision: result.revision }
      },
    })
    if (queued.status === 'acknowledged' && result?.ok) {
      const identity = { title: result.title, address: result.address }
      const acknowledged = { ...queued.snapshot.document, identity }
      setState(current =>
        commitSaved(
          apply(current, draft => {
            draft.identity = identity
          }),
          acknowledged,
        ),
      )
      setRevision(result.revision)
      renderCanvas(acknowledged)
    }
    return (
      result ?? {
        ok: false as const,
        kind: 'error' as const,
        message: 'The page details could not be saved. Check your connection and try again.',
      }
    )
  }
  async function applyPageDanger() {
    if (!pageDanger || transitionPending) return
    startTransition(async () => {
      if (!(await flushForReview())) return
      const action = pageDanger
      const queued = await queue.current.enqueue({
        snapshot: { document: currentEditor.current.document, sectionOrigins: currentEditor.current.sectionOrigins },
        run: async revision => {
          const data = new FormData()
          data.set('pageId', props.pageId)
          data.set('revision', String(revision))
          const outcome = await (action === 'archive' ? archivePage(data) : unpublishPage(data))
          setResult(outcome)
          return outcome.ok
            ? { ok: true, revision: outcome.revision }
            : { ok: false, conflict: outcome.kind === 'conflict' }
        },
      })
      if (queued.status === 'acknowledged') {
        setRevision(queued.revision)
        clearPublication()
        setReview(null)
        setPageDanger(null)
        if (action === 'archive') openAfterPageAction(props.siteHref)
      }
    })
  }
  return { duplicateCurrentPage, saveDetails, applyPageDanger }
}
