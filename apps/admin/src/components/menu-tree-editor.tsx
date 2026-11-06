'use client'
import { useId, useState } from 'react'
import { NavUrl, type NavTree, type NavNode } from '@cms/schema'
import { canAppendMenuItem, editMenuItem, menuHasPage, moveMenuItem, reorderMenuItem } from '../lib/menu-editing.ts'
import { Button, Dialog, IconButton } from './ui/index.ts'
import { IconArrowUp, IconArrowDown, IconTrash } from './icons.tsx'
import styles from './site-look-panel.module.css'
type PageChoice = { id: string; title: string; published: boolean }
export function MenuTreeEditor({
  tree,
  pages,
  onChange: changeTree,
  disabled = false,
  canvasEditing = true,
  dropdownGroupsOnly = false,
}: {
  dropdownGroupsOnly?: boolean
  canvasEditing?: boolean
  tree: NavTree
  pages: PageChoice[]
  onChange: (tree: NavTree) => void
  disabled?: boolean
}) {
  const onChange = (next: NavTree) =>
    changeTree(
      dropdownGroupsOnly
        ? next.map(node =>
            node.children?.length && node.target.type === 'url' && !NavUrl.safeParse(node.target.url).success
              ? { ...node, target: { type: 'url', url: '/' } }
              : node,
          )
        : next,
    )
  const [removing, setRemoving] = useState<{ path: string; label: string; children: number } | null>(null)
  const addId = useId(),
    available = pages.filter(page => !menuHasPage(tree, page.id)),
    canAdd = canAppendMenuItem(tree)
  const row = (node: NavNode, path: string, index: number, total: number, nested = false) => {
    const target = node.target,
      targetName =
        target.type === 'url'
          ? target.url || 'Choose a web address'
          : (pages.find(page => page.id === target.page_id)?.title ?? 'Page unavailable'),
      urlValid = target.type !== 'url' || NavUrl.safeParse(target.url).success
    return (
      <li
        key={path}
        aria-label={'Menu item ' + path}
        className={styles.menuItem}
        data-nested={nested || undefined}
        data-hidden={!node.visible || undefined}
        draggable={!disabled && !nested}
        onDragStart={event => event.dataTransfer.setData('application/x-cms-menu', path)}
        onDragOver={event => {
          if (!nested && event.dataTransfer.types.includes('application/x-cms-menu')) event.preventDefault()
        }}
        onDrop={event => {
          event.preventDefault()
          if (disabled || nested) return
          onChange(reorderMenuItem(tree, event.dataTransfer.getData('application/x-cms-menu'), path))
        }}
      >
        <label>
          Menu label
          <input
            autoFocus={target.type === 'url' && target.url === ''}
            value={node.label}
            maxLength={80}
            disabled={disabled}
            onChange={event => onChange(editMenuItem(tree, path, item => ({ ...item, label: event.target.value })))}
          />
        </label>
        {dropdownGroupsOnly && node.children?.length ? (
          <p className={styles.hiddenHelp}>Opens the links below.</p>
        ) : (
          <details
            className={styles.destination}
            ref={details => {
              if (details && target.type === 'url' && target.url === '') details.open = true
            }}
          >
            <summary>Destination · {targetName}</summary>
            <div className={styles.destinationFields}>
              <label>
                Destination type
                <select
                  value={target.type}
                  disabled={disabled}
                  onChange={event => {
                    const page = pages[0]
                    onChange(
                      editMenuItem(tree, path, item => ({
                        ...item,
                        target:
                          event.target.value === 'page' && page
                            ? { type: 'page', page_id: page.id }
                            : { type: 'url', url: '' },
                      })),
                    )
                  }}
                >
                  <option value="page" disabled={!pages.length}>
                    A page on this site
                  </option>
                  <option value="url">A web address</option>
                </select>
              </label>
              {target.type === 'page' ? (
                <label>
                  Page
                  <select
                    value={target.page_id}
                    disabled={disabled}
                    onChange={event =>
                      onChange(
                        editMenuItem(tree, path, item => ({
                          ...item,
                          target: { type: 'page', page_id: event.target.value },
                        })),
                      )
                    }
                  >
                    {!pages.some(page => page.id === target.page_id) && (
                      <option value={target.page_id}>Page unavailable — choose another</option>
                    )}
                    {pages.map(page => (
                      <option key={page.id} value={page.id}>
                        {page.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  Web address
                  <input
                    value={target.url}
                    maxLength={2048}
                    placeholder="/visit or https://example.org"
                    aria-invalid={!urlValid || undefined}
                    aria-describedby={!urlValid ? addId + path + '-error' : undefined}
                    disabled={disabled}
                    onChange={event =>
                      onChange(
                        editMenuItem(tree, path, item => ({
                          ...item,
                          target: { type: 'url', url: event.target.value },
                        })),
                      )
                    }
                  />
                </label>
              )}
              {target.type === 'url' && !urlValid && (
                <p id={addId + path + '-error'} className={styles.fieldError}>
                  Use /path or https://example.org.
                </p>
              )}
            </div>
          </details>
        )}
        <div className={styles.actions}>
          <IconButton
            tooltip="Move menu item up"
            variant="tertiary"
            disabled={disabled || index === 0}
            onClick={() => onChange(moveMenuItem(tree, path, 'up'))}
          >
            <IconArrowUp size={16} />
          </IconButton>
          <IconButton
            tooltip="Move menu item down"
            variant="tertiary"
            disabled={disabled || index === total - 1}
            onClick={() => onChange(moveMenuItem(tree, path, 'down'))}
          >
            <IconArrowDown size={16} />
          </IconButton>
          {nested ? (
            <Button
              size="s"
              variant="tertiary"
              disabled={disabled || tree.length >= 50}
              onClick={() => onChange(moveMenuItem(tree, path, 'outdent'))}
            >
              Move out
            </Button>
          ) : (
            <Button
              size="s"
              variant="tertiary"
              disabled={
                disabled ||
                index === 0 ||
                Boolean(node.children?.length) ||
                (tree[index - 1]?.children?.length ?? 0) >= 20
              }
              onClick={() => onChange(moveMenuItem(tree, path, 'indent'))}
            >
              Indent
            </Button>
          )}
          <Button
            size="s"
            variant="tertiary"
            aria-pressed={!node.visible}
            disabled={disabled}
            onClick={() => onChange(editMenuItem(tree, path, item => ({ ...item, visible: !item.visible })))}
          >
            {node.visible ? 'Hide' : 'Show'}
          </Button>
          <IconButton
            tooltip="Remove menu item"
            variant="destructive"
            disabled={disabled}
            onClick={() => setRemoving({ path, label: node.label, children: node.children?.length ?? 0 })}
          >
            <IconTrash size={16} />
          </IconButton>
        </div>
        {!node.visible && (
          <p className={styles.hiddenHelp}>
            Hidden from the menu{node.children?.length ? ' with its dropdown links' : ''}.
          </p>
        )}
        {node.children?.length ? (
          <ul className={styles.menuList}>
            {node.children.map((child, at) => row(child, path + '.' + at, at, node.children!.length, true))}
          </ul>
        ) : null}
      </li>
    )
  }
  return (
    <div>
      <h3>Menu</h3>
      <p>
        {canvasEditing
          ? 'Click a name on the real header to rename it. Drag names on the real header or here, or use the arrows. Indent makes a dropdown.'
          : 'Change names here, drag to reorder, or use the arrows. Indent makes a dropdown. Open the menu in the preview to check it.'}
      </p>
      {!tree.length && <p className={styles.hiddenHelp}>Add a page or web link to help visitors find their way.</p>}
      <ul className={styles.menuList}>{tree.map((node, index) => row(node, String(index), index, tree.length))}</ul>
      <div className={styles.addMenu}>
        <label htmlFor={addId}>Add page to menu</label>
        <select
          id={addId}
          value=""
          disabled={disabled || !canAdd || !available.length}
          onChange={event => {
            const page = available.find(page => page.id === event.target.value)
            if (page)
              onChange([
                ...tree,
                { label: page.title.slice(0, 80), target: { type: 'page', page_id: page.id }, visible: true },
              ])
          }}
        >
          <option value="">{available.length ? 'Choose a page…' : 'No more pages to add'}</option>
          {available.map(page => (
            <option key={page.id} value={page.id}>
              {page.title}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={disabled || !canAdd}
          onClick={() => onChange([...tree, { label: 'New link', target: { type: 'url', url: '' }, visible: true }])}
        >
          Add web link to menu
        </Button>
        {!canAdd && <p className={styles.hiddenHelp}>This menu is full. Remove a link before adding another.</p>}
      </div>
      {removing && (
        <Dialog
          title="Remove menu item?"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={disabled}
                onClick={() => {
                  if (disabled) return
                  onChange(moveMenuItem(tree, removing.path, 'remove'))
                  setRemoving(null)
                }}
              >
                Remove from menu
              </Button>
            </>
          }
        >
          <p>
            Remove “{removing.label || 'Unnamed link'}”
            {removing.children
              ? ` and its ${removing.children} dropdown ${removing.children === 1 ? 'link' : 'links'}`
              : ''}{' '}
            from this menu draft? The pages stay available.
          </p>
        </Dialog>
      )}
    </div>
  )
}
