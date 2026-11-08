'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import {
  createNavigationGuardRegistry,
  type NavigationGuardState,
  type DraftLeave,
  navigationDecision,
} from '../lib/navigation-guard.ts'

// This is populated ONLY by committed client effects, never during render.
// Server rendering therefore cannot retain one request's editor in another.
const guards = createNavigationGuardRegistry()

/** Keep each editor's existing beforeunload warning for document departures. */
export function useNavigationGuard(readState: () => NavigationGuardState): void {
  const latest = useRef(readState)
  // Use the latest committed getter before the browser can dispatch another
  // event, without publishing state from an abandoned concurrent render.
  useLayoutEffect(() => {
    latest.current = readState
    guards.touch()
  }, [readState])
  useEffect(() => guards.register(() => latest.current()), [])
}

/** Called only by an actual client-navigation event, not while rendering. */
export function confirmClientNavigation(): boolean {
  const decision = navigationDecision(
    guards.states().map(state => ({ ...state, dirty: state.nativeDirty ?? state.dirty })),
  )
  if (decision === 'wait') {
    window.alert('Please wait for the current action to finish before leaving this screen.')
    return false
  }
  return decision === 'allow' || window.confirm('Leave this screen with unsaved changes?')
}

export type DraftLeaveRequest = { drafts: DraftLeave[]; readDrafts: () => DraftLeave[] | null; proceed: () => void }
let prompt: ((request: DraftLeaveRequest) => void) | undefined
/** Mounted only by the root client prompt; never populated by server rendering. */
export function subscribeDraftLeave(listener: (request: DraftLeaveRequest) => void) {
  prompt = listener
  return () => {
    if (prompt === listener) prompt = undefined
  }
}
/** Async save/discard choices resume only the originally requested navigation. */
export function requestClientNavigation(proceed: () => void, onPrompt?: () => void): boolean {
  const states = guards.states()
  const decision = navigationDecision(states)
  if (decision === 'allow') return true
  if (decision === 'wait') {
    window.alert('Please wait for the current action to finish before leaving this screen.')
    return false
  }
  const dirty = states.filter(state => state.dirty)
  if (dirty.length === 1 && dirty[0]!.requestLeave) {
    onPrompt?.()
    dirty[0]!.requestLeave(proceed)
    return false
  }
  if (prompt && dirty.every(state => state.draft)) {
    onPrompt?.()
    prompt({
      drafts: dirty.map(state => state.draft!),
      readDrafts: () => {
        const current = guards.states()
        return navigationDecision(current) === 'wait' || current.some(state => state.dirty && !state.draft)
          ? null
          : current.filter(state => state.dirty).map(state => state.draft!)
      },
      proceed,
    })
    return false
  }
  return window.confirm('Leave this screen with unsaved changes?')
}

export const subscribeNavigationState = guards.subscribe
export const navigationStateVersion = guards.version

/** Nested panels can leave their own fields while keeping the page's edits. */
export function requestLocalDraftNavigation(read: () => NavigationGuardState, proceed: () => void): boolean {
  const state = read()
  const decision = navigationDecision([state])
  if (decision === 'allow') return true
  if (decision === 'wait') {
    window.alert('Please wait for the current action to finish before leaving this step.')
    return false
  }
  if (prompt && state.draft) {
    prompt({
      drafts: [state.draft],
      readDrafts: () => {
        const current = read()
        return current.pending ? null : current.dirty && current.draft ? [current.draft] : []
      },
      proceed,
    })
    return false
  }
  return window.confirm('Leave this step with unsaved changes?')
}
