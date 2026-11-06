import { sourceSampleValue, type SlotDef } from '@cms/schema'
import { planSectionUpgrade } from './section-upgrade.ts'

/** Carry compatible authored fields using the same rules as page upgrades.
 * Navigation is governed separately; frames have no collection bindings. */
export function carryFrameValues(
  values: Record<string, unknown>,
  target: readonly SlotDef[],
  source: readonly SlotDef[],
): Record<string, unknown> {
  const carried = planSectionUpgrade(
    [...source],
    target.filter(slot => slot.kind !== 'navigation' && slot.kind !== 'repeat'),
    values,
  ).values
  for (const slot of target)
    if (
      slot.kind === 'image' &&
      slot.constraints?.siteLogo === true &&
      slot.constraints.inheritHeaderLogo !== true &&
      !source.some(previous => previous.id === slot.id) &&
      !Object.hasOwn(values, slot.id)
    ) {
      const logo = sourceSampleValue(slot, slot.constraints.sourceSample)
      if (logo !== undefined) carried[slot.id] = logo
    }
  return carried
}
