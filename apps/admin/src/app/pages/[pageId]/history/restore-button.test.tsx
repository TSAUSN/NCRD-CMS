import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { ActionResult } from '../../../../lib/action-result.ts'

// A deterministic component/controller test, without claiming browser coverage.
// Hook state is retained between explicit renders; async responses settle only
// when the test releases them, including a repeat click before React repaints.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  pending: false,
  work: null as Promise<void> | null,
}))
const actions = vi.hoisted(() => ({ restore: vi.fn() }))
vi.mock('../../../actions/page-draft.ts', () => ({ restorePageVersionAsDraft: actions.restore }))
vi.mock('react', async original => ({
  ...(await original<object>()),
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial })
  },
  useTransition: () => [
    hooks.pending,
    (work: () => Promise<void>) => {
      hooks.pending = true
      hooks.work = work().finally(() => {
        hooks.pending = false
      })
    },
  ],
}))
import { ConfirmDialog } from '../../../../components/confirm.tsx'
import { Button } from '../../../../components/ui/index.ts'
import { RestoreButton } from './restore-button.tsx'

const assign = vi.fn()
function render() {
  hooks.index = 0
  hooks.refIndex = 0
  return RestoreButton({ pageId: 'page-a', sourceVersionId: 'version-old', revision: '12' })
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child =>
    isValidElement<Record<string, unknown>>(child) ? [child, ...nodes(child.props.children as ReactNode)] : [],
  )
}
function dialog() {
  return nodes(render()).find(node => node.type === ConfirmDialog)!
}
function open() {
  const button = nodes(render()).find(node => node.type === Button)!
  ;(button.props.onClick as () => void)()
  return dialog()
}
function deferred() {
  let resolve!: (result: ActionResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ActionResult>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  hooks.values = []
  hooks.refs = []
  hooks.index = 0
  hooks.refIndex = 0
  hooks.pending = false
  hooks.work = null
  actions.restore.mockReset()
  assign.mockReset()
  vi.stubGlobal('window', { location: { assign } })
})

describe('page restore interruptions and repeat clicks', () => {
  it('cancels before confirmation without making a request', () => {
    const shown = open()
    ;(shown.props.onCancel as () => void)()
    expect(dialog()).toBeUndefined()
    expect(actions.restore).not.toHaveBeenCalled()
  })
  it('sends once, marks the dialog pending, and cannot dismiss a committed-in-flight restore', async () => {
    const response = deferred()
    actions.restore.mockReturnValue(response.promise)
    const shown = open()
    const confirm = shown.props.onConfirm as () => void
    confirm()
    confirm()
    expect(actions.restore).toHaveBeenCalledTimes(1)
    expect(dialog().props.pending).toBe(true)
    ;(dialog().props.onCancel as () => void)()
    expect(dialog()).toBeDefined()
    const form = actions.restore.mock.calls[0]![0] as FormData
    expect(Object.fromEntries(form)).toEqual({ pageId: 'page-a', sourceVersionId: 'version-old', revision: '12' })
    response.resolve({ ok: true, revision: 13, versionId: 'version-new', message: 'Restored' })
    await hooks.work
    expect(assign).toHaveBeenCalledExactlyOnceWith('/pages/page-a')
    expect(dialog()).toBeUndefined()
  })
  it('keeps a rejected stale restore visible as an error without navigating', async () => {
    actions.restore.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      currentRevision: 13,
      message: 'Reload before restoring',
    })
    ;(open().props.onConfirm as () => void)()
    await hooks.work
    expect(assign).not.toHaveBeenCalled()
    expect(hooks.values[1]).toMatchObject({ ok: false, kind: 'conflict' })
    expect(hooks.pending).toBe(false)
  })
  it('handles an uncertain transport result without a success claim or navigation', async () => {
    const response = deferred()
    actions.restore.mockReturnValue(response.promise)
    ;(open().props.onConfirm as () => void)()
    response.reject(new Error('response lost'))
    await hooks.work
    expect(assign).not.toHaveBeenCalled()
    expect(hooks.values[1]).toMatchObject({
      ok: false,
      kind: 'error',
      message: expect.stringContaining('could not be confirmed'),
    })
    expect(hooks.pending).toBe(false)
    expect(dialog()).toBeUndefined()
  })
})
