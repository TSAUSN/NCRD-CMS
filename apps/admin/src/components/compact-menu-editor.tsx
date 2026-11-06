'use client'
import { useState } from 'react'
import { NavTree, NavUrl, type NavNode } from '@cms/schema'
import { canAppendMenuItem, dropMenuItem, editMenuItem, moveMenuItem } from '../lib/menu-editing.ts'
import { Badge, Button, Card, Dialog, Field, Menu, SegmentedControl, SearchableSelect } from './ui/index.ts'
import { IconDrag, IconMore, IconPlus } from './icons.tsx'
import styles from './workspace.module.css'
type PageChoice = { id: string; title: string; path: string; published: boolean }
type Editing = { path: string; snapshot: NavTree; fresh: boolean; kind: 'page' | 'url' | 'group' }
export function CompactMenuEditor({
  tree,
  pages,
  disabled,
  onChange,
  onEditing,
}: {
  tree: NavTree
  pages: PageChoice[]
  disabled: boolean
  onChange: (tree: NavTree) => void
  onEditing: (editing: boolean) => void
}) {
  const [editing, setEditing] = useState<Editing | null>(null),
    [removing, setRemoving] = useState<{ path: string; label: string } | null>(null),
    [labelEdited, setLabelEdited] = useState(false),
    [drop, setDrop] = useState<string | null>(null)
  const node = editing
    ? editing.path
        .split('.')
        .map(Number)
        .reduce<NavNode | undefined>((found, at, index) => (index === 0 ? tree[at] : found?.children?.[at]), undefined)
    : undefined
  const patch = (fn: (node: NavNode) => NavNode) => {
    if (editing) onChange(editMenuItem(tree, editing.path, fn))
  }
  function begin(path: string, fresh = false, kind?: Editing['kind']) {
    const indices = path.split('.').map(Number),
      item = indices.length === 1 ? tree[indices[0]!] : tree[indices[0]!]!.children![indices[1]!]!
    setEditing({
      path,
      snapshot: structuredClone(tree),
      fresh,
      kind: kind ?? ((item as NavNode | undefined)?.dropdownGroup ? 'group' : (item?.target.type ?? 'page')),
    })
    setLabelEdited(
      Boolean(
        item?.label &&
        item.label !==
          pages.find(page => item?.target.type === 'page' && page.id === item.target.page_id)?.title.slice(0, 80),
      ),
    )
    onEditing(true)
  }
  function close(cancel: boolean) {
    if (cancel && editing) onChange(editing.snapshot)
    setEditing(null)
    onEditing(false)
  }
  function add() {
    if (!canAppendMenuItem(tree)) return
    const snapshot = structuredClone(tree),
      path = String(tree.length)
    onChange([...tree, { label: '', target: { type: 'url', url: '' }, visible: true }])
    setEditing({ path, snapshot, fresh: true, kind: 'page' })
    setLabelEdited(false)
    onEditing(true)
  }
  function kind(value: Editing['kind']) {
    if (!editing) return
    setEditing({ ...editing, kind: value })
    patch(current => {
      const next = { ...current }
      delete next.dropdownGroup
      if (value === 'group') return { ...next, target: { type: 'url', url: '/' }, dropdownGroup: true, children: [] }
      if (value === 'page') return { ...next, target: { type: 'page', page_id: '' } }
      return { ...next, target: { type: 'url', url: '' } }
    })
  }
  function row(item: NavNode, path: string, index: number, total: number, nested = false) {
    const target = item.target,
      destination = item.dropdownGroup
        ? 'Dropdown'
        : target.type === 'page'
          ? (pages.find(page => page.id === target.page_id)?.path ?? 'Page unavailable')
          : target.url
    return (
      <li
        key={path}
        className={styles.menuRow}
        data-nested={nested || undefined}
        data-hidden={!item.visible || undefined}
        data-drop-inside={drop === path || undefined}
        draggable={!disabled}
        onDragStart={event => event.dataTransfer.setData('application/x-cms-menu', path)}
        onDragEnd={() => setDrop(null)}
        onDragOver={event => {
          if (disabled || !event.dataTransfer.types.includes('application/x-cms-menu')) return
          event.preventDefault()
          setDrop(!nested && event.clientX > event.currentTarget.getBoundingClientRect().left + 60 ? path : null)
        }}
        onDrop={event => {
          event.preventDefault()
          if (disabled) return
          onChange(dropMenuItem(tree, event.dataTransfer.getData('application/x-cms-menu'), path, drop === path))
          setDrop(null)
        }}
      >
        <IconDrag size={10} />
        <Button
          variant="tertiary"
          className={styles.itemButton}
          disabled={disabled}
          title={item.label}
          onClick={() => begin(path)}
        >
          <span>
            {nested ? item.label : <strong>{item.label}</strong>}
            {!item.visible && ' · Hidden'}
          </span>
        </Button>
        <span className={styles.menuDestination} title={destination}>
          {destination}
        </span>
        <Badge tone={item.dropdownGroup ? 'neutral' : item.target.type === 'page' ? 'live' : 'info'}>
          {item.dropdownGroup ? 'Group' : item.target.type === 'page' ? 'Page' : 'Website'}
        </Badge>
        <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + item.label}>
          <Button variant="tertiary" onClick={() => begin(path)}>
            Edit menu item
          </Button>
          <Button
            variant="tertiary"
            disabled={disabled || index === 0}
            onClick={() => onChange(moveMenuItem(tree, path, 'up'))}
          >
            Move up
          </Button>
          <Button
            variant="tertiary"
            disabled={disabled || index === total - 1}
            onClick={() => onChange(moveMenuItem(tree, path, 'down'))}
          >
            Move down
          </Button>
          {nested ? (
            <Button
              variant="tertiary"
              disabled={disabled || tree.length >= 50}
              onClick={() => onChange(moveMenuItem(tree, path, 'outdent'))}
            >
              Move out
            </Button>
          ) : (
            <Button
              variant="tertiary"
              disabled={
                disabled ||
                index === 0 ||
                Boolean(item.children?.length) ||
                (tree[index - 1]?.children?.length ?? 0) >= 20
              }
              onClick={() => onChange(moveMenuItem(tree, path, 'indent'))}
            >
              Move under previous item
            </Button>
          )}
          <Button
            variant="tertiary"
            disabled={disabled}
            onClick={() => onChange(editMenuItem(tree, path, current => ({ ...current, visible: !current.visible })))}
          >
            {item.visible ? 'Hide from menu' : 'Show in menu'}
          </Button>
          <Button variant="tertiary" disabled={disabled} onClick={() => setRemoving({ path, label: item.label })}>
            Remove from menu
          </Button>
        </Menu>
      </li>
    )
  }
  return (
    <>
      <Card
        density="compact"
        title="Main menu"
        description="Drag to reorder. Drag right to put a page under another. Up to 2 levels."
        headerActions={
          <Button variant="secondary" disabled={disabled || !canAppendMenuItem(tree)} onClick={add}>
            <IconPlus size={16} />
            Add to menu
          </Button>
        }
      >
        {!tree.length ? (
          <p className={styles.emptyRow}>
            No menu items yet. Add a page, website or dropdown to help visitors find their way.
          </p>
        ) : (
          <ul className={styles.rowList}>
            {tree.flatMap((item, index) => [
              row(item, String(index), index, tree.length),
              ...(item.children ?? []).map((child, at) =>
                row(child, index + '.' + at, at, item.children!.length, true),
              ),
            ])}
          </ul>
        )}
      </Card>
      {editing && node && (
        <Dialog
          density="compact"
          size="medium"
          title={editing.fresh ? 'Add to menu' : 'Edit menu item'}
          onClose={() => close(true)}
          footer={
            <>
              <Button variant="secondary" onClick={() => close(true)}>
                Cancel
              </Button>
              <Button disabled={!NavTree.safeParse(tree).success} onClick={() => close(false)}>
                Done
              </Button>
            </>
          }
        >
          <div className={styles.formStack}>
            {editing.fresh && (
              <SegmentedControl
                appearance="pills"
                size="s"
                label="What would you like to add?"
                value={editing.kind}
                onChange={value => kind(value as Editing['kind'])}
                options={[
                  { value: 'page', label: 'A page on this site' },
                  { value: 'url', label: 'A website' },
                  { value: 'group', label: 'A dropdown group' },
                ]}
              />
            )}
            {(editing.kind === 'page' || (editing.kind === 'group' && editing.fresh)) && (
              <SearchableSelect
                key={editing.kind}
                id="menu-item-page"
                label={editing.kind === 'group' ? 'First page in this dropdown' : 'Page'}
                required
                autoFocus
                help={
                  editing.kind === 'group'
                    ? 'A dropdown needs a real link. Add more links after this.'
                    : 'Type a page title or address, then choose a suggestion.'
                }
                value={
                  editing.kind === 'group'
                    ? node.children?.[0]?.target.type === 'page'
                      ? node.children[0].target.page_id
                      : ''
                    : node.target.type === 'page'
                      ? node.target.page_id
                      : ''
                }
                options={pages.map(page => ({
                  value: page.id,
                  label: page.title + ' — ' + page.path + (page.published ? '' : ' · draft'),
                }))}
                onChange={id => {
                  const page = pages.find(page => page.id === id)
                  patch(current =>
                    editing.kind === 'group'
                      ? {
                          ...current,
                          children: page
                            ? [
                                {
                                  label: page.title.slice(0, 80),
                                  target: { type: 'page', page_id: page.id },
                                  visible: true,
                                },
                              ]
                            : [],
                        }
                      : {
                          ...current,
                          label: page && !labelEdited ? page.title.slice(0, 80) : current.label,
                          target: { type: 'page', page_id: page?.id ?? '' },
                        },
                  )
                }}
              />
            )}
            <Field id="menu-item-name" label="Menu label" required>
              <input
                autoFocus={editing.kind === 'url' || (editing.kind === 'group' && !editing.fresh)}
                value={node.label}
                maxLength={80}
                onChange={event => {
                  setLabelEdited(true)
                  patch(current => ({ ...current, label: event.target.value }))
                }}
              />
            </Field>
            {editing.kind === 'url' && (
              <Field
                id="menu-item-url"
                label="Web address"
                required
                error={
                  node.target.type === 'url' && node.target.url && !NavUrl.safeParse(node.target.url).success
                    ? 'Use /path or https://example.org.'
                    : undefined
                }
              >
                <input
                  value={node.target.type === 'url' ? node.target.url : ''}
                  maxLength={2048}
                  onChange={event =>
                    patch(current => ({ ...current, target: { type: 'url', url: event.target.value } }))
                  }
                />
              </Field>
            )}

            {editing.kind === 'group' && (
              <p className="muted">Opens the links below it. The group has no web address of its own.</p>
            )}
            {!NavTree.safeParse(tree).success && (
              <p role="status" className="muted">
                Complete the name and destination to show this item in the preview.
              </p>
            )}
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          density="compact"
          title="Remove menu item?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onChange(moveMenuItem(tree, removing.path, 'remove'))
                  setRemoving(null)
                }}
              >
                Remove from menu
              </Button>
            </>
          }
        >
          <p>Remove “{removing.label}” and any links under it from this menu draft? The pages stay available.</p>
        </Dialog>
      )}
    </>
  )
}
