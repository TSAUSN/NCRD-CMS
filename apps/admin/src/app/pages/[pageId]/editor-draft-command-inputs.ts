import type { Dispatch, SetStateAction } from 'react'
import type { EditorDocument, EditorState, SaveQueue } from '@cms/domain'
import type { ActionResult } from '../../../lib/action-result.ts'
import type { LibraryEntry } from '../../../lib/queries.ts'
import type { SitePreviewContext } from '../../../lib/preview-context.ts'
import type { EditorPane, PageEditorProps } from './editor-types.ts'

export type Set<T> = Dispatch<SetStateAction<T>>
export type Current<T> = { current: T }
type Snapshot = { document: EditorDocument; sectionOrigins: string[] }

/** The same acknowledged draft and undo history are used by every section edit. */
export type DraftCommandInputs = {
  props: Pick<PageEditorProps, 'pageId'>
  state: EditorState
  currentEditor: Current<EditorState>
  queue: Current<SaveQueue<Snapshot>>
  savedVersionId: Current<string | null>
  flushForReview: () => Promise<boolean>
  renderCanvas: (snapshot: EditorDocument) => void
  sitePreview: SitePreviewContext
  setApprovedVersionId: Set<string | null>
  setPane: Set<EditorPane>
  setReplacementDefinitions: Set<LibraryEntry[]>
  setResult: Set<ActionResult | null>
  setReview: Set<PageEditorProps['openReview']>
  setRevision: Set<number>
  setState: Set<EditorState>
}
