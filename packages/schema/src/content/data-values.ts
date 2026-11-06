import { z } from 'zod'
import { sampleFieldNames } from './sample-content.ts'
import { repeatTemplateSpec, repeatItemKeys } from './repeat-items.ts'
const words = (max: number) => z.string().trim().max(max)
export const DataValue = z.strictObject({
  id: z.uuid(),
  label: words(120).min(1),
  value: words(100).min(1),
  unit: words(80).default(''),
  source: words(500).min(1),
  sourcePageId: z.uuid().nullable().default(null),
  asOf: words(60),
  status: z.enum(['matches-report', 'needs-checking', 'does-not-change']),
  showSource: z.boolean().default(false),
})
export type DataValue = z.infer<typeof DataValue>
export const DataValues = z
  .array(DataValue)
  .max(100)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length, 'Each number must have its own identity.')
export const DataBinding = z.strictObject({
  format: z.literal('richtext').optional(),
  parts: z
    .array(z.union([z.strictObject({ text: z.string().max(5000) }), z.strictObject({ valueId: z.uuid() })]))
    .min(1)
    .max(16),
})
export type DataBinding = z.infer<typeof DataBinding>
export function siteDataValues(settings: unknown): DataValue[] {
  const result = DataValues.safeParse(
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>).dataValues : undefined,
  )
  return result.success ? result.data : []
}
export function dataValueBindings(values: Record<string, unknown>): Record<string, DataBinding> {
  const result = z.record(z.string().max(180), DataBinding).safeParse(values.__cms_data_values)
  return result.success
    ? Object.fromEntries(Object.entries(result.data).filter(([key]) => Object.hasOwn(values, key)))
    : {}
}
const escapeRich = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
/** Rich bindings preserve authored markup; substitutions are text and the renderer sanitizes the result. */
export function dataValueText(binding: DataBinding, numbers: readonly DataValue[]): string | null {
  let result = ''
  for (const part of binding.parts) {
    if ('text' in part) result += part.text
    else {
      const row = numbers.find(row => row.id === part.valueId)
      if (!row) return null
      const text = row.value + (row.unit ? ' ' + row.unit : '')
      result += binding.format === 'richtext' ? escapeRich(text) : text
    }
  }
  return result
}
/** The caller supplies only this site's current public settings,or its explicit draft preview. */
export function resolveDataValueFields(
  values: Record<string, unknown>,
  settings: unknown,
  slots: readonly { id: string; kind: string; constraints?: Record<string, unknown> }[],
): Record<string, unknown> {
  const numbers = siteDataValues(settings),
    bindings = dataValueBindings(values),
    next = { ...values }
  delete next.__cms_data_sources
  for (const [key, binding] of Object.entries(bindings)) {
    const [group, item, field] = key.split('__'),
      root = slots.find(slot => slot.id === group),
      slot =
        slots.find(slot => slot.id === key) ??
        (root && item && field && repeatItemKeys(values[group!]).includes(item)
          ? repeatTemplateSpec(root)?.fields.find(slot => slot.id === field)
          : undefined)
    if (!slot || !['text', 'richtext'].includes(slot.kind)) continue
    const text = dataValueText(binding, numbers)
    if (text !== null) {
      next[key] = slot.kind === 'richtext' && binding.format !== 'richtext' ? escapeRich(text) : text
      const sources = binding.parts.flatMap(part =>
        'valueId' in part
          ? numbers
              .filter(row => row.id === part.valueId && row.showSource)
              .map(row => row.source + (row.asOf ? ' · ' + row.asOf : ''))
          : [],
      )
      if (sources.length)
        next.__cms_data_sources = {
          ...((next.__cms_data_sources as object) ?? {}),
          [key]: [...new Set(sources)].join('; '),
        }
    }
  }
  return next
}

/** Fill the standard stat label once;never overwrite a label the author has reworded. */
export function numberChoiceValues(
  values: Record<string, unknown>,
  key: string,
  binding: DataBinding | null,
  value?: string,
  suggestedLabel?: string,
): Record<string, unknown> {
  const bindings = { ...dataValueBindings(values) }
  if (binding) bindings[key] = binding
  else delete bindings[key]
  const next: Record<string, unknown> = {
      ...values,
      ...(value === undefined ? {} : { [key]: value }),
      __cms_data_values: bindings,
    },
    parts = key.split('__'),
    labelKey = parts.length === 3 ? parts[0] + '__' + parts[1] + '__label' : 'label',
    labels =
      values.__cms_data_labels &&
      typeof values.__cms_data_labels === 'object' &&
      !Array.isArray(values.__cms_data_labels)
        ? (values.__cms_data_labels as Record<string, unknown>)
        : {}
  if (
    binding &&
    suggestedLabel &&
    Object.hasOwn(values, labelKey) &&
    (!String(values[labelKey] ?? '').trim() ||
      sampleFieldNames(values).includes(labelKey) ||
      labels[key] === values[labelKey])
  ) {
    next[labelKey] = suggestedLabel
    next.__cms_data_labels = { ...labels, [key]: suggestedLabel }
  }
  return next
}
