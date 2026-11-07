'use client'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { NavNode, NavTree } from '@cms/schema'
import { dropMenuItem, moveMenuItem } from '../../../../lib/menu-editing.ts'
import { menuReorderIntent, type MenuMove } from '../../../../lib/menu-reorder-intent.ts'
import { useReorderableList } from '../../../../components/ui/use-reorderable-list.ts'
import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconDrag,
  IconExternal,
  IconEye,
  IconLink,
  IconMenu,
  IconPage,
  IconPlus,
  IconTrash,
} from '../../../../components/icons.tsx'
import { publishNavigation, saveNavigationDraft } from '../../../actions/site-look.ts'
import { type ActionResult } from '../../../../lib/action-result.ts'

type PageChoice = { id: string; title: string; path: string; published: boolean }
type InitialWorkspace = {
  revision: number
  mode: 'auto' | 'manual'
  draftVersionId: string
  publishedVersionId: string | null
  draft: NavTree
  published: NavTree
  pages: PageChoice[]
}

const cloneTree = (tree: NavTree): NavTree => structuredClone(tree)
const serial = (tree: NavTree): string => JSON.stringify(tree)

function pageIds(tree: NavTree): Set<string> {
  const ids = new Set<string>()
  for (const node of tree) {
    if (node.target.type === 'page') ids.add(node.target.page_id)
    for (const child of node.children ?? []) {
      if (child.target.type === 'page') ids.add(child.target.page_id)
    }
  }
  return ids
}

function targetDescription(node: NavNode, pages: PageChoice[]): string {
  const target = node.target
  if (target.type === 'url') return target.url
  return pages.find(page => page.id === target.page_id)?.path ?? 'Page no longer available'
}

export function NavigationEditor({
  siteId,
  siteName,
  initial,
  canManage,
}: {
  siteId: string
  siteName: string
  initial: InitialWorkspace
  canManage: boolean
}) {
  const router = useRouter()
  const [tree, setTree] = useState<NavTree>(() => cloneTree(initial.draft))
  const [mode, setMode] = useState<'auto' | 'manual'>(initial.mode)
  const [revision, setRevision] = useState(initial.revision)
  const [saved, setSaved] = useState(serial(initial.draft))
  const [savedMode, setSavedMode] = useState(initial.mode)
  const [published, setPublished] = useState<NavTree>(() => cloneTree(initial.published))
  const [notice, setNotice] = useState<ActionResult | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [pending, startTransition] = useTransition()

  const usedPages = useMemo(() => pageIds(tree), [tree])
  const availablePages = initial.pages.filter(page => page.published && !usedPages.has(page.id))
  const dirty = serial(tree) !== saved || mode !== savedMode
  const hasLiveVersion = initial.publishedVersionId !== null
  const draftIsLive = hasLiveVersion && serial(tree) === serial(published) && !dirty

  // Server actions revalidate this route. Incorporate a newer server snapshot
  // without remounting the workspace (which would erase the confirmation the
  // action just returned). Version ids, not object identity, make the effect
  // run only when an immutable artifact actually changed.
  useEffect(() => {
    setRevision(initial.revision)
    setTree(cloneTree(initial.draft))
    setSaved(serial(initial.draft))
    setMode(initial.mode)
    setSavedMode(initial.mode)
    setPublished(cloneTree(initial.published))
  }, [initial.revision, initial.draftVersionId, initial.publishedVersionId])

  function replaceRoot(index: number, node: NavNode) {
    setTree(current => current.map((item, itemIndex) => (itemIndex === index ? node : item)))
  }

  function replaceChild(parentIndex: number, childIndex: number, child: NavNode) {
    setTree(current =>
      current.map((node, index) =>
        index === parentIndex
          ? {
              ...node,
              children: (node.children ?? []).map((item, itemIndex) => (itemIndex === childIndex ? child : item)),
            }
          : node,
      ),
    )
  }

  function removeRoot(index: number) {
    setTree(current => current.filter((_, itemIndex) => itemIndex !== index))
  }

  function removeChild(parentIndex: number, childIndex: number) {
    setTree(current =>
      current.map((node, index) => {
        if (index !== parentIndex) return node
        const children = (node.children ?? []).filter((_, itemIndex) => itemIndex !== childIndex)
        return children.length === 0 ? { ...node, children: undefined } : { ...node, children }
      }),
    )
  }

  const reorder = useReorderableList({
    mimeType: 'application/x-cms-navigation',
    decide: point => menuReorderIntent(tree, point),
    apply: ({ from, to, position }: MenuMove) => {
      const next = dropMenuItem(tree, from, to, position)
      if (next === tree) return
      setTree(next)
      const [parent, child] = to.split('.').map(Number)
      const target = child === undefined ? tree[parent!] : tree[parent!]?.children?.[child]
      return 'Moved ' + (position === 'inside' ? 'under ' : position + ' ') + (target?.label || 'the menu item') + '.'
    },
  })

  function moveByKeyboard(path: string, action: 'up' | 'down' | 'indent' | 'outdent') {
    const next = moveMenuItem(tree, path, action)
    if (next === tree) return
    setTree(next)
    const [parent, child] = path.split('.').map(Number)
    const moved = child === undefined ? tree[parent!] : tree[parent!]?.children?.[child]
    const placement =
      action === 'indent' ? 'under the previous item' : action === 'outdent' ? 'out of the dropdown' : action
    reorder.announce(`Moved ${moved?.label || 'menu item'} ${placement}.`)
  }

  function dropFeedback(path: string) {
    const rejected = reorder.blocked ?? reorder.rejection
    return (
      <>
        <DropIndicator marker={reorder.marker} row={path} />
        {rejected?.row === path && (
          <span aria-hidden="true" className={reorderStyles.reason}>
            {rejected.message}
          </span>
        )}
      </>
    )
  }

  function addPage(page: PageChoice) {
    setTree(current => [
      ...current,
      {
        label: page.title,
        target: { type: 'page', page_id: page.id },
        visible: true,
      },
    ])
  }

  function addLink() {
    const label = linkLabel.trim()
    const url = linkUrl.trim()
    if (!label || !url) return
    setTree(current => [...current, { label, target: { type: 'url', url }, visible: true }])
    setLinkLabel('')
    setLinkUrl('')
    setLinkOpen(false)
  }

  function act(kind: 'save' | 'publish') {
    setNotice(null)
    const data = new FormData()
    data.set('siteId', siteId)
    data.set('revision', String(revision))
    data.set('tree', JSON.stringify(tree))
    data.set('mode', mode)
    startTransition(async () => {
      const result = kind === 'save' ? await saveNavigationDraft(data) : await publishNavigation(data)
      setNotice(result)
      if (result.ok) {
        setRevision(result.revision)
        if (kind === 'save') {
          setSaved(serial(tree))
          setSavedMode(mode)
        } else {
          setPublished(cloneTree(tree))
          router.refresh()
        }
      }
    })
  }

  return (
    <div className="navigation-workspace">
      {!canManage && (
        <p className="notice" role="note">
          <IconEye size={16} />
          <span className="notice-body">You can inspect this menu. An editor or site administrator can change it.</span>
        </p>
      )}
      {notice && (
        <p className={`notice ${notice.ok ? 'notice-ok' : 'notice-error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
          <span className="notice-body">{notice.message}</span>
          {!notice.ok && notice.kind === 'conflict' && (
            <button type="button" className="small secondary" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
        </p>
      )}

      <section className="navigation-commandbar" aria-label="Navigation publishing status">
        <div>
          <span className={`nav-live-dot ${draftIsLive ? 'is-live' : ''}`} aria-hidden="true" />
          <span>
            <strong>
              {!hasLiveVersion
                ? 'Not published yet'
                : draftIsLive
                  ? 'Matches the live site'
                  : 'Saved changes are not live yet'}
            </strong>
            <small>{dirty ? 'Save the draft before publishing.' : 'Your changes are saved.'}</small>
          </span>
        </div>
        {canManage && (
          <div className="actions">
            <button type="button" className="secondary" disabled={!dirty || pending} onClick={() => act('save')}>
              {pending ? 'Working…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="cta"
              disabled={dirty || draftIsLive || pending}
              onClick={() => act('publish')}
            >
              Publish navigation
            </button>
          </div>
        )}
      </section>

      <div className="navigation-grid">
        <div className="navigation-builder">
          <section className="navigation-mode" aria-labelledby="navigation-sync-title">
            <div>
              <p className="eyebrow">Page syncing</p>
              <h2 id="navigation-sync-title">What should happen when a page goes live?</h2>
            </div>
            <div className="navigation-mode-options">
              <label className={mode === 'auto' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="navigation-mode"
                  value="auto"
                  checked={mode === 'auto'}
                  disabled={!canManage}
                  onChange={() => setMode('auto')}
                />
                <span>
                  <strong>Add it automatically</strong>
                  <small>Newly published pages join the end of the menu. You can still reorder or hide them.</small>
                </span>
              </label>
              <label className={mode === 'manual' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="navigation-mode"
                  value="manual"
                  checked={mode === 'manual'}
                  disabled={!canManage}
                  onChange={() => setMode('manual')}
                />
                <span>
                  <strong>Let me choose</strong>
                  <small>Publishing a page never changes this menu until an editor adds it here.</small>
                </span>
              </label>
            </div>
          </section>

          <section className="navigation-outline" aria-labelledby="navigation-outline-title">
            <div className="navigation-section-head">
              <div>
                <p className="eyebrow">Menu outline</p>
                <h2 id="navigation-outline-title">Header navigation</h2>
                <p>Drag top-level items, or use the arrow buttons. Indent once to make a dropdown.</p>
              </div>
              <span className="tally">{tree.length} top-level</span>
            </div>

            {tree.length === 0 ? (
              <div className="navigation-empty">
                <span>
                  <IconMenu size={22} />
                </span>
                <h3>This menu is empty</h3>
                <p>
                  Add a published page or a secure link below. An empty draft does not affect the live site until
                  published.
                </p>
              </div>
            ) : (
              <ol className={'navigation-list ' + reorderStyles.list} data-reorder-list>
                {tree.map((node, index) => (
                  <li
                    key={`${node.target.type}-${targetDescription(node, initial.pages)}-${index}`}
                    {...reorder.row(String(index), !canManage || pending)}
                  >
                    {dropFeedback(String(index))}
                    <NavigationRow
                      node={node}
                      description={targetDescription(node, initial.pages)}
                      disabled={!canManage}
                      nested={false}
                      onChange={next => replaceRoot(index, next)}
                      onRemove={() => removeRoot(index)}
                      onUp={() => moveByKeyboard(String(index), 'up')}
                      onDown={() => moveByKeyboard(String(index), 'down')}
                      onIndent={
                        index > 0 && !node.children?.length && (tree[index - 1]?.children?.length ?? 0) < 20
                          ? () => moveByKeyboard(String(index), 'indent')
                          : undefined
                      }
                      first={index === 0}
                      last={index === tree.length - 1}
                    />
                    {node.children && node.children.length > 0 && (
                      <ol className="navigation-children" data-reorder-child-list>
                        {node.children.map((child, childIndex) => (
                          <li
                            key={`${child.target.type}-${targetDescription(child, initial.pages)}-${childIndex}`}
                            {...reorder.row(index + '.' + childIndex, !canManage || pending)}
                          >
                            {dropFeedback(index + '.' + childIndex)}
                            <NavigationRow
                              node={child}
                              description={targetDescription(child, initial.pages)}
                              disabled={!canManage}
                              nested
                              onChange={next => replaceChild(index, childIndex, next)}
                              onRemove={() => removeChild(index, childIndex)}
                              onUp={() => moveByKeyboard(index + '.' + childIndex, 'up')}
                              onDown={() => moveByKeyboard(index + '.' + childIndex, 'down')}
                              onOutdent={
                                tree.length < 50 ? () => moveByKeyboard(index + '.' + childIndex, 'outdent') : undefined
                              }
                              first={childIndex === 0}
                              last={childIndex === node.children!.length - 1}
                            />
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            )}
            <ReorderAnnouncement>{reorder.announcement}</ReorderAnnouncement>
          </section>

          {canManage && (
            <section className="navigation-add" aria-labelledby="navigation-add-title">
              <div className="navigation-section-head">
                <div>
                  <p className="eyebrow">Add an item</p>
                  <h2 id="navigation-add-title">Pages and links</h2>
                </div>
              </div>
              {availablePages.length > 0 && (
                <div className="navigation-page-choices">
                  {availablePages.map(page => (
                    <button
                      key={page.id}
                      type="button"
                      className="navigation-page-choice"
                      onClick={() => addPage(page)}
                    >
                      <span>
                        <IconPage size={16} />
                      </span>
                      <span>
                        <strong>{page.title}</strong>
                        <small className="mono">{page.path}</small>
                      </span>
                      <IconPlus size={15} />
                    </button>
                  ))}
                </div>
              )}
              {initial.pages.some(page => !page.published) && (
                <p className="navigation-draft-note">
                  Draft-only pages become available here after they are published.
                </p>
              )}
              {!linkOpen ? (
                <button type="button" className="secondary navigation-link-trigger" onClick={() => setLinkOpen(true)}>
                  <IconLink size={15} /> Add an internal or external link
                </button>
              ) : (
                <div className="navigation-link-form">
                  <div className="field">
                    <label htmlFor="nav-link-label">Link label</label>
                    <input
                      id="nav-link-label"
                      value={linkLabel}
                      maxLength={80}
                      onChange={event => setLinkLabel(event.target.value)}
                      placeholder="Donate"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="nav-link-url">Destination</label>
                    <input
                      id="nav-link-url"
                      value={linkUrl}
                      maxLength={2048}
                      onChange={event => setLinkUrl(event.target.value)}
                      placeholder="/give or https://example.org"
                    />
                  </div>
                  <div className="actions">
                    <button type="button" className="secondary" onClick={() => setLinkOpen(false)}>
                      Cancel
                    </button>
                    <button type="button" disabled={!linkLabel.trim() || !linkUrl.trim()} onClick={addLink}>
                      <IconPlus size={15} /> Add link
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="navigation-preview" aria-labelledby="navigation-preview-title">
          <div className="navigation-preview-head">
            <div>
              <p className="eyebrow">Draft preview</p>
              <h2 id="navigation-preview-title">Preview</h2>
            </div>
            <span>
              <IconEye size={14} /> Header
            </span>
          </div>
          <div className="navigation-preview-browser">
            <div className="navigation-preview-brand">
              <span aria-hidden="true">SA</span>
              <strong>{siteName}</strong>
            </div>
            <nav aria-label="Preview of the draft navigation">
              {tree.filter(node => node.visible).length === 0 ? (
                <p>No visible menu items</p>
              ) : (
                <ul>
                  {tree
                    .filter(node => node.visible)
                    .map((node, index) => (
                      <li key={`${node.label}-${index}`}>
                        <span>{node.label}</span>
                        {node.children?.some(child => child.visible) && (
                          <ul>
                            {node.children
                              .filter(child => child.visible)
                              .map((child, childIndex) => (
                                <li key={`${child.label}-${childIndex}`}>{child.label}</li>
                              ))}
                          </ul>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </nav>
          </div>
          <p className="navigation-preview-note">
            This is the saved page order and visibility, not a replacement for checking the live header after
            publishing.
          </p>
        </aside>
      </div>
    </div>
  )
}

function NavigationRow({
  node,
  description,
  disabled,
  nested,
  onChange,
  onRemove,
  onUp,
  onDown,
  onIndent,
  onOutdent,
  first,
  last,
}: {
  node: NavNode
  description: string
  disabled: boolean
  nested: boolean
  onChange: (node: NavNode) => void
  onRemove: () => void
  onUp: () => void
  onDown: () => void
  onIndent?: () => void
  onOutdent?: () => void
  first: boolean
  last: boolean
}) {
  return (
    <div className={`navigation-row ${!node.visible ? 'is-hidden' : ''}`}>
      <span className="navigation-drag" title={nested ? 'Nested menu item' : 'Drag to reorder'}>
        {nested ? <span aria-hidden="true">↳</span> : <IconDrag size={16} />}
      </span>
      <span className="navigation-kind" aria-hidden="true">
        {node.target.type === 'page' ? <IconPage size={15} /> : <IconExternal size={15} />}
      </span>
      <span className="navigation-row-copy">
        <input
          aria-label={`Menu label for ${node.label}`}
          value={node.label}
          maxLength={80}
          disabled={disabled}
          onChange={event => onChange({ ...node, label: event.target.value })}
        />
        <small>{description}</small>
      </span>
      <label className="navigation-visible" title={node.visible ? 'Visible in the menu' : 'Hidden from the menu'}>
        <input
          type="checkbox"
          checked={node.visible}
          disabled={disabled}
          onChange={event => onChange({ ...node, visible: event.target.checked })}
        />
        <span>{node.visible ? 'Shown' : 'Hidden'}</span>
      </label>
      {!disabled && (
        <span className="navigation-row-actions">
          {onOutdent && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Move ${node.label} out of submenu`}
              onClick={onOutdent}
            >
              ←
            </button>
          )}
          {onIndent && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Make ${node.label} a submenu item`}
              onClick={onIndent}
            >
              →
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            disabled={first}
            aria-label={`Move ${node.label} up`}
            onClick={onUp}
          >
            <IconArrowUp size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={last}
            aria-label={`Move ${node.label} down`}
            onClick={onDown}
          >
            <IconArrowDown size={14} />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            aria-label={`Remove ${node.label} from navigation`}
            onClick={onRemove}
          >
            <IconTrash size={14} />
          </button>
        </span>
      )}
    </div>
  )
}
