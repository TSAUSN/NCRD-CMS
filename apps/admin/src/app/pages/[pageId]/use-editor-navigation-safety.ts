import { useLayoutEffect } from 'react'
import { deepEqual, type EditorState, type SaveQueue } from '@cms/domain'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { useHistoryTraversalGuard } from '../../../components/use-history-traversal-guard.ts'
import type { SaveSnapshot } from './use-draft-save.ts'

type DraftNavigation = {
  props: { title: string }
  state: EditorState
  openingSnapshot: { current: SaveSnapshot | null }
  dirty: boolean
  queue: { current: SaveQueue<SaveSnapshot> }
}

type GuardState = {
  reviewFlight: { current: boolean }
  scheduleFlight: { current: boolean }
  transitionPending: boolean
  saving: boolean
  upgrade: { busy?: boolean } | null
  replacement: { busy?: boolean } | null
  recovery: { pending: () => boolean; review: object | null; busy: boolean }
  canvasHistoryBlocked: { current: boolean }
  pageDanger: string | null
  siteWide: { editing: boolean } | null
  inlineList: object | null
  layoutChooser: object | null
  sectionConfirmation: object | null
  discardConfirmation: boolean
  fieldUpdate: object | null
  overrideOpen: boolean
  submitOpen: boolean
}

type LeaveCommand = () => Promise<{ ok: boolean; message?: string }>

/** Dialogs own focus and history while draft writes and recovery settle. */
export function useEditorNavigationSafety(
  { props, state, openingSnapshot, dirty, queue }: DraftNavigation,
  {
    reviewFlight,
    scheduleFlight,
    transitionPending,
    saving,
    upgrade,
    replacement,
    recovery,
    canvasHistoryBlocked,
    pageDanger,
    siteWide,
    inlineList,
    layoutChooser,
    sectionConfirmation,
    discardConfirmation,
    fieldUpdate,
    overrideOpen,
    submitOpen,
  }: GuardState,
  readCommands: () => { saveDraft: LeaveCommand; discard: LeaveCommand },
) {
  useNavigationGuard(() => ({
    dirty: dirty || !deepEqual(state.document, openingSnapshot.current!.document),
    nativeDirty: dirty,
    draft: {
      label: state.document.identity?.title || props.title,
      saved: !dirty,
      discardLabel: 'Discard my edits',
      ...readCommands(),
    },
    pending:
      reviewFlight.current ||
      scheduleFlight.current ||
      transitionPending ||
      saving ||
      queue.current.busy() ||
      upgrade?.busy === true ||
      replacement?.busy === true ||
      recovery.pending(),
  }))
  const limitedHistory = useHistoryTraversalGuard()
  useLayoutEffect(() => {
    canvasHistoryBlocked.current =
      pageDanger !== null ||
      siteWide?.editing === true ||
      inlineList !== null ||
      layoutChooser !== null ||
      sectionConfirmation !== null ||
      discardConfirmation ||
      upgrade !== null ||
      replacement !== null ||
      fieldUpdate !== null ||
      overrideOpen ||
      submitOpen ||
      recovery.review !== null ||
      recovery.busy
  }, [
    pageDanger,
    siteWide,
    inlineList,
    layoutChooser,
    sectionConfirmation,
    discardConfirmation,
    upgrade,
    replacement,
    fieldUpdate,
    overrideOpen,
    submitOpen,
    recovery.review,
    recovery.busy,
  ])
  return limitedHistory
}
