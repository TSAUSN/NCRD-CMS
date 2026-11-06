import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '@cms/schema'
import type { ActionResult } from '../../../../lib/action-result.ts'

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  pending: false,
  work: null as Promise<void> | null,
  navigation: null as (() => { dirty: boolean; pending: boolean }) | null,
}))
const actions = vi.hoisted(() => ({ save: vi.fn(), publish: vi.fn(), revert: vi.fn(), refresh: vi.fn() }))
vi.mock('../../../actions/site-look.ts', () => ({
  saveThemeDraft: actions.save,
  publishTheme: actions.publish,
  revertThemeToLive: actions.revert,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: actions.refresh }) }))
vi.mock('../../../../components/navigation-guard.ts', () => ({
  useNavigationGuard: (read: typeof hooks.navigation) => {
    hooks.navigation = read
  },
}))
vi.mock('react', async original => ({
  ...(await original<object>()),
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++
    return hooks.refs[index] ?? (hooks.refs[index] = { current: initial })
  },
  useEffect: () => {},
  useMemo: (build: () => unknown) => build(),
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
import { ThemeEditor } from './theme-editor.tsx'

function render(canManage = true) {
  hooks.index = 0
  hooks.refIndex = 0
  const published = structuredClone(DEFAULT_THEME_TOKENS) as ThemeTokens
  const draft = { ...published, spacing: 'spacious' as const }
  return ThemeEditor({
    siteId: 'site-a',
    siteName: 'Site A',
    canManage,
    initial: {
      revision: 8,
      draftVersionId: 'draft-v8',
      publishedVersionId: 'live-v7',
      draft,
      published,
      usage: {},
      previewPages: [],
    },
  })
}
function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child =>
    isValidElement<Record<string, unknown>>(child) ? [child, ...nodes(child.props.children as ReactNode)] : [],
  )
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map(child =>
      isValidElement<Record<string, unknown>>(child) ? text(child.props.children as ReactNode) : String(child),
    )
    .join('')
}
function button(label: string) {
  return nodes(render()).find(
    node => (node.type === 'button' || node.type === Button) && text(node.props.children as ReactNode) === label,
  )!
}
function dialog() {
  return nodes(render()).find(node => node.type === ConfirmDialog)!
}
function open(kind: 'publish' | 'revert') {
  ;(button(kind === 'publish' ? 'Publish design' : 'Revert to live').props.onClick as () => void)()
  return dialog()
}
function deferred() {
  let resolve!: (result: ActionResult) => void
  let reject!: (reason: Error) => void
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
  hooks.navigation = null
  for (const action of Object.values(actions)) action.mockReset()
})

describe('theme command interruptions without a browser', () => {
  it('can dismiss the confirmation before sending anything', () => {
    ;(open('publish').props.onCancel as () => void)()
    expect(dialog()).toBeUndefined()
    expect(actions.publish).not.toHaveBeenCalled()
  })
  for (const kind of ['publish', 'revert'] as const) {
    it(`${kind} sends once and stays pending until the acknowledged result`, async () => {
      const response = deferred()
      actions[kind].mockReturnValue(response.promise)
      const shown = open(kind)
      const confirm = shown.props.onConfirm as () => void
      confirm()
      confirm()
      expect(actions[kind]).toHaveBeenCalledTimes(1)
      expect(dialog().props.pending).toBe(true)
      expect(
        nodes(render()).find(node => node.type === 'fieldset' && node.props.className === 'theme-controls')?.props
          .disabled,
      ).toBe(true)
      expect(hooks.navigation?.().pending).toBe(true)
      ;(dialog().props.onCancel as () => void)()
      expect(dialog()).toBeDefined()
      response.resolve({ ok: true, revision: 9, versionId: 'new-v9', message: 'Acknowledged' })
      await hooks.work
      render()
      expect(hooks.values[3]).toBe(9)
      expect(dialog()).toBeUndefined()
      expect(hooks.navigation?.().pending).toBe(false)
      expect(actions.refresh).toHaveBeenCalledTimes(1)
    })
    it(`${kind} reports a lost response without claiming success or changing its known revision`, async () => {
      const response = deferred()
      actions[kind].mockReturnValue(response.promise)
      ;(open(kind).props.onConfirm as () => void)()
      response.reject(new Error('response lost'))
      await hooks.work
      render()
      expect(hooks.values[4]).toMatchObject({
        ok: false,
        kind: 'error',
        message: expect.stringContaining('could not be confirmed'),
      })
      expect(hooks.values[3]).toBe(8)
      expect(actions.refresh).not.toHaveBeenCalled()
      expect(hooks.navigation?.().pending).toBe(false)
      expect(dialog()).toBeUndefined()
    })
  }
  it('saves the exact submitted tokens and does not claim a later value was acknowledged', async () => {
    const input = () => nodes(render()).find(node => node.type === 'input' && node.props.id === 'theme-primary')!
    ;(input().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '#002255' } })
    const response = deferred()
    actions.save.mockReturnValue(response.promise)
    const save = button('Save draft').props.onClick as () => void
    save()
    save()
    expect(actions.save).toHaveBeenCalledTimes(1)
    expect(JSON.parse((actions.save.mock.calls[0]![0] as FormData).get('tokens') as string).colors.primary).toBe(
      '#002255',
    )
    // The fieldset stops real input while pending. Even a queued callback must
    // not cause a newer token value to be marked as saved by an older response.
    ;(input().props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '#113366' } })
    response.resolve({ ok: true, revision: 9, versionId: 'saved-v9', message: 'Saved' })
    await hooks.work
    render()
    expect((hooks.values[0] as ThemeTokens).colors.primary).toBe('#113366')
    expect(JSON.parse(hooks.values[2] as string).colors.primary).toBe('#002255')
    expect(hooks.navigation?.().dirty).toBe(true)
  })
  it('leaves read-only design controls disabled', () => {
    const view = render(false)
    expect(
      nodes(view).find(node => node.type === 'fieldset' && node.props.className === 'theme-controls')?.props.disabled,
    ).toBe(true)
    expect(
      nodes(view).some(
        node =>
          (node.type === 'button' || node.type === Button) &&
          text(node.props.children as ReactNode) === 'Publish design',
      ),
    ).toBe(false)
  })
})
