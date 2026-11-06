'use client'
import { renderCmsIcon } from '@cms/renderer'
import { EditorPanelActions } from './editor-panel-navigation.tsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  isIconSlot,
  moveRepeatItem,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  type FieldLike,
  type RepeatItemSpec,
} from '@cms/schema'
import { addEditorRepeatItem, discardNewRepeatItem, repeatItemHasContent } from '../../../lib/editor-repeat-item.ts'
import { useNavigationGuard } from '../../../components/navigation-guard.ts'
import { Button, EmptyState, Menu } from '../../../components/ui/index.ts'
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconDrag,
  IconMore,
  IconPlus,
} from '../../../components/icons.tsx'
import shared from '../../../components/workspace.module.css'
export function ContentRepeatPanel({
  origin,
  slot,
  spec,
  values,
  selected,
  onValuesChange,
  onDiscardEmpty,
  renderItem,
}: {
  origin: string
  slot: FieldLike
  spec: RepeatItemSpec
  values: Record<string, unknown>
  selected: string | null
  onValuesChange: (values: Record<string, unknown>, selected: string | null) => void
  onDiscardEmpty?: (origin: string, slotId: string, key: string) => void
  renderItem: (key: string) => ReactNode
}) {
  const [active, setActive] = useState<string | null>(null),
    [newKey, setNewKey] = useState<string | null>(null),
    drag = useRef<string | null>(null),
    boundary = useRef<HTMLDivElement>(null)
  const iconField = spec.fields.find(isIconSlot)
  const keys = repeatItemKeys(values[slot.id], spec.max),
    noun = spec.unit.toLowerCase(),
    first = (key: string) => (spec.fields[0] ? repeatItemSlotId(slot.id, key, spec.fields[0].id) : null)
  const article = /^[aeiou]/.test(noun) ? 'an' : 'a'
  const pending = useRef({ newKey, onDiscardEmpty, origin, slotId: slot.id })
  pending.current = { newKey, onDiscardEmpty, origin, slotId: slot.id }
  useEffect(
    () => () => {
      const state = pending.current
      if (state.newKey) state.onDiscardEmpty?.(state.origin, state.slotId, state.newKey)
    },
    [],
  )
  useEffect(() => {
    const key = selected ? keys.find(key => selected.startsWith(slot.id + '__' + key + '__')) : null
    if (key && key !== active) {
      if (newKey && newKey !== key) {
        onDiscardEmpty?.(origin, slot.id, newKey)
        setNewKey(null)
      }
      setActive(key)
    } else if (!key && active) {
      if (newKey) {
        onDiscardEmpty?.(origin, slot.id, newKey)
        setNewKey(null)
      }
      setActive(null)
    }
  }, [selected])
  useEffect(() => {
    boundary.current?.closest<HTMLElement>('[role=tabpanel]')?.scrollTo({ top: 0, behavior: 'instant' })
  }, [active])
  useNavigationGuard(() => ({
    dirty: newKey !== null,
    pending: false,
    draft: {
      label: 'New ' + noun,
      saved: true,
      discardLabel: 'Discard my edits',
      saveDraft: async () => {
        setNewKey(null)
        setActive(null)
        return { ok: true }
      },
      discard: () => {
        setNewKey(null)
        setActive(null)
      },
    },
  }))
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (newKey) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [newKey])
  function back() {
    if (newKey) onValuesChange(discardNewRepeatItem(values, slot, newKey), null)
    else onValuesChange(values, null)
    setNewKey(null)
    setActive(null)
  }
  function add(from?: string) {
    const added = addEditorRepeatItem(values, slot, { empty: true, ...(from ? { from, after: from } : {}) })
    if (!added.key) return
    setNewKey(added.key)
    setActive(added.key)
    onValuesChange(added.values, first(added.key))
  }
  function summary(key: string) {
    for (const field of spec.fields) {
      if (field.kind === 'image' || field.constraints?.presentation || field.constraints?.destinationOnly) continue
      const value = values[repeatItemSlotId(slot.id, key, field.id)],
        text =
          typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? String((value as { label?: unknown }).label ?? '')
              : ''
      const words = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (words) return words
    }
    return 'Untitled ' + noun
  }
  function remove(key: string) {
    onValuesChange(removeRepeatItem(values, slot, key), null)
    if (key === active) setActive(null)
  }
  function move(from: string, to: string) {
    const delta = keys.indexOf(to) - keys.indexOf(from)
    if (delta) onValuesChange(moveRepeatItem(values, slot, from, delta), selected)
  }
  if (active && keys.includes(active))
    return (
      <div
        ref={boundary}
        className={shared.denseStack + ' ' + shared.compactForm}
        onKeyDownCapture={event => {
          if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('dialog')) {
            event.preventDefault()
            event.stopPropagation()
            back()
          }
        }}
      >
        <EditorPanelActions>
          <Button variant="tertiary" onClick={back}>
            <IconChevronLeft size={16} />
            Back
          </Button>
          {newKey && (
            <Button variant="secondary" onClick={back}>
              Cancel
            </Button>
          )}
          <Button
            disabled={!repeatItemHasContent(values, slot, active)}
            onClick={() => {
              setNewKey(null)
              setActive(null)
              onValuesChange(values, null)
            }}
          >
            Done
          </Button>
        </EditorPanelActions>
        <div>
          <h3>{newKey ? 'New ' + noun : spec.unit + ' ' + (keys.indexOf(active) + 1)}</h3>
          <p className={shared.meta}>
            {newKey
              ? 'This ' + noun + ' appears on the page as you type. Nothing goes live until you publish.'
              : 'Part of this section. Your changes stay in the draft.'}
          </p>
        </div>
        {renderItem(active)}
      </div>
    )
  return (
    <div ref={boundary} className={shared.listGroup + ' ' + shared.compactForm} role="group" aria-label={slot.label}>
      <div>
        <h3>{slot.label}</h3>
      </div>
      {!keys.length ? (
        <EmptyState title={'No ' + noun + 's yet'}>
          Add {article} {noun} to show one on the page.
        </EmptyState>
      ) : (
        <ol
          className={shared.compactItemList}
          aria-label={slot.label}
          aria-description={'Drag to reorder, or use the row actions. Choose ' + article + ' ' + noun + ' to edit it.'}
        >
          {keys.map((key, index) => (
            <li
              key={key}
              draggable
              onDragStart={event => {
                drag.current = key
                event.dataTransfer.setData('application/x-cms-card', key)
              }}
              onDragEnd={() => {
                drag.current = null
              }}
              onDragOver={event => {
                if (event.dataTransfer.types.includes('application/x-cms-card')) event.preventDefault()
              }}
              onDrop={event => {
                event.preventDefault()
                const from = event.dataTransfer.getData('application/x-cms-card')
                if (drag.current === from && keys.includes(from)) move(from, key)
                drag.current = null
              }}
            >
              <IconDrag size={10} />
              <Button
                variant="tertiary"
                className={shared.itemButton}
                title={summary(key)}
                onClick={() => {
                  setActive(key)
                  onValuesChange(values, first(key))
                }}
              >
                {iconField && (
                  <span
                    className={shared.itemMark}
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html: renderCmsIcon(values[repeatItemSlotId(slot.id, key, iconField.id)]),
                    }}
                  />
                )}
                <span>{summary(key)}</span>
              </Button>
              <Menu
                boundary={boundary}
                label={<IconMore size={16} />}
                accessibleLabel={'Actions for ' + spec.unit + ' ' + (index + 1)}
              >
                <Button
                  variant="tertiary"
                  aria-label={'Move ' + spec.unit + ' ' + (index + 1) + ' up'}
                  disabled={index === 0}
                  onClick={() => onValuesChange(moveRepeatItem(values, slot, key, -1), selected)}
                >
                  <IconArrowUp size={14} />
                  Move up
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={'Move ' + spec.unit + ' ' + (index + 1) + ' down'}
                  disabled={index === keys.length - 1}
                  onClick={() => onValuesChange(moveRepeatItem(values, slot, key, 1), selected)}
                >
                  <IconArrowDown size={14} />
                  Move down
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={'Duplicate ' + spec.unit + ' ' + (index + 1)}
                  disabled={keys.length >= spec.max}
                  onClick={() => add(key)}
                >
                  Duplicate
                </Button>
                <Button
                  variant="tertiary"
                  aria-label={'Remove ' + spec.unit + ' ' + (index + 1)}
                  disabled={keys.length <= spec.min}
                  onClick={() => remove(key)}
                >
                  Remove {noun}
                </Button>
              </Menu>
            </li>
          ))}
        </ol>
      )}
      <Button fullWidth variant="secondary" disabled={keys.length >= spec.max} onClick={() => add()}>
        <IconPlus size={16} />
        Add {article} {noun}
      </Button>
    </div>
  )
}
