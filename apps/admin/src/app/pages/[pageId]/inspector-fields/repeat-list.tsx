'use client'
import { addEditorRepeatItem } from '../../../../lib/editor-repeat-item.ts'
import styles from '../inspector.module.css'
import { type ReactNode } from 'react'
import { IconArrowDown, IconArrowUp, IconPlus, SlotIcon } from '../../../../components/icons.tsx'
import {
  isDrawingSlot,
  isIconSlot,
  moveRepeatItem,
  removeRepeatItem,
  repeatItemKeys,
  repeatItemSlotId,
  repeatItemSpec,
  type FieldLike,
} from '@cms/schema'

/**
 * A repeated list of items (LIB-02): V1's cards, steps or tiers, each item with
 * its own fields, which an editor can add to, duplicate, reorder and remove.
 * Every change here is one step for Undo. The item holding the selected field
 * is open; short lists show every item.
 */
export function RepeatList({
  index,
  slot,
  spec,
  values,
  selected,
  onValuesChange,
  renderItem,
}: {
  index: number
  slot: FieldLike
  spec: NonNullable<ReturnType<typeof repeatItemSpec>>
  values: Record<string, unknown>
  selected: string | null
  onValuesChange: (values: Record<string, unknown>, slot: string | null) => void
  renderItem: (key: string) => ReactNode
}) {
  const keys = repeatItemKeys(values[slot.id], spec.max)
  const unit = spec.unit
  const noun = unit.toLowerCase()
  const article = /^[aeiou]/.test(noun) ? 'an' : 'a'
  const titleId = `repeat-${index}-${slot.id}`
  const firstField = (key: string) => (spec.fields[0] ? repeatItemSlotId(slot.id, key, spec.fields[0].id) : null)
  // A recognisable line for each item: its first words.
  const summary = (key: string) => {
    for (const field of spec.fields) {
      // Words, not an icon's name or a link's address.
      if (
        isIconSlot(field) ||
        isDrawingSlot(field) ||
        field.constraints?.['destinationOnly'] === true ||
        field.kind === 'image'
      )
        continue
      const value = values[repeatItemSlotId(slot.id, key, field.id)]
      const text =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object'
            ? String((value as Record<string, unknown>)['label'] ?? '')
            : ''
      const plain = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (plain) return plain.length > 48 ? `${plain.slice(0, 47)}…` : plain
    }
    return ''
  }
  const add = (options: { after?: string; from?: string }) => {
    const added = addEditorRepeatItem(values, slot, options)
    if (added.key) onValuesChange(added.values, firstField(added.key))
  }
  return (
    <div
      className={`field repeat-list ${styles.repeatList}`}
      role="group"
      aria-labelledby={titleId}
      data-inspector-slot={slot.id}
    >
      <p className="repeat-list-title" id={titleId}>
        <span className="field-kind">
          <SlotIcon kind="repeat" size={13} />
        </span>
        {slot.label}
        <span className="muted">
          {keys.length} of at most {spec.max}
        </span>
      </p>
      {keys.length === 0 && (
        <p className="hint">
          This list is empty. Add {article} {noun} to show one on the page.
        </p>
      )}
      <ol className={`repeat-items ${styles.repeatItems}`}>
        {keys.map((key, at) => {
          const holdsSelection = selected !== null && selected.startsWith(`${slot.id}__${key}__`)
          const name = `${unit} ${at + 1}`
          return (
            <li
              key={key}
              className={`repeat-item ${styles.repeatItem}`}
              data-repeat-item={key}
              data-selected={holdsSelection ? 'true' : undefined}
            >
              <details open={holdsSelection || keys.length <= 3}>
                <summary>
                  <strong>{name}</strong>
                  {summary(key) && <span className="muted"> · {summary(key)}</span>}
                </summary>
                <div className="btn-row repeat-item-actions">
                  <button
                    type="button"
                    className="secondary small"
                    disabled={at === 0}
                    aria-label={`Move ${name} up`}
                    onClick={() => onValuesChange(moveRepeatItem(values, slot, key, -1), selected)}
                  >
                    <IconArrowUp size={14} /> Up
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={at === keys.length - 1}
                    aria-label={`Move ${name} down`}
                    onClick={() => onValuesChange(moveRepeatItem(values, slot, key, 1), selected)}
                  >
                    <IconArrowDown size={14} /> Down
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={keys.length >= spec.max}
                    aria-label={`Duplicate ${name}`}
                    onClick={() => add({ after: key, from: key })}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="secondary small danger-quiet"
                    disabled={keys.length <= spec.min}
                    aria-label={`Remove ${name}`}
                    // The item that takes its place stays selected, so the page keeps its place too.
                    onClick={() => {
                      const neighbour = keys[at + 1] ?? keys[at - 1]
                      onValuesChange(removeRepeatItem(values, slot, key), neighbour ? firstField(neighbour) : null)
                    }}
                  >
                    Remove
                  </button>
                </div>
                {renderItem(key)}
              </details>
            </li>
          )
        })}
      </ol>
      <button type="button" className="secondary small" disabled={keys.length >= spec.max} onClick={() => add({})}>
        <IconPlus size={14} /> Add {article} {noun}
      </button>
      {keys.length >= spec.max && (
        <p className="hint">This list holds at most {spec.max}. Remove one to add another.</p>
      )}
      {keys.length <= spec.min && keys.length > 0 && <p className="hint">This list needs at least {spec.min}.</p>}
    </div>
  )
}
