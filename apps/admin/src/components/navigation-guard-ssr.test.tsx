import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { confirmClientNavigation, useNavigationGuard } from './navigation-guard.ts'

function UnsavedEditor() {
  useNavigationGuard(() => ({ dirty: true, pending: true }))
  return <p>Unsaved draft</p>
}

describe('navigation guard server rendering', () => {
  it('does not retain editor state or require a browser across server renders', () => {
    // Real React effects do not run in this renderer. If render registered the
    // guard, the attempt below would touch window and throw in this Node test.
    expect(renderToStaticMarkup(<UnsavedEditor />)).toContain('Unsaved draft')
    expect(confirmClientNavigation()).toBe(true)
    expect(renderToStaticMarkup(<UnsavedEditor />)).toContain('Unsaved draft')
    expect(confirmClientNavigation()).toBe(true)
  })
})
