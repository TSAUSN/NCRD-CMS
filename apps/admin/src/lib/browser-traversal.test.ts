import { describe, expect, it, vi } from 'vitest'
import { guardHistoryTraversal, type HistoryTraversalEvent } from './browser-traversal.ts'

const origin = 'https://cms.test'
function traversal(overrides: Partial<HistoryTraversalEvent> = {}): HistoryTraversalEvent {
  return {
    navigationType: 'traverse',
    cancelable: true,
    destination: { url: `${origin}/sites/site-a`, sameDocument: true },
    preventDefault: vi.fn(),
    ...overrides,
  }
}
describe('supported browser history departure', () => {
  it('cancels a supported Back/Forward attempt when unsaved or pending work refuses departure', () => {
    const event = traversal()
    expect(guardHistoryTraversal(event, `${origin}/pages/page-a`, () => false)).toBe('canceled')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    const accepted = traversal()
    expect(guardHistoryTraversal(accepted, `${origin}/pages/page-a`, () => true)).toBe('allowed')
    expect(accepted.preventDefault).not.toHaveBeenCalled()
  })
  it('reports uncancelable traversal instead of pretending Cancel retained the page', () => {
    const event = traversal({ cancelable: false }),
      confirm = vi.fn(() => false)
    expect(guardHistoryTraversal(event, `${origin}/pages/page-a`, confirm)).toBe('unavailable')
    expect(confirm).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
  it('leaves hash changes, explicit links and document departures to their own existing guards', () => {
    const confirm = vi.fn(() => false)
    const events = [
      traversal({ navigationType: 'push' }),
      traversal({ navigationType: 'replace' }),
      traversal({ destination: { url: `${origin}/pages/page-a#section`, sameDocument: true } }),
      traversal({ destination: { url: 'https://other.test/page', sameDocument: false } }),
      traversal({ destination: { url: `${origin}/sites/site-a`, sameDocument: false } }),
    ]
    for (const event of events)
      expect(guardHistoryTraversal(event, `${origin}/pages/page-a`, confirm)).toBe('irrelevant')
    expect(confirm).not.toHaveBeenCalled()
  })
})
