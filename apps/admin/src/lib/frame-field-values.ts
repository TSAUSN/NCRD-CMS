import { sourceSampleValue, type SlotDef } from '@cms/schema'
import { planSectionUpgrade } from './section-upgrade.ts'
import type { FrameComponentChoice } from '../server/queries/site-frame.ts'

export function frameComponentDefinition(
  components: readonly FrameComponentChoice[],
  config: { section_def_id: string; section_def_version: number } | null,
) {
  const component = config ? components.find(choice => choice.id === config.section_def_id) : null
  const pin = component?.versions.find(version => version.version === config?.section_def_version)
  return { component, pin }
}

export function frameLogoField(fields: readonly SlotDef[]) {
  return fields.find(slot => slot.kind === 'image' && slot.constraints?.siteLogo === true)
}

export function frameValueRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** A frame may offer the default image declared by its pinned logo field. */
export function frameLogoPreset(field: SlotDef | undefined, componentSlug?: string) {
  if (field?.kind !== 'image' || field.constraints?.siteLogo !== true) return null
  const value = frameValueRecord(sourceSampleValue(field, field.constraints.sourceSample))
  if (typeof value.src !== 'string' || !value.src.trim() || typeof value.alt !== 'string' || !value.alt.trim())
    return null
  return {
    value: { src: value.src, alt: value.alt, decorative: false },
    label: componentSlug === 'national-header' ? 'Use the Salvation Army shield' : 'Use the default logo',
  }
}

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
