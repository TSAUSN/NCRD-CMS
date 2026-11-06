// How the inspector presents a section's fields. An imported link is stored
// as two kinds of field — its destination (an `href` the definition owns) and
// the words inside it — because the source element keeps its own markup. V1
// edited a link as one thing (reference 08), so the inspector shows the words
// and the destination together under the link's name, in source order.

import { siteWidget } from '@cms/schema'
type Slot = { id: string; kind: string; label: string; constraints?: Record<string, unknown> }
export type InspectorFieldGroup<T extends Slot> =
  | { kind: 'single'; slot: T }
  | { kind: 'link'; name: string; destination: T; words: T[] }

const DESTINATION = /^(.*) · destination(?: · part \d+)?$/

/** Pair each destination-only link with the text fields its importer label
 * names as its words (`… · label`, or `… · label · heading` and the like when
 * the words are in several elements), which immediately follow it. Anything
 * else stays a field of its own. */
export function inspectorFieldGroups<T extends Slot>(slots: readonly T[]): InspectorFieldGroup<T>[] {
  const groups: InspectorFieldGroup<T>[] = []
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!
    if (siteWidget(slot)) continue
    const match =
      slot.kind === 'link' && slot.constraints?.['destinationOnly'] === true ? DESTINATION.exec(slot.label) : null
    if (match) {
      const words: T[] = []
      const prefix = `${match[1]} · label`
      while (index + 1 < slots.length) {
        const next = slots[index + 1]!
        if (next.kind !== 'text' || (next.label !== prefix && !next.label.startsWith(`${prefix} · `))) break
        words.push(next)
        index += 1
      }
      if (words.length) {
        groups.push({ kind: 'link', name: match[1]!, destination: slot, words })
        continue
      }
    }
    groups.push({ kind: 'single', slot })
  }
  return groups
}

/** What a link's words field is called inside its group: “Words people click”,
 * with the importer's description of which words when there are several. */
export function linkWordsName(group: { name: string; words: readonly Slot[] }, slot: Slot): string {
  if (group.words.length < 2) return 'Words people click'
  const prefix = `${group.name} · label · `
  return `Words people click · ${slot.label.startsWith(prefix) ? slot.label.slice(prefix.length) : `part ${group.words.indexOf(slot) + 1}`}`
}

/** Put the selected field (including a link's words or one repeated item)
 * directly below the section heading, without hiding the remaining controls. */
export function focusedInspectorGroups<T extends Slot>(
  slots: readonly T[],
  selected: string | null,
): InspectorFieldGroup<T>[] {
  const groups = inspectorFieldGroups(slots)
  const owns = (group: InspectorFieldGroup<T>) =>
    group.kind === 'link'
      ? [group.destination, ...group.words].some(slot => slot.id === selected)
      : group.slot.id === selected || Boolean(selected?.startsWith(`${group.slot.id}__`))
  return selected ? [...groups.filter(owns), ...groups.filter(group => !owns(group))] : groups
}
