import { renderToStaticMarkup } from 'react-dom/server'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HEADER_CONFIG, DEFAULT_FOOTER_CONFIG, type HeaderConfigV2, type FooterConfigV2 } from '@cms/schema'
const state = vi.hoisted(() => ({
  pending: false,
  handlers: false,
  values: [] as unknown[],
  index: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => void)[],
}))
vi.mock('react', async original => {
  const react = await original<typeof import('react')>()
  return {
    ...react,
    useState: (initial: unknown) => {
      if (!state.handlers) return react.useState(initial)
      const index = state.index++
      if (!(index in state.values)) state.values[index] = typeof initial === 'function' ? initial() : initial
      return [
        state.values[index],
        (value: unknown) => {
          state.values[index] = typeof value === 'function' ? value(state.values[index]) : value
        },
      ]
    },
    useRef: (value: unknown) => {
      if (!state.handlers) return react.useRef(value)
      const index = state.refIndex++
      return state.refs[index] ?? (state.refs[index] = { current: value })
    },
    useMemo: (build: () => unknown, dependencies: unknown[]) =>
      state.handlers ? build() : react.useMemo(build, dependencies),
    useEffect: (effect: () => void, dependencies: unknown[]) => {
      if (state.handlers) state.effects.push(effect)
      else react.useEffect(effect, dependencies)
    },
    useTransition: () => [state.pending, () => {}],
  }
})
vi.mock('../../../../components/navigation-guard.ts', () => ({ useNavigationGuard: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('../../../actions/site-look.ts', () => ({
  publishGlobalElements: vi.fn(),
  revertGlobalElementsToLive: vi.fn(),
  saveGlobalElementsDraft: vi.fn(),
}))
import { GlobalElementsEditor } from './global-elements-editor.tsx'
import { PresetFrameFields } from '../../../../components/preset-frame-fields.tsx'
import { PresetHeaderIdentity } from '../../../../components/preset-header-fields.tsx'
import { PresetFooterLayout } from '../../../../components/preset-footer-fields.tsx'
import { FrameComponentPanel } from './frame-component-panel.tsx'
import type { FrameComponentChoice } from '../../../../lib/queries.ts'
const head = <T,>(draft: T) => ({
  id: 'id',
  revision: 1,
  draftVersionId: 'draft',
  publishedVersionId: 'live',
  draft,
  published: draft,
})
const initial = {
  header: head(DEFAULT_HEADER_CONFIG),
  footer: head(DEFAULT_FOOTER_CONFIG),
  pages: [],
  previewPages: [],
  components: [],
}
beforeEach(() => {
  state.pending = false
  state.handlers = false
  state.values = []
  state.index = 0
  state.refs = []
  state.refIndex = 0
  state.effects = []
})
describe('frame editor static UI contracts', () => {
  it('disables the native editing fieldset while a write is pending', () => {
    state.pending = true
    const html = renderToStaticMarkup(
      <GlobalElementsEditor siteId="site" siteName="Synthetic" initial={initial} canManage superAdmin media={[]} />,
    )
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*aria-busy="true"/)
    expect(html).toContain('Working…')
    state.pending = false
  })
  it('keeps the editing controls available when idle', () => {
    const html = renderToStaticMarkup(
      <GlobalElementsEditor siteId="site" siteName="Synthetic" initial={initial} canManage superAdmin media={[]} />,
    )
    expect(html).toMatch(/<fieldset[^>]*aria-busy="false"/)
    expect(html).not.toMatch(/<fieldset[^>]*disabled/)
  })
  it('keeps the same field element across the old 80-character focus-loss boundary', () => {
    const components: FrameComponentChoice[] = [
      {
        id: 'component',
        name: 'Header',
        placement: 'header',
        scope: 'site',
        status: 'active',
        versions: [{ version: 1, slots: [{ id: 'text', label: 'Heading', kind: 'text', constraints: {} }] }],
      },
    ]
    for (const length of [0, 79, 80, 81, 120]) {
      const html = renderToStaticMarkup(
        <FrameComponentPanel
          kind="header"
          config={{
            schemaVersion: 2,
            enabled: true,
            sticky: false,
            component: { section_def_id: 'component', section_def_version: 1, values: { text: 'x'.repeat(length) } },
          }}
          components={components}
          media={[]}
          pageCount={1}
          canManage
          siteId="site"
          onChange={() => {}}
        />,
      )
      expect(html).toContain('<textarea id="frame-field-text"')
      expect(html).not.toContain('<input id="frame-field-text"')
    }
  })
})

function nodes(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child =>
    isValidElement<Record<string, unknown>>(child) ? [child, ...nodes(child.props.children as ReactNode)] : [],
  )
}

describe('frame source radio handlers', () => {
  it.each(['header', 'footer'] as const)(
    'preserves the selected %s component and its values when its selected source is clicked again',
    kind => {
      state.handlers = true
      const config = {
        schemaVersion: 2 as const,
        enabled: true,
        ...(kind === 'header' ? { sticky: true } : {}),
        component: {
          section_def_id: 'selected-second',
          section_def_version: 2,
          values: { title: 'Keep this edited title', action: { label: 'Contact us', url: '/contact' } },
        },
      }
      const components: FrameComponentChoice[] = ['first', 'selected-second'].map(id => ({
        id,
        name: id,
        placement: kind,
        scope: 'site',
        status: 'active',
        versions: [{ version: 2, slots: [] }],
      }))
      const workspace = {
        ...initial,
        components,
        ...(kind === 'header'
          ? { header: head(config as HeaderConfigV2) }
          : { footer: head(config as FooterConfigV2) }),
      }
      const render = () => {
        state.index = 0
        state.refIndex = 0
        state.effects = []
        return GlobalElementsEditor({
          siteId: 'site',
          siteName: 'Synthetic',
          initial: workspace,
          canManage: true,
          superAdmin: true,
          media: [],
        })
      }
      if (kind === 'footer') {
        const footerTab = nodes(render()).filter(node => node.props.role === 'tab')[1]!
        ;(footerTab.props.onClick as () => void)()
      }
      const switchNode = nodes(render()).find(node => typeof node.type === 'function' && 'onChoose' in node.props)!
      const switchView = (switchNode.type as (props: Record<string, unknown>) => ReactNode)(switchNode.props)
      const selectedRadio = nodes(switchView).find(
        node => node.props.role === 'radio' && node.props['aria-checked'] === true,
      )!
      ;(selectedRadio.props.onClick as () => void)()
      const panel = nodes(render()).find(node => node.type === FrameComponentPanel)!
      expect(panel.props.config).toEqual(config)
    },
  )

  for (const kind of ['header', 'footer'] as const) {
    for (const startingSource of ['preset', 'authored'] as const) {
      it(`keeps both ${kind} drafts across source changes starting from ${startingSource}`, () => {
        state.handlers = true
        const authored = {
          schemaVersion: 2 as const,
          enabled: true,
          ...(kind === 'header' ? { sticky: true } : {}),
          component: { section_def_id: 'authored', section_def_version: 1, values: { title: 'Saved title' } },
        }
        let workspace = {
          ...initial,
          components: [
            {
              id: 'authored',
              name: 'Authored',
              placement: kind,
              scope: 'site' as const,
              status: 'active' as const,
              versions: [{ version: 1, slots: [] }],
            },
          ],
          ...(startingSource === 'authored'
            ? kind === 'header'
              ? { header: head(authored as HeaderConfigV2) }
              : { footer: head(authored as FooterConfigV2) }
            : {}),
        }
        const render = () => {
          state.index = 0
          state.refIndex = 0
          state.effects = []
          return GlobalElementsEditor({
            siteId: 'site',
            siteName: 'Synthetic',
            initial: workspace,
            canManage: true,
            superAdmin: true,
            media: [],
          })
        }
        if (kind === 'footer') {
          ;(nodes(render()).filter(node => node.props.role === 'tab')[1]!.props.onClick as () => void)()
        }
        const choose = (source: 'preset' | 'authored') => {
          const switchNode = nodes(render()).find(node => typeof node.type === 'function' && 'onChoose' in node.props)!
          const view = (switchNode.type as (props: Record<string, unknown>) => ReactNode)(switchNode.props)
          const radio = nodes(view).filter(node => node.props.role === 'radio')[source === 'authored' ? 1 : 0]!
          ;(radio.props.onClick as () => void)()
        }
        const presetInput = () => {
          const panel = nodes(render()).find(node => node.type === PresetFrameFields)!
          const shell = PresetFrameFields(panel.props as Parameters<typeof PresetFrameFields>[0])
          const section = nodes(shell).find(node =>
            kind === 'header' ? node.type === PresetHeaderIdentity : node.type === PresetFooterLayout,
          )
          expect(section).toBeDefined()
          const controls =
            kind === 'header'
              ? PresetHeaderIdentity(section!.props as Parameters<typeof PresetHeaderIdentity>[0])
              : PresetFooterLayout(section!.props as Parameters<typeof PresetFooterLayout>[0])
          const input = nodes(controls).find(
            node => node.props.id === (kind === 'header' ? 'global-site-name' : 'global-footer-name'),
          )
          expect(input).toBeDefined()
          return input!
        }
        const authoredPanel = () => nodes(render()).find(node => node.type === FrameComponentPanel)!
        const edit = (source: 'preset' | 'authored') => {
          choose(source)
          if (source === 'preset')
            (presetInput().props.onChange as (event: { target: { value: string } }) => void)({
              target: { value: 'Edited preset name' },
            })
          else {
            const panel = authoredPanel(),
              config = panel.props.config as HeaderConfigV2 | FooterConfigV2
            ;(panel.props.onChange as (value: unknown) => void)({
              ...config,
              component: { ...config.component, values: { title: 'Edited authored title' } },
            })
          }
        }
        edit(startingSource)
        edit(startingSource === 'authored' ? 'preset' : 'authored')
        choose('preset')
        expect(presetInput().props.value).toBe('Edited preset name')
        choose('authored')
        expect((authoredPanel().props.config as HeaderConfigV2).component.values).toEqual({
          title: 'Edited authored title',
        })

        // A new server version supersedes local alternate drafts, too.
        workspace = {
          ...workspace,
          [kind]: {
            ...workspace[kind],
            revision: 2,
            draftVersionId: 'external-draft',
            draft: { ...authored, component: { ...authored.component, values: { title: 'External saved title' } } },
          },
        }
        render()
        state.effects[0]!()
        render()
        choose('preset')
        expect(presetInput().props.value).toBe('Synthetic')
        choose('authored')
        expect((authoredPanel().props.config as HeaderConfigV2).component.values).toEqual({
          title: 'External saved title',
        })
      })
    }
  }
})
