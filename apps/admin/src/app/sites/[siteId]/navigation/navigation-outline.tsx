import type { NavNode } from '@cms/schema'
import { DropIndicator, ReorderAnnouncement } from '../../../../components/ui/drop-indicator.tsx'
import reorderStyles from '../../../../components/ui/reorderable-list.module.css'
import {
  IconArrowDown,
  IconArrowUp,
  IconDrag,
  IconExternal,
  IconMenu,
  IconPage,
  IconTrash,
} from '../../../../components/icons.tsx'
import type { NavigationDraft } from './use-navigation-draft.ts'

export function NavigationOutline({ model }: { model: NavigationDraft }) {
  const {
    tree,
    describeTarget,
    canManage,
    pending,
    reorder,
    replaceRoot,
    replaceChild,
    removeRoot,
    removeChild,
    moveByKeyboard,
  } = model
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

  return (
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
            Add a published page or a secure link below. An empty draft does not affect the live site until published.
          </p>
        </div>
      ) : (
        <ol className={'navigation-list ' + reorderStyles.list} data-reorder-list>
          {tree.map((node, index) => (
            <li
              key={`${node.target.type}-${describeTarget(node)}-${index}`}
              {...reorder.row(String(index), !canManage || pending)}
            >
              {dropFeedback(String(index))}
              <NavigationRow
                node={node}
                description={describeTarget(node)}
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
                      key={`${child.target.type}-${describeTarget(child)}-${childIndex}`}
                      {...reorder.row(index + '.' + childIndex, !canManage || pending)}
                    >
                      {dropFeedback(index + '.' + childIndex)}
                      <NavigationRow
                        node={child}
                        description={describeTarget(child)}
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
