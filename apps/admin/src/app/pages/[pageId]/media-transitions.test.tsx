import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { ImagePlacementValue, MediaAsset, MediaLibraryResult } from '../../../lib/media-library.ts'

// Deterministic component-handler tests: these exercise real callbacks and
// async outcomes without claiming browser focus/layout or React scheduler QA.
const harness = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as unknown[],
  effects: [] as (() => void)[],
  library: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  bulkDelete: vi.fn(),
  organize: vi.fn(),
  metadata: vi.fn(),
  uploadStatus: vi.fn(),
}))
vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.cells)) harness.cells[index] = typeof initial === 'function' ? initial() : initial
    return [
      harness.cells[index],
      (next: unknown) => {
        harness.cells[index] = typeof next === 'function' ? next(harness.cells[index]) : next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.cells)) harness.cells[index] = { current: initial }
    return harness.cells[index]
  },
  useMemo: (compute: () => unknown) => compute(),
  useId: () => 'picker-title',
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.cells[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
      harness.effects.push(() => {
        previous?.cleanup?.()
        harness.cells[index] = { deps, cleanup: effect() }
      })
    }
  },
}))
vi.mock('../../../components/navigation-guard.ts', () => ({
  useNavigationGuard: vi.fn(),
  requestClientNavigation: () => true,
}))
vi.mock('../../../lib/media-library.ts', async original => ({
  ...(await original<typeof import('../../../lib/media-library.ts')>()),
  fetchMediaLibrary: harness.library,
  deleteMedia: harness.remove,
  restoreMedia: harness.restore,
  bulkDeleteMedia: harness.bulkDelete,
  bulkOrganizeMedia: harness.organize,
  updateMediaMetadata: harness.metadata,
  mediaUploadStatus: harness.uploadStatus,
}))
vi.mock('../../sites/[siteId]/media/replacement-actions.ts', () => ({
  prepareImageReplacement: vi.fn(),
  saveImageReplacement: vi.fn(),
}))
import { MediaPicker } from './media-picker.tsx'
import { MediaWorkspace } from '../../sites/[siteId]/media/media-workspace.tsx'
import { MediaLibraryBrowser } from '../../sites/[siteId]/media/media-library-browser.tsx'
import { MediaBulkSelection } from '../../sites/[siteId]/media/media-bulk-selection.tsx'
import { MediaLifecycleDialogs } from '../../sites/[siteId]/media/media-lifecycle-dialogs.tsx'
import { MediaNotices } from '../../sites/[siteId]/media/media-notices.tsx'

const asset = (id: string, status: MediaAsset['status'] = 'ready'): MediaAsset => ({
  id,
  revision: 1,
  siteId: 'site-one',
  scope: 'site',
  name: `${id}.png`,
  altText: `${id} library description`,
  decorative: false,
  focal: null,
  width: 800,
  height: 600,
  bytes: 1024,
  mimeType: 'image/png',
  status,
  folder: '',
  attribution: '',
  source: '',
  tags: [],
  variants: { original: true, thumbnail: true, card: true, wide: true },
  previewUrl: `/media/${id}/thumbnail`,
  deliveryUrl: `/media/${id}/wide`,
  usedOnItems: 0,
  usedInVersions: 0,
  createdAt: '2026-10-02T10:00:00Z',
  deletedAt: status === 'deleted' ? '2026-10-02T12:00:00Z' : null,
})
const oldAsset = asset('old-image'),
  newAsset = asset('new-upload')
function library(assets: MediaAsset[], page = 1, pageCount = 1): MediaLibraryResult {
  return {
    assets,
    total: assets.length,
    page,
    pageCount,
    pageSize: 48,
    facets: {
      folders: [],
      tags: [],
      scopes: { site: assets.length, shared: 0 },
      statuses: { ready: assets.length, processing: 0, failed: 0, deleted: 0 },
    },
  }
}
function renderPicker(
  value?: Partial<ImagePlacementValue>,
  onChoose = vi.fn(),
  onClose = vi.fn(),
  mode: 'placement' | 'replacement' | 'site-logo' = 'placement',
) {
  harness.cursor = 0
  return MediaPicker({ siteId: 'site-one', initialAssets: [oldAsset], currentValue: value, onChoose, onClose, mode })
}
function renderWorkspace() {
  harness.cursor = 0
  return MediaWorkspace({
    siteId: 'site-one',
    initialResult: library([oldAsset, newAsset]),
    canManage: true,
    canManageShared: false,
  })
}
const mediaRegions = new Set<ReactElement['type']>([
  MediaLibraryBrowser,
  MediaBulkSelection,
  MediaLifecycleDialogs,
  MediaNotices,
])

function visibleChildren(node: ReactElement<Record<string, any>>): ReactNode {
  // Follow the extracted regions to the same real buttons, dialogs and status text.
  if (typeof node.type === 'function' && mediaRegions.has(node.type))
    return (node.type as (props: Record<string, any>) => ReactNode)(node.props)
  return node.props.children
}

function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, any>>(node)) return []
  return [node, ...elements(visibleChildren(node)), ...elements(node.props.footer)]
}
function label(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(label).join('')
  if (isValidElement<Record<string, any>>(node)) return label(visibleChildren(node))
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function button(tree: ReactNode, name: string) {
  const found = elements(tree).find(
    element =>
      (element.type === 'button' || (typeof element.type === 'function' && element.type.name === 'Button')) &&
      (label(element.props.children) === name || element.props['aria-label'] === name),
  )
  expect(found, `Missing button ${name}`).toBeDefined()
  return found!
}
function modal(tree: ReactNode) {
  return elements(tree).find(element => element.props.onConfirm)!
}
function detail(tree: ReactNode) {
  let found = elements(tree).find(element => element.props.onDelete)
  if (!found) {
    const tile = elements(tree).find(element => element.props.className === 'media-asset-open')
    expect(tile, 'Click a tile to open image details').toBeDefined()
    tile!.props.onClick()
    found = elements(renderWorkspace()).find(element => element.props.onDelete)
  }
  return found!
}
function flushEffects() {
  harness.effects.splice(0).forEach(effect => effect())
}
async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}
function deferred<T>() {
  let resolve!: (result: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const current = { media_id: newAsset.id, src: newAsset.deliveryUrl!, alt: 'Placement description', decorative: false }

beforeEach(() => {
  vi.clearAllMocks()
  harness.cursor = 0
  harness.cells = []
  harness.effects = []
  harness.library.mockResolvedValue(library([oldAsset]))
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', {
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    contains: () => false,
  })
})

describe('media picker repeated openings', () => {
  it.each([
    { focus: undefined, mode: 'placement' as const, expected: { x: 0.7, y: 0.3 } },
    { focus: { x: 0.2, y: 0.8 }, mode: 'placement' as const, expected: { x: 0.2, y: 0.8 } },
    { focus: null, mode: 'placement' as const, expected: undefined },
    { focus: undefined, mode: 'replacement' as const, expected: undefined },
  ])(
    'keeps page focus or adopts a library default only for supported placement choices: $mode $focus',
    async ({ focus, mode, expected }) => {
      harness.library.mockResolvedValue(library([{ ...oldAsset, focal: { x: 0.7, y: 0.3 } }]))
      const value = {
          media_id: oldAsset.id,
          src: oldAsset.deliveryUrl!,
          alt: 'Page description',
          decorative: false,
          ...(focus !== undefined ? { focal: focus } : {}),
        },
        onChoose = vi.fn()
      renderPicker(value, onChoose, vi.fn(), mode)
      flushEffects()
      await settle()
      button(renderPicker(value, onChoose, vi.fn(), mode), 'Use this image').props.onClick()
      expect(onChoose).toHaveBeenCalledOnce()
      expect(onChoose.mock.calls[0]![0].src).toBe(oldAsset.deliveryUrl)
      expect(onChoose.mock.calls[0]![0].focal).toEqual(expected)
    },
  )

  it('does not substitute an old image when the current upload is absent from cached props', () => {
    const onChoose = vi.fn()
    const tree = renderPicker(current, onChoose)
    expect(button(tree, 'Use this image').props.disabled).toBe(true)
    button(tree, 'Use this image').props.onClick()
    expect(onChoose).not.toHaveBeenCalled()
    expect(label(tree)).toContain('Finding the current image')
  })
  it('reloads and selects the uploaded image while retaining its placement description', async () => {
    harness.library.mockResolvedValue(library([newAsset, oldAsset]))
    const onChoose = vi.fn()
    renderPicker(current, onChoose)
    flushEffects()
    await settle()
    const tree = renderPicker(current, onChoose)
    expect(button(tree, 'Use this image').props.disabled).toBe(false)
    button(tree, 'Use this image').props.onClick()
    expect(onChoose).toHaveBeenCalledWith({ ...current, variant: 'wide' })
    expect(harness.library).toHaveBeenCalledWith('site-one', expect.objectContaining({ page: 1, pageSize: 48 }))
  })
  it('finds a current upload beyond the first page', async () => {
    harness.library.mockResolvedValueOnce(library([oldAsset], 1, 2)).mockResolvedValueOnce(library([newAsset], 2, 2))
    renderPicker(current)
    flushEffects()
    await settle()
    expect(button(renderPicker(current), 'Use this image').props.disabled).toBe(false)
    expect(harness.library).toHaveBeenCalledTimes(2)
  })
  it('does not overwrite a deliberate replacement with a late library response', async () => {
    const response = deferred<MediaLibraryResult>()
    harness.library.mockReturnValue(response.promise)
    const onChoose = vi.fn()
    let tree = renderPicker(current, onChoose)
    flushEffects()
    elements(tree)
      .find(element => element.props.role === 'option')!
      .props.onClick()
    response.resolve(library([newAsset, oldAsset]))
    await settle()
    tree = renderPicker(current, onChoose)
    button(tree, 'Use this image').props.onClick()
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ media_id: oldAsset.id, alt: oldAsset.altText }))
  })
  it('leaves unavailable or external placements unchanged and offers a retry after refresh failure', async () => {
    harness.library.mockRejectedValue(new Error('Offline'))
    renderPicker(current)
    flushEffects()
    await settle()
    const tree = renderPicker(current)
    expect(button(tree, 'Use this image').props.disabled).toBe(true)
    expect(label(tree)).toContain('The image library could not be fully refreshed')
    expect(button(tree, 'Refresh library').props.disabled).toBe(false)
    const search = elements(tree).find(element => element.type === 'input' && element.props.type === 'search')!
    search.props.onChange({ target: { value: 'No matching image' } })
    expect(label(renderPicker(current))).toContain('Images unavailable')
  })
  it('respects a current governed image supplied as src without media_id', async () => {
    const onChoose = vi.fn()
    const value = { src: oldAsset.deliveryUrl!, alt: 'Custom placement', decorative: false }
    renderPicker(value, onChoose)
    flushEffects()
    await settle()
    const tree = renderPicker(value, onChoose)
    button(tree, 'Use this image').props.onClick()
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ media_id: oldAsset.id, alt: 'Custom placement' }))
  })
  it('replaces stale cached ready status when deletion is on a later server page', async () => {
    harness.library
      .mockResolvedValueOnce(library([newAsset], 1, 2))
      .mockResolvedValueOnce(library([asset(oldAsset.id, 'deleted')], 2, 2))
    const value = { media_id: oldAsset.id, src: oldAsset.deliveryUrl!, alt: 'Existing', decorative: false }
    let tree = renderPicker(value)
    expect(button(tree, 'Use this image').props.disabled).toBe(true)
    flushEffects()
    await settle()
    tree = renderPicker(value)
    expect(button(tree, 'Use this image').props.disabled).toBe(true)
    expect(label(tree)).toContain('cannot be placed yet')
    expect(harness.library).toHaveBeenCalledTimes(2)
  })
  it('withdraws an unavailable cached current image only after all pages are read', async () => {
    const second = deferred<MediaLibraryResult>()
    harness.library.mockResolvedValueOnce(library([newAsset], 1, 2)).mockReturnValueOnce(second.promise)
    const value = { media_id: oldAsset.id, src: oldAsset.deliveryUrl!, alt: 'Existing', decorative: false }
    renderPicker(value)
    flushEffects()
    await settle()
    expect(elements(renderPicker(value)).some(element => element.props.id === `picker-media-${oldAsset.id}`)).toBe(true)
    expect(button(renderPicker(value), 'Use this image').props.disabled).toBe(true)
    second.resolve(library([], 2, 2))
    await settle()
    const tree = renderPicker(value)
    expect(elements(tree).some(element => element.props.id === `picker-media-${oldAsset.id}`)).toBe(false)
    expect(button(tree, 'Use this image').props.disabled).toBe(true)
  })
  it('does not apply an image after synchronous dismissal before unmount cleanup', () => {
    const onChoose = vi.fn()
    const onClose = vi.fn()
    const tree = renderPicker(undefined, onChoose, onClose)
    button(tree, 'Cancel').props.onClick()
    button(tree, 'Use this image').props.onClick()
    expect(onClose).toHaveBeenCalledOnce()
    expect(onChoose).not.toHaveBeenCalled()
  })
})

describe('media mutation confirmations', () => {
  it('sends a single delete and locks its modal against repeated confirm and cancel', async () => {
    let tree = renderWorkspace()
    detail(tree).props.onDelete()
    tree = renderWorkspace()
    const remove = deferred<MediaAsset>()
    harness.remove.mockReturnValue(remove.promise)
    const confirmation = modal(tree)
    confirmation.props.onConfirm()
    confirmation.props.onConfirm()
    confirmation.props.onCancel()
    expect(harness.remove).toHaveBeenCalledOnce()
    expect(modal(renderWorkspace()).props.pending).toBe(true)
    remove.resolve(asset(oldAsset.id, 'deleted'))
    await settle()
    expect(modal(renderWorkspace())).toBeUndefined()
  })
  it('reports confirmed deletion honestly when only the list refresh fails', async () => {
    let tree = renderWorkspace()
    detail(tree).props.onDelete()
    tree = renderWorkspace()
    harness.remove.mockResolvedValue(asset(oldAsset.id, 'deleted'))
    harness.library.mockRejectedValue(new Error('Offline'))
    modal(tree).props.onConfirm()
    await settle()
    tree = renderWorkspace()
    expect(label(tree)).toContain('The image was deleted, but the library could not be refreshed')
    expect(detail(tree).props.asset.status).toBe('deleted')
    harness.library.mockResolvedValue(library([asset(oldAsset.id, 'deleted')]))
    button(tree, 'Refresh library').props.onClick()
    await settle()
    expect(harness.remove).toHaveBeenCalledOnce()
    expect(label(renderWorkspace())).not.toContain('could not be refreshed')
  })
  it('sends a single bulk delete and keeps confirmed statuses when refresh fails', async () => {
    let tree = renderWorkspace()
    const images = elements(tree).filter(element => element.props.type === 'checkbox')
    expect(images).toHaveLength(2)
    for (const item of images) item.props.onChange()
    tree = renderWorkspace()
    button(tree, ' Delete selected').props.onClick()
    tree = renderWorkspace()
    const remove = deferred<MediaAsset[]>()
    harness.bulkDelete.mockReturnValue(remove.promise)
    harness.library.mockRejectedValue(new Error('Offline'))
    modal(tree).props.onConfirm()
    modal(tree).props.onConfirm()
    expect(harness.bulkDelete).toHaveBeenCalledOnce()
    expect(modal(renderWorkspace()).props.pending).toBe(true)
    remove.resolve([asset(oldAsset.id, 'deleted'), asset(newAsset.id, 'deleted')])
    await settle()
    tree = renderWorkspace()
    expect(label(tree)).toContain('The selected images were deleted, but the library could not be refreshed')
    expect(detail(tree).props.asset.status).toBe('deleted')
  })
  it('describes an unconfirmed network failure without falsely claiming the action did not happen', async () => {
    let tree = renderWorkspace()
    detail(tree).props.onDelete()
    tree = renderWorkspace()
    harness.remove.mockRejectedValue(new Error('Connection interrupted'))
    modal(tree).props.onConfirm()
    await settle()
    expect(label(renderWorkspace())).toContain('The media action could not be confirmed')
    expect(detail(renderWorkspace()).props.asset.status).toBe('ready')
  })
})

describe('media metadata save boundary', () => {
  function metadataForm(onSaved = vi.fn(async () => {})) {
    const workspace = renderWorkspace()
    const component = detail(workspace)
    const detailTree = (component.type as Function)({ ...component.props, onSaved }) as ReactNode
    const form = elements(detailTree).find(element => element.props.asset && element.props.onSaved)!
    return (form.type as Function)(form.props) as ReactElement<Record<string, any>>
  }
  it('freezes metadata fields and prevents repeated submits until save completes', async () => {
    const save = deferred<MediaAsset>()
    harness.metadata.mockReturnValue(save.promise)
    const onSaved = vi.fn(async () => {})
    const form = metadataForm(onSaved)
    form.props.onSubmit({ preventDefault: vi.fn() })
    form.props.onSubmit({ preventDefault: vi.fn() })
    expect(harness.metadata).toHaveBeenCalledOnce()
    const pending = metadataForm(onSaved)
    expect(
      elements(pending).find(
        element => element.type === 'fieldset' && element.props['aria-label'] === 'Image metadata',
      )!.props.disabled,
    ).toBe(true)
    expect(pending.props['aria-busy']).toBe(true)
    expect(button(renderWorkspace(), 'Saving…').props.disabled).toBe(true)
    save.resolve({ ...oldAsset, revision: 2 })
    await settle()
    expect(onSaved).toHaveBeenCalledOnce()
    expect(
      elements(metadataForm(onSaved)).find(
        element => element.type === 'fieldset' && element.props['aria-label'] === 'Image metadata',
      )!.props.disabled,
    ).toBe(false)
  })
  it('does not misreport a confirmed metadata save when refreshing its parent fails', async () => {
    harness.metadata.mockResolvedValue({ ...oldAsset, revision: 2 })
    const onSaved = vi.fn(async () => {
      throw new Error('Refresh failed')
    })
    metadataForm(onSaved).props.onSubmit({ preventDefault: vi.fn() })
    await settle()
    expect(label(metadataForm(onSaved))).toContain('The metadata was saved, but the library could not be refreshed')
  })
})

it('uses the site-name description contract for logos only after verifying the ready image', async () => {
  const value = { media_id: oldAsset.id, alt: '', decorative: false },
    choose = vi.fn()
  let tree = renderPicker(value, choose, vi.fn(), 'site-logo')
  expect(button(tree, 'Use this image').props.disabled).toBe(true)
  button(tree, 'Use this image').props.onClick()
  expect(choose).not.toHaveBeenCalled()
  flushEffects()
  await settle()
  tree = renderPicker(value, choose, vi.fn(), 'site-logo')
  expect(button(tree, 'Use this image').props.disabled).toBe(false)
  expect(label(tree)).toContain('The logo description is set in Header & menu')
  button(tree, 'Use this image').props.onClick()
  expect(choose).toHaveBeenCalledWith(expect.objectContaining({ media_id: oldAsset.id, alt: '' }))
  expect(oldAsset.altText).toBe('old-image library description')
  expect(button(renderPicker(value, choose), 'Use this image').props.disabled).toBe(true)
})
