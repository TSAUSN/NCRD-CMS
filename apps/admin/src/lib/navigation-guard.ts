export type DraftLeave = Readonly<{
  label: string
  saveMode?: 'library'
  saved?: boolean
  discardLabel?: string
  saveDraft: () => Promise<{ ok: boolean; message?: string }>
  discard?: () => void | { ok: boolean; message?: string } | Promise<void | { ok: boolean; message?: string }>
}>
export type NavigationGuardState = Readonly<{
  dirty: boolean
  nativeDirty?: boolean
  pending: boolean
  draft?: DraftLeave
  requestLeave?: (proceed: () => void) => void
}>
export type NavigationDecision = 'allow' | 'confirm-discard' | 'wait'

/** Pending writes take priority over discarding unsaved local state. */
export function navigationDecision(states: Iterable<NavigationGuardState>): NavigationDecision {
  let dirty = false
  for (const state of states) {
    if (state.pending) return 'wait'
    dirty ||= state.dirty
  }
  return dirty ? 'confirm-discard' : 'allow'
}

/**
 * Each mounted editor owns its registration. Readers are evaluated at the
 * navigation attempt, so a synchronous in-flight ref closes the gap before
 * React commits a transition's pending state.
 */
export function createNavigationGuardRegistry() {
  const readers = new Map<symbol, () => NavigationGuardState>()
  const listeners = new Set<() => void>()
  let version = 0
  const touch = () => {
    version++
    for (const listener of listeners) listener()
  }
  return {
    touch,
    version: () => version,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    register(readState: () => NavigationGuardState): () => void {
      const token = Symbol('editor navigation guard')
      readers.set(token, readState)
      touch()
      return () => {
        readers.delete(token)
        touch()
      }
    },
    states(): NavigationGuardState[] {
      return [...readers.values()].map(readState => readState())
    },
    decision(): NavigationDecision {
      return navigationDecision([...readers.values()].map(readState => readState()))
    },
  }
}
