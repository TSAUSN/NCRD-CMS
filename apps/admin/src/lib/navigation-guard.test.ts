import { describe, expect, it } from 'vitest'
import { createNavigationGuardRegistry, navigationDecision } from './navigation-guard.ts'

describe('internal navigation policy', () => {
  it('allows navigation when no editor is registered or all drafts are clean', () => {
    expect(navigationDecision([])).toBe('allow')
    expect(navigationDecision([{ dirty: false, pending: false }])).toBe('allow')
  })

  it('asks before leaving any unsaved editor', () => {
    expect(
      navigationDecision([
        { dirty: false, pending: false },
        { dirty: true, pending: false },
      ]),
    ).toBe('confirm-discard')
  })

  it('never offers to discard a pending write, regardless of registration order', () => {
    const dirty = { dirty: true, pending: false }
    const pending = { dirty: false, pending: true }
    expect(navigationDecision([dirty, pending])).toBe('wait')
    expect(navigationDecision([pending, dirty])).toBe('wait')
    expect(navigationDecision([{ dirty: true, pending: true }])).toBe('wait')
  })

  it('reads current refs at navigation time, including before a pending rerender', () => {
    const registry = createNavigationGuardRegistry()
    const inFlight = { current: false }
    registry.register(() => ({ dirty: false, pending: inFlight.current }))
    expect(registry.decision()).toBe('allow')
    inFlight.current = true
    expect(registry.decision()).toBe('wait')
    inFlight.current = false
    expect(registry.decision()).toBe('allow')
  })

  it('removes only the unmounted editor and permits repeated cleanup', () => {
    const registry = createNavigationGuardRegistry()
    const removeDirty = registry.register(() => ({ dirty: true, pending: false }))
    const removePending = registry.register(() => ({ dirty: false, pending: true }))
    removePending()
    removePending()
    expect(registry.decision()).toBe('confirm-discard')
    removeDirty()
    expect(registry.decision()).toBe('allow')
  })

  it('gives each registration ownership even when readers are the same function', () => {
    const registry = createNavigationGuardRegistry()
    const reader = () => ({ dirty: true, pending: false })
    const removeFirst = registry.register(reader)
    const removeSecond = registry.register(reader)
    removeFirst()
    expect(registry.decision()).toBe('confirm-discard')
    removeSecond()
    expect(registry.decision()).toBe('allow')
  })
})
