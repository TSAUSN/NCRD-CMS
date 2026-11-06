import { createPortal } from 'react-dom'
import { CanvasMenuAdd, type CanvasMenuAddState } from '../../../components/canvas-menu-add.tsx'
import { createRoot, type Root } from 'react-dom/client'
import { useMemo, useRef } from 'react'
import { CanvasChrome, type CanvasHover } from './canvas-chrome.tsx'
import { parseCanvasControls, type CanvasControls } from './canvas-controls-contract.ts'
import '../../../styles/tokens.css'
import './isolated-canvas-ui.css'
export type IsolatedCanvasPeer = {
  origin: string
  channel: string
  documentId: string
  post: (type: string, detail: Record<string, unknown>) => void
  timeout: typeof window.setTimeout
}

function Controls({ surface, state, peer }: { surface: HTMLElement; state: CanvasControls; peer: IsolatedCanvasPeer }) {
  const viewport = useRef<HTMLElement>(surface),
    frame = useRef<HTMLIFrameElement>(null),
    toolbar = useRef<HTMLDivElement>(null),
    zoom = useRef<HTMLDivElement>(null)
  const local = useMemo(() => ({ document, element: surface }), [surface])
  const slotsFor = useMemo(
    () => (section: CanvasControls['sections'][number]) => state.fields[state.sections.indexOf(section)] ?? [],
    [state],
  )
  const hovered = useMemo(() => (item: CanvasHover | null) => peer.post('cms:hover-card', { item }), [peer])
  return (
    <CanvasChrome
      preserveLayout={state.preserveLayout}
      mode="canvas-only"
      surface={local}
      frame={frame}
      viewport={viewport}
      toolbarHost={toolbar}
      zoomControl={zoom}
      ready={1}
      scale={state.scale}
      sections={state.sections}
      selected={state.selected}
      selectedSlot={state.slot}
      slots={state.selected === null ? [] : (state.fields[state.selected] ?? [])}
      name={section => section.label ?? 'Section'}
      slotsFor={slotsFor}
      canReset={state.canReset}
      selectedItem={state.listItem}
      onHover={hovered}
      onAdd={at => peer.post('cms:add-section', { at })}
      onAction={(action, section) => peer.post('cms:section-action', { action, section })}
      onRepeat={(section, field, action, key) =>
        peer.post('cms:repeat-action', { section, field: field.id, action, ...(key ? { key } : {}) })
      }
      onListAdd={readerKey => peer.post('cms:add-list-item', { readerKey })}
      onListAction={action => peer.post('cms:list-action', { action })}
    />
  )
}
/** Actual shared controls run against the child document. The parent receives
 * only closed intents, and keeps all write commands, history and permissions. */
export function installCanvasControls(peer: IsolatedCanvasPeer): void {
  let state: CanvasControls | null = null,
    menu: CanvasMenuAddState | null = null,
    root: Root | null = null,
    surface: HTMLElement | null = null,
    layer: HTMLElement | null = null
  const size = () => {
    if (!surface) return
    const scale = state?.scale ?? menu?.scale ?? 1
    surface.style.width = `${innerWidth * scale}px`
    surface.style.height = `${innerHeight * scale}px`
    surface.style.transform = `scale(${1 / scale})`
  }
  const render = () => {
    if (!state && !menu) {
      root?.render(null)
      return
    }
    if (!surface) {
      layer = document.createElement('cms-editor-layer')
      surface = document.createElement('cms-editor-ui')
      layer.append(surface)
      document.body.append(layer)
      root = createRoot(surface)
    }
    const header = document.querySelector('[data-cms-frame="header"]')
    size()
    root!.render(
      <>
        {state && <Controls surface={surface} state={state} peer={peer} />}
        {menu &&
          header &&
          createPortal(<CanvasMenuAdd {...menu} onAdd={id => peer.post('cms:add-menu-page', { id })} />, header)}
      </>,
    )
  }
  window.addEventListener('message', event => {
    if (
      event.source !== window.parent ||
      event.origin !== peer.origin ||
      event.data?.channel !== peer.channel ||
      event.data?.documentId !== peer.documentId
    )
      return
    if (event.data.type === 'cms:menu-add') {
      const value = event.data.menu
      if (value === null) menu = null
      else if (
        value &&
        typeof value === 'object' &&
        typeof value.disabled === 'boolean' &&
        typeof value.scale === 'number' &&
        Number.isFinite(value.scale) &&
        value.scale >= 0.05 &&
        value.scale <= 4 &&
        Array.isArray(value.options) &&
        value.options.length <= 500 &&
        value.options.every(
          (option: { id?: unknown; title?: unknown }) =>
            option &&
            typeof option.id === 'string' &&
            /^[0-9a-f-]{36}$/.test(option.id) &&
            typeof option.title === 'string' &&
            option.title.length <= 2000,
        )
      )
        menu = {
          scale: value.scale,
          disabled: value.disabled,
          options: value.options.map((option: { id: string; title: string }) => ({
            id: option.id,
            title: option.title,
          })),
        }
      else return
      if (document.readyState !== 'loading') render()
      return
    }
    if (
      event.data.type === 'cms:list-action-request' &&
      state?.selected !== null &&
      state?.listItem &&
      ['edit', 'hide', 'up', 'down'].includes(event.data.action)
    ) {
      const item = state.listItem,
        keys = [
          ...document.querySelectorAll<HTMLElement>('[data-cms-section="' + state.selected + '"] [data-cms-entry]'),
        ]
          .filter(node => node.dataset.cmsReader === item.readerKey && node.dataset.cmsListField === item.field)
          .map(node => node.dataset.cmsEntry!)
      peer.post('cms:list-action', { action: event.data.action, keys: [...new Set(keys)] })
      return
    }
    if (event.data.type !== 'cms:canvas-controls') return
    if (event.data.controls === null) {
      state = null
      if (document.readyState !== 'loading') render()
      return
    }
    const parsed = parseCanvasControls(event.data.controls)
    if (!parsed) return
    state = parsed
    if (document.readyState !== 'loading') render()
  })
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => peer.timeout(render, 0), { once: true })
  window.addEventListener('resize', size)
  window.addEventListener(
    'pagehide',
    () => {
      root?.unmount()
      layer?.remove()
    },
    { once: true },
  )
}
