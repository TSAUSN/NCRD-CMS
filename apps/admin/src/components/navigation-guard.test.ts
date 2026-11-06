import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A committed-effect harness, not a DOM or React scheduling test. It verifies
// that render alone never writes to the module registry, and that registrations
// belong to the cleanup React receives from that effect.
const lifecycle = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | void)[],
  layouts: [] as (() => void)[],
  refs: [] as { current: unknown }[],
  cursor: 0,
}))
vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => (() => void) | void) => {
    lifecycle.effects.push(effect)
  },
  useLayoutEffect: (effect: () => void) => {
    lifecycle.layouts.push(effect)
  },
  useRef: (initial: unknown) => {
    const index = lifecycle.cursor++
    return (lifecycle.refs[index] ??= { current: initial })
  },
}))
import {
  confirmClientNavigation,
  requestClientNavigation,
  subscribeDraftLeave,
  useNavigationGuard,
} from './navigation-guard.ts'

let cleanups: (() => void)[]
function commitEffects() {
  lifecycle.layouts.splice(0).forEach(effect => effect())
  for (const effect of lifecycle.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup) cleanups.push(cleanup)
  }
}

beforeEach(() => {
  cleanups = []
  lifecycle.effects = []
  lifecycle.layouts = []
  lifecycle.refs = []
  lifecycle.cursor = 0
  vi.stubGlobal('window', { confirm: vi.fn(() => false), alert: vi.fn() })
})
afterEach(() => {
  cleanups.forEach(cleanup => cleanup())
  vi.unstubAllGlobals()
})

describe('mounted editor navigation guards', () => {
  it('does not register while rendering, then unregisters on effect cleanup', () => {
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    expect(confirmClientNavigation()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()
    commitEffects()
    expect(confirmClientNavigation()).toBe(false)
    cleanups[0]!()
    expect(confirmClientNavigation()).toBe(true)
  })

  it('allows an explicit unsaved-departure confirmation without clearing the guard', () => {
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    commitEffects()
    vi.mocked(window.confirm).mockReturnValueOnce(true)
    expect(confirmClientNavigation()).toBe(true)
    // A canceled/failed destination must not disable protection for a retry.
    expect(confirmClientNavigation()).toBe(false)
    expect(window.confirm).toHaveBeenCalledTimes(2)
  })

  it('blocks a write started after registration before React has rendered pending', () => {
    const inFlight = { current: false }
    useNavigationGuard(() => ({ dirty: true, pending: inFlight.current }))
    commitEffects()
    inFlight.current = true
    expect(confirmClientNavigation()).toBe(false)
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('wait'))
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('only asks once when multiple editors are dirty', () => {
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    commitEffects()
    expect(confirmClientNavigation()).toBe(false)
    expect(window.confirm).toHaveBeenCalledOnce()
  })

  it('supports effect replay and replacing dirty state with a clean committed render', () => {
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    const firstEffect = lifecycle.effects[0]!
    commitEffects()
    cleanups[0]!()
    const replayCleanup = firstEffect()
    expect(confirmClientNavigation()).toBe(false)
    replayCleanup?.()
    useNavigationGuard(() => ({ dirty: false, pending: false }))
    commitEffects()
    expect(confirmClientNavigation()).toBe(true)
  })

  it('uses the latest committed getter without replacing its mounted registration', () => {
    useNavigationGuard(() => ({ dirty: true, pending: false }))
    commitEffects()
    lifecycle.cursor = 0
    useNavigationGuard(() => ({ dirty: false, pending: false }))
    expect(confirmClientNavigation()).toBe(false)
    // React runs layout effects before another event can arrive. The stable
    // registration effect is intentionally not replayed for this update.
    lifecycle.layouts.splice(0).forEach(effect => effect())
    expect(confirmClientNavigation()).toBe(true)
  })
})

describe('draft-aware navigation', () => {
  it('opens a prompt with current save callbacks and leaves the destination paused', () => {
    let dirty = true
    const saveDraft = vi.fn(async () => ({ ok: true })),
      proceed = vi.fn(),
      listener = vi.fn(),
      unsubscribe = subscribeDraftLeave(listener)
    try {
      useNavigationGuard(() => ({ dirty, pending: false, draft: { label: 'Header & menu', saveDraft } }))
      commitEffects()
      expect(requestClientNavigation(proceed)).toBe(false)
      expect(proceed).not.toHaveBeenCalled()
      expect(window.confirm).not.toHaveBeenCalled()
      const request = listener.mock.calls[0]![0]
      expect(request.drafts[0].label).toBe('Header & menu')
      dirty = false
      expect(request.readDrafts()).toEqual([])
    } finally {
      unsubscribe()
    }
  })
  it('does not offer draft choices or resume while a write is pending', () => {
    const listener = vi.fn(),
      unsubscribe = subscribeDraftLeave(listener)
    try {
      useNavigationGuard(() => ({
        dirty: true,
        pending: true,
        draft: { label: 'Footer', saveDraft: async () => ({ ok: true }) },
      }))
      commitEffects()
      expect(requestClientNavigation(vi.fn())).toBe(false)
      expect(listener).not.toHaveBeenCalled()
      expect(window.alert).toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
})

it('lets a writer use its existing three-choice dialog while preserving the requested continuation', () => {
  let resume = () => {}
  const ask = vi.fn((proceed: () => void) => {
      resume = proceed
    }),
    proceed = vi.fn()
  useNavigationGuard(() => ({ dirty: true, pending: false, requestLeave: ask }))
  commitEffects()
  expect(requestClientNavigation(proceed)).toBe(false)
  expect(ask).toHaveBeenCalledOnce()
  expect(proceed).not.toHaveBeenCalled()
  expect(window.confirm).not.toHaveBeenCalled()
  resume()
  expect(proceed).toHaveBeenCalledOnce()
})

it('retains native unsaved protection while a saved editing visit uses CMS draft choices', () => {
  const listener = vi.fn(),
    unsubscribe = subscribeDraftLeave(listener)
  try {
    useNavigationGuard(() => ({
      dirty: true,
      nativeDirty: false,
      pending: false,
      draft: { label: 'Home', saved: true, saveDraft: async () => ({ ok: true }) },
    }))
    commitEffects()
    expect(confirmClientNavigation()).toBe(true)
    expect(window.confirm).not.toHaveBeenCalled()
    expect(requestClientNavigation(vi.fn())).toBe(false)
    expect(listener).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
  }
})
