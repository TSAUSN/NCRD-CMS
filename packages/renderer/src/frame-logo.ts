import type { FooterConfigV2, HeaderConfig, SlotDef } from '@cms/schema'
/** A code-owned template choice. Never mutates the immutable saved values. */
export function inheritFooterLogo(
  footer: FooterConfigV2,
  slots: readonly SlotDef[],
  header: HeaderConfig | null,
  headerSlots: readonly SlotDef[] = [],
): FooterConfigV2 {
  const values = { ...footer.component.values }
  for (const slot of slots) {
    if (slot.kind !== 'image' || slot.constraints?.inheritHeaderLogo !== true || Object.hasOwn(values, slot.id))
      continue
    const headerSlot = headerSlots.find(field => field.kind === 'image' && field.constraints?.siteLogo === true)
    const logo = header?.schemaVersion === 2 && headerSlot ? header.component.values[headerSlot.id] : undefined
    if (logo && typeof logo === 'object' && !Array.isArray(logo)) values[slot.id] = logo
    else if (slot.constraints.sourceSample) values[slot.id] = slot.constraints.sourceSample
  }
  return { ...footer, component: { ...footer.component, values } }
}
