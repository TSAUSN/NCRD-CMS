'use client'
import { useMemo, useState, type PointerEventHandler } from 'react'
import { NavTree, type NavNode } from '@cms/schema'
import { canAppendMenuItem, editMenuItem, menuNodeAt, moveMenuItem } from '../lib/menu-editing.ts'
import { Badge, Button, Card, Dialog, Menu } from './ui/index.ts'
import { IconDrag, IconMore, IconPlus } from './icons.tsx'
import recordTableStyles from './workspace-styles/record-table.module.css'
import siteSummaryStyles from './workspace-styles/site-summary.module.css'
import listInspectorStyles from './workspace-styles/list-inspector.module.css'
import ownedStyles from './compact-menu-editor-styles.module.css'
import reorderStyles from './ui/reorderable-list.module.css'
import { useMenuReordering } from './use-menu-reordering.ts'
import { DropIndicator, ReorderAnnouncement } from './ui/drop-indicator.tsx'
import { CompactMenuItemDialog, type MenuPageChoice, type MenuItemEditing } from './compact-menu-item-dialog.tsx'
export function CompactMenuEditor({
  tree,
  pages,
  disabled,
  onChange,
  onEditing,
  onReorderPointerDown,
}: {
  tree: NavTree
  pages: MenuPageChoice[]
  disabled: boolean
  onChange: (tree: NavTree) => void
  onEditing: (editing: boolean) => void
  onReorderPointerDown?: PointerEventHandler<HTMLUListElement>
}) {
  const [editing, setEditing] = useState<MenuItemEditing | null>(null)
  const [removing, setRemoving] = useState<{ path: string; label: string } | null>(null)
  const [labelEdited, setLabelEdited] = useState(false)
  const pageById = useMemo(() => new Map(pages.map(page => [page.id, page])), [pages])
  const { reorder, moveByKeyboard } = useMenuReordering(tree, onChange)
  const node = editing ? menuNodeAt(tree, editing.path) : undefined
  const patch = (fn: (node: NavNode) => NavNode) => {
    if (editing) onChange(editMenuItem(tree, editing.path, fn))
  }
  function begin(path: string, fresh = false, kind?: MenuItemEditing['kind']) {
    const item = menuNodeAt(tree, path)
    setEditing({
      path,
      snapshot: structuredClone(tree),
      fresh,
      kind: kind ?? (item?.dropdownGroup ? 'group' : (item?.target.type ?? 'page')),
    })
    setLabelEdited(
      Boolean(
        item?.label &&
        item.label !==
          (item.target.type === 'page' ? pageById.get(item.target.page_id)?.title.slice(0, 80) : undefined),
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
    const snapshot = structuredClone(tree)
    const path = String(tree.length)
    onChange([...tree, { label: '', target: { type: 'url', url: '' }, visible: true }])
    setEditing({ path, snapshot, fresh: true, kind: 'page' })
    setLabelEdited(false)
    onEditing(true)
  }
  function kind(value: MenuItemEditing['kind']) {
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
    const target = item.target
    const destination = item.dropdownGroup
      ? 'Dropdown'
      : target.type === 'page'
        ? (pageById.get(target.page_id)?.path ?? 'Page unavailable')
        : target.url
    return (
      <li
        key={path}
        className={listInspectorStyles.menuRow}
        data-nested={nested || undefined}
        data-hidden={!item.visible || undefined}
        {...reorder.row(path, disabled)}
      >
        <DropIndicator row={path} marker={reorder.marker} />
        {(reorder.blocked ?? reorder.rejection)?.row === path && (
          <span className={reorderStyles.reason} aria-hidden="true">
            {(reorder.blocked ?? reorder.rejection)?.message}
          </span>
        )}
        <IconDrag size={10} />
        <Button
          variant="tertiary"
          className={listInspectorStyles.itemButton}
          disabled={disabled}
          title={item.label}
          onClick={() => begin(path)}
        >
          <span>
            {nested ? item.label : <strong>{item.label}</strong>}
            {!item.visible && ' · Hidden'}
          </span>
        </Button>
        <span className={ownedStyles.menuDestination} title={destination}>
          {destination}
        </span>
        <Badge tone={item.dropdownGroup ? 'neutral' : item.target.type === 'page' ? 'live' : 'info'}>
          {item.dropdownGroup ? 'Group' : item.target.type === 'page' ? 'Page' : 'Website'}
        </Badge>
        <Menu label={<IconMore size={16} />} accessibleLabel={'Actions for ' + item.label}>
          <Button variant="tertiary" disabled={disabled} onClick={() => begin(path)}>
            Edit menu item
          </Button>
          <Button variant="tertiary" disabled={disabled || index === 0} onClick={() => moveByKeyboard(path, 'up')}>
            Move up
          </Button>
          <Button
            variant="tertiary"
            disabled={disabled || index === total - 1}
            onClick={() => moveByKeyboard(path, 'down')}
          >
            Move down
          </Button>
          {nested ? (
            <Button
              variant="tertiary"
              disabled={disabled || tree.length >= 50}
              onClick={() => moveByKeyboard(path, 'outdent')}
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
              onClick={() => moveByKeyboard(path, 'indent')}
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
          <p className={recordTableStyles.emptyRow}>
            No menu items yet. Add a page, website or dropdown to help visitors find their way.
          </p>
        ) : (
          <ul
            className={siteSummaryStyles.rowList + ' ' + reorderStyles.list}
            data-reorder-list
            onPointerDownCapture={disabled ? undefined : onReorderPointerDown}
          >
            {tree.flatMap((item, index) => [
              row(item, String(index), index, tree.length),
              ...(item.children ?? []).map((child, at) =>
                row(child, index + '.' + at, at, item.children!.length, true),
              ),
            ])}
          </ul>
        )}
        <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
      </Card>
      {editing && node && (
        <CompactMenuItemDialog
          editing={editing}
          node={node}
          pages={pages}
          pageById={pageById}
          close={close}
          kind={kind}
          valid={NavTree.safeParse(tree).success}
          patch={patch}
          labelEdited={labelEdited}
          setLabelEdited={setLabelEdited}
        />
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
