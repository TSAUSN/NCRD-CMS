import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CollectionWorkspace } from '../../../../lib/collection-queries.ts'

// This is a component-handler harness, not a browser or React scheduling test.
// It deliberately retains the old render's event handlers while an action is
// unresolved, covering the same-tick interval before `pending` is committed.
const harness = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as unknown[],
  pending: false,
  effects: [] as (() => void)[],
  tasks: [] as Promise<void>[],
  refresh: vi.fn(),
  push: vi.fn(),
  requestNavigation: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
  saveSchema: vi.fn(),
  publishSchema: vi.fn(),
  submit: vi.fn(),
  create: vi.fn(),
  uploadDocument: vi.fn(),
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
  useTransition: () => [
    harness.pending,
    (work: () => Promise<void>) => {
      harness.pending = true
      const task = work().finally(() => {
        harness.pending = false
      })
      harness.tasks.push(task)
    },
  ],
}))
vi.mock('../../../../components/navigation-guard.ts', () => ({
  useNavigationGuard: () => {},
  requestClientNavigation: harness.requestNavigation,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh, push: harness.push }) }))
vi.mock('next/link', () => ({ default: 'a' }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('../../../actions/collections.ts', () => ({
  saveCollectionEntries: harness.save,
  publishCollectionEntries: harness.publish,
  saveCollectionSchema: harness.saveSchema,
  publishCollectionSchema: harness.publishSchema,
  createCollection: harness.create,
}))
vi.mock('../../../collection-review-actions.ts', () => ({ submitCollectionReview: harness.submit }))
// The picker's debounced library search outlives these handler-level tests;
// leave it loading so a late timer cannot write into the next test's state.
vi.mock('../../../../lib/document-library.ts', () => ({
  uploadSiteDocument: harness.uploadDocument,
  fetchDocuments: () => new Promise(() => {}),
}))

import { CollectionsWorkspace } from './collections-workspace.tsx'
import { CollectionRecordList } from './collection-record-list.tsx'

const model = {
  fields: [{ key: 'title', label: 'Title', type: 'text' as const, required: true }],
  presentation: {
    schemaVersion: 1 as const,
    titleField: 'title',
    subtitleField: null,
    imageField: null,
    groupField: null,
  },
}
function workspace(id = 'collection-one'): CollectionWorkspace {
  const summary = {
    id,
    slug: id,
    readerKey: 'items',
    name: id,
    source: 'admin' as const,
    revision: 3,
    entryRevision: 2,
    publishedEntryRevision: 1,
    totalEntries: 2,
    liveEntries: 2,
    changedEntries: 1,
    draftSchemaVersionId: 'schema-draft',
    publishedSchemaVersionId: 'schema-live',
  }
  return {
    collections: [summary, { ...summary, id: 'collection-two', name: 'Other collection' }],
    selected: {
      ...summary,
      draft: model,
      published: model,
      entries: ['First', 'Second'].map((title, index) => ({
        id: `item-${index}`,
        schemaVersionId: 'schema-draft',
        stableKey: title.toLowerCase(),
        values: { title },
        revision: 1,
        sortIndex: index,
        publishedSortIndex: index,
        publishedValues: { title },
        archived: false,
        publishedArchived: false,
      })),
    },
  }
}
let initial: CollectionWorkspace
function render() {
  harness.cursor = 0
  return CollectionsWorkspace({
    siteId: 'site-one',
    siteName: 'Site',
    initial,
    rights: { editEntries: true, manageSchema: true, publish: true },
    media: [],
  })
}
function flushEffects() {
  harness.effects.splice(0).forEach(effect => effect())
}
function elements(node: ReactNode): ReactElement<Record<string, any>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, any>>(node)) return []
  // Traverse the real rows after their extraction. Keep other components
  // shallow so the harness still controls the workspace's pending handlers.
  if (node.type === CollectionRecordList)
    return [node, ...elements(CollectionRecordList(node.props as Parameters<typeof CollectionRecordList>[0]))]
  return [node, ...elements(node.props.children), ...elements(node.props.footer)]
}
function label(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(label).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return label(node.props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
function button(tree: ReactNode, name: string) {
  const result = elements(tree).find(
    element =>
      (element.type === 'button' || (typeof element.type === 'function' && element.type.name === 'Button')) &&
      (label(element.props.children) === name || element.props['aria-label'] === name),
  )
  expect(result, `Missing button ${name}`).toBeDefined()
  return result!
}
function titleField(tree: ReactNode) {
  let field = elements(tree).find(element => element.props.field?.key === 'title')
  if (!field) {
    const row = elements(tree).find(
      element => element.type === 'button' && String(element.props['aria-label']).startsWith('Edit '),
    )
    expect(row, 'An item opens in the drawer').toBeDefined()
    row!.props.onClick({ currentTarget: { focus: () => {} } })
    field = elements(render()).find(element => element.props.field?.key === 'title')
  }
  return field!
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
const success = { ok: true as const, revision: 3, versionId: null, message: 'Saved' }

beforeEach(() => {
  vi.clearAllMocks()
  harness.requestNavigation.mockReturnValue(true)
  harness.cursor = 0
  harness.cells = []
  harness.effects = []
  harness.tasks = []
  harness.pending = false
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true) })
  initial = workspace()
  render()
  flushEffects()
})

describe('collection workspace pending mutation boundary', () => {
  it('reviews publication before invoking the command and keeps cancellation private', () => {
    let tree = render()
    button(tree, 'Publish list').props.onClick({ currentTarget: { focus: () => {} } })
    expect(harness.publish).not.toHaveBeenCalled()
    tree = render()
    const dialog = elements(tree).find(element => element.props.confirmLabel === 'Publish this list')!
    expect(dialog.props.title).toBe('Publish collection-one?')
    dialog.props.onCancel()
    expect(elements(render()).some(element => element.props.confirmLabel === 'Publish this list')).toBe(false)
    expect(harness.publish).not.toHaveBeenCalled()
  })

  it('prevents duplicate publication and keeps failed confirmation available to retry', async () => {
    let tree = render()
    button(tree, 'Publish list').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    const dialog = elements(tree).find(element => element.props.confirmLabel === 'Publish this list')!
    const publish = deferred<typeof success>()
    harness.publish.mockReturnValue(publish.promise)
    dialog.props.onConfirm()
    dialog.props.onConfirm()
    expect(harness.publish).toHaveBeenCalledOnce()
    publish.reject(new Error('Offline'))
    await Promise.all(harness.tasks)
    tree = render()
    const retry = elements(tree).find(element => element.props.confirmLabel === 'Publish this list')!
    expect(retry.props.error).toContain('could not be confirmed')
    harness.publish.mockResolvedValue(success)
    retry.props.onConfirm()
    await Promise.all(harness.tasks)
    expect(elements(render()).some(element => element.props.confirmLabel === 'Publish this list')).toBe(false)
  })

  it('disables every entry mutation and workspace switch while a save is pending', async () => {
    let tree = render()
    button(tree, 'Add item').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    titleField(tree).props.onChange('Third')
    tree = render()
    const save = deferred<typeof success>()
    harness.save.mockReturnValue(save.promise)
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    for (const name of [
      'Add item',
      'Duplicate',
      'Hide from list',
      'Import / Export CSV',
      'List settings',
      'New list',
      'New list',
      'Move Third up',
      'Move Third down',
    ]) {
      expect(button(tree, name).props.disabled, name).toBe(true)
    }
    const rows = elements(tree).filter(element => element.type === 'article' && element.props.onDragStart)
    expect(rows).toHaveLength(3)
    expect(rows.every(element => !element.props.draggable)).toBe(true)
    expect(
      elements(tree).find(element => element.type === 'input' && element.props.value === 'new-item')?.props.disabled,
    ).toBe(true)
    expect(titleField(tree).props.disabled).toBe(true)
    expect(
      elements(tree).find(element => element.type === 'select' && element.props.value === 'collection-one')?.props
        .disabled,
    ).toBe(true)
    expect(
      elements(tree).find(element => element.props.href === '/sites/site-one/content?all=1')?.props['aria-disabled'],
    ).toBe(true)
    expect(renderToStaticMarkup(tree)).toContain('disabled=""')
    save.resolve(success)
    await Promise.all(harness.tasks)
  })

  it('blocks stale-render edits, reorder, dialogs and repeat submission before pending renders', async () => {
    let tree = render()
    titleField(tree).props.onChange('Edited title')
    tree = render()
    const save = deferred<typeof success>()
    harness.save.mockReturnValue(save.promise)
    const sourceDrag = elements(tree).find(element => element.type === 'article' && element.props.onDragStart)!
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', types: ['application/x-cms-list-item'] }
    const dragEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      clientX: 40,
      clientY: 20,
      currentTarget: { closest: () => null },
      dataTransfer,
    }
    sourceDrag.props.onDragStart(dragEvent)
    expect(dataTransfer.setData).toHaveBeenCalledOnce()
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    const savedSnapshot = harness.save.mock.calls[0]![0].get('entries')
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    button(tree, 'Add item').props.onClick({ currentTarget: { focus: () => {} } })
    button(tree, 'Duplicate').props.onClick({ currentTarget: { focus: () => {} } })
    button(tree, 'Hide from list').props.onClick({ currentTarget: { focus: () => {} } })
    button(tree, 'Move Edited title down').props.onClick({ currentTarget: { focus: () => {} } })
    titleField(tree).props.onChange('Too late')
    for (const name of ['Import / Export CSV', 'List settings', 'New list'])
      button(tree, name).props.onClick({ currentTarget: { focus: () => {} } })
    elements(tree)
      .find(element => element.type === 'article' && element.props.onDrop)
      ?.props.onDrop(dragEvent)
    const link = elements(tree).find(element => element.props.href === '/sites/site-one/content?all=1')!
    const event = { preventDefault: vi.fn() }
    link.props.onClick(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(harness.save).toHaveBeenCalledOnce()
    expect(savedSnapshot).toContain('Edited title')
    tree = render()
    expect(titleField(tree).props.entry.values.title).toBe('Edited title')
    expect(elements(tree).filter(element => element.type === 'article' && element.props.onDrop)).toHaveLength(2)
    expect(
      elements(tree).some(element => element.props.onImport || element.props.onSave || element.props.onResult),
    ).toBe(false)
    save.resolve(success)
    await Promise.all(harness.tasks)
    expect(harness.refresh).not.toHaveBeenCalled()
  })

  it('ignores a completed save after the route changes to another collection', async () => {
    const save = deferred<typeof success>()
    harness.save.mockReturnValue(save.promise)
    let tree = render()
    titleField(tree).props.onChange('Old collection edit')
    tree = render()
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    initial = workspace('collection-two')
    render()
    flushEffects()
    save.resolve(success)
    await Promise.all(harness.tasks)
    tree = render()
    expect(titleField(tree).props.entry.values.title).toBe('First')
    expect(harness.refresh).not.toHaveBeenCalled()
    expect(elements(tree).some(element => element.props.className === 'notice notice-ok')).toBe(false)
  })

  it('does not let schema changes discard entry edits that were already unsaved', () => {
    let tree = render()
    titleField(tree).props.onChange('Unsaved entry')
    tree = render()
    expect(button(tree, 'List settings').props.disabled).toBe(true)
    expect(button(tree, 'Publish field changes').props.disabled).toBe(true)
    button(tree, 'List settings').props.onClick({ currentTarget: { focus: () => {} } })
    button(tree, 'Publish field changes').props.onClick({ currentTarget: { focus: () => {} } })
    expect(harness.publishSchema).not.toHaveBeenCalled()
    expect(label(render())).toContain('Save your item changes before changing or publishing list fields.')
    expect(elements(render()).some(element => element.props.onSave)).toBe(false)
  })

  it('freezes the schema designer inputs during a save and accepts only one request', async () => {
    let tree = render()
    button(tree, 'List settings').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    function designer() {
      const parent = render()
      const element = elements(parent).find(element => element.props.onSave)!
      return (element.type as Function)(element.props) as ReactElement
    }
    let form = designer()
    elements(form)
      .find(element => element.type === 'input' && element.props.value === 'Title')!
      .props.onChange({ target: { value: 'Heading' } })
    form = designer()
    const save = deferred<typeof success>()
    harness.saveSchema.mockReturnValue(save.promise)
    button(form, 'Save fields').props.onClick({ currentTarget: { focus: () => {} } })
    button(form, 'Save fields').props.onClick({ currentTarget: { focus: () => {} } })
    form = designer()
    expect(elements(form).find(element => element.type === 'fieldset')!.props.disabled).toBe(true)
    expect(button(form, 'Saving…').props.disabled).toBe(true)
    expect(harness.saveSchema).toHaveBeenCalledOnce()
    save.resolve(success)
    await Promise.all(harness.tasks)
  })

  it('can cancel collection creation without a late navigation or a duplicate request', async () => {
    let tree = render()
    button(tree, 'New list').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    function createDialog() {
      const parent = render()
      const element = elements(parent).find(element => element.props.onResult)!
      return (element.type as Function)(element.props) as ReactElement<Record<string, any>>
    }
    let form = createDialog()
    flushEffects()
    const creating = deferred<{ ok: true; collectionId: string }>()
    harness.create.mockReturnValue(creating.promise)
    button(form, 'Create list').props.onClick({ currentTarget: { focus: () => {} } })
    button(form, 'Create list').props.onClick({ currentTarget: { focus: () => {} } })
    expect(harness.create).toHaveBeenCalledOnce()
    form = createDialog()
    expect(
      elements(form)
        .filter(element => element.type === 'input')
        .every(element => element.props.disabled),
    ).toBe(true)
    form.props.onClose()
    creating.resolve({ ok: true, collectionId: 'new-collection' })
    await creating.promise
    await Promise.resolve()
    expect(harness.push).not.toHaveBeenCalled()
    expect(harness.refresh).toHaveBeenCalledOnce()
    expect(label(render())).toContain('The list was created after you closed the window.')
  })

  it('asks before opening a creation flow that would replace an unsaved collection', () => {
    let tree = render()
    titleField(tree).props.onChange('Unsaved entry')
    tree = render()
    harness.requestNavigation.mockReturnValue(false)
    button(tree, 'New list').props.onClick({ currentTarget: { focus: () => {} } })
    expect(harness.requestNavigation).toHaveBeenCalledOnce()
    expect(harness.requestNavigation).toHaveBeenCalledWith(expect.any(Function))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(elements(render()).some(element => element.props.onResult)).toBe(false)
    expect(titleField(render()).props.entry.values.title).toBe('Unsaved entry')
  })

  it('never inserts a PDF link when a cancelled upload finishes before effect cleanup', async () => {
    initial.selected!.draft = {
      ...model,
      fields: [...model.fields, { key: 'download', label: 'Download', type: 'url', required: false }],
    }
    initial.selected!.revision += 1
    render()
    flushEffects()
    let tree = render()
    titleField(tree)
    tree = render()
    elements(tree)
      .find(element => element.props.field?.key === 'download')!
      .props.onChooseDocument()
    function documentDialog() {
      const parent = render()
      const element = elements(parent).find(element => element.props.onUploaded)!
      return (element.type as Function)(element.props) as ReactElement<Record<string, any>>
    }
    const form = documentDialog()
    flushEffects()
    const uploading = deferred<{ id: string; originalName: string; bytes: number; url: string }>()
    harness.uploadDocument.mockReturnValue(uploading.promise)
    const file = new File(['%PDF-1.7'], 'resource.pdf', { type: 'application/pdf' })
    elements(form)
      .find(element => element.props.type === 'file')!
      .props.onChange({ target: { files: [file], value: 'resource.pdf' } })
    form.props.onClose()
    uploading.resolve({ id: 'pdf-one', originalName: 'resource.pdf', bytes: 8, url: '/assets/pdf-one' })
    await uploading.promise
    await Promise.resolve()
    tree = render()
    expect(titleField(tree).props.entry.values.download).toBeUndefined()
    elements(tree)
      .find(element => element.props.field?.key === 'download')!
      .props.onChooseDocument()
    tree = render()
    expect(elements(tree).find(element => element.props.onUploaded)!.props.documents).toEqual([
      { id: 'pdf-one', originalName: 'resource.pdf', bytes: 8, url: '/assets/pdf-one' },
    ])
  })

  it('derives a required entry resave from persisted schema pins on a fresh opening', () => {
    initial.selected!.entries[0]!.schemaVersionId = 'older-schema'
    initial.selected!.revision += 1
    render()
    flushEffects()
    const tree = render()
    const footer = elements(tree).find(
      element => typeof element.type === 'function' && element.type.name === 'RecordBoard',
    )!.props.footer
    expect(label(footer)).toContain('Apply saved field changes')
    expect(label(footer)).not.toContain('Unsaved changes')
    expect(button(tree, 'Save draft').props.disabled).toBe(false)
    expect(button(tree, 'Publish list').props.disabled).toBe(true)
  })

  it('keeps entry migration available after a schema refresh without an unrelated text edit', async () => {
    let tree = render()
    button(tree, 'List settings').props.onClick({ currentTarget: { focus: () => {} } })
    tree = render()
    const designer = elements(tree).find(element => element.props.onSave)!
    harness.saveSchema.mockResolvedValue({ ...success, revision: 4, versionId: 'new-schema' })
    designer.props.onSave(model)
    await Promise.all(harness.tasks)
    initial.selected!.revision = 4
    initial.selected!.draftSchemaVersionId = 'new-schema'
    render()
    flushEffects()
    tree = render()
    expect(button(tree, 'Save draft').props.disabled).toBe(false)
    harness.save.mockResolvedValue(success)
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    await Promise.all(harness.tasks)
    initial.selected!.entryRevision = 3
    initial.selected!.entries.forEach(entry => {
      entry.schemaVersionId = 'new-schema'
    })
    render()
    flushEffects()
    tree = render()
    expect(button(tree, 'Save draft').props.disabled).toBe(true)
    expect(button(tree, 'Publish list').props.disabled).toBe(false)
    expect(
      JSON.parse(harness.save.mock.calls[0]![0].get('entries')).map((entry: { values: unknown }) => entry.values),
    ).toEqual([{ title: 'First' }, { title: 'Second' }])
  })

  it('does not require re-saving archived records pinned to an older schema', () => {
    initial.selected!.entries[1]!.schemaVersionId = 'older-schema'
    initial.selected!.entries[1]!.archived = true
    initial.selected!.revision += 1
    render()
    flushEffects()
    expect(button(render(), 'Save draft').props.disabled).toBe(true)
  })

  it('keeps the draft and re-enables retry after an action rejects', async () => {
    const save = deferred<typeof success>()
    harness.save.mockReturnValue(save.promise)
    let tree = render()
    titleField(tree).props.onChange('Keep this draft')
    tree = render()
    button(tree, 'Save draft').props.onClick({ currentTarget: { focus: () => {} } })
    save.reject(new Error('Network down'))
    await Promise.all(harness.tasks)
    tree = render()
    expect(titleField(tree).props.entry.values.title).toBe('Keep this draft')
    expect(label(tree)).toContain('The action could not be confirmed')
    expect(button(tree, 'Save draft').props.disabled).toBe(false)
    expect(button(tree, 'Add item').props.disabled).toBe(false)
    expect(harness.refresh).not.toHaveBeenCalled()
  })
})
