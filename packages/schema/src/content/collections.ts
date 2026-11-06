import { z } from 'zod'
import { StoriesSettings } from './stories.ts'
import { imageFocus } from './image-focus.ts'

/** The persisted collection vocabulary. Built-in and admin models use this shape. */
export const COLLECTION_SCHEMA_VERSION = 1

export const COLLECTION_LIMITS = {
  fields: 32,
  fieldKey: 64,
  fieldLabel: 80,
  fieldHelp: 240,
  selectOptions: 50,
  selectOption: 120,
  entries: 2_000,
  stableKey: 80,
  valueText: 20_000,
  storyBody: 100_000,
} as const

export const COLLECTION_FIELD_TYPES = [
  'text',
  'richtext',
  'number',
  'date',
  'url',
  'image',
  'boolean',
  'select',
] as const
export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number]

const FieldKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    'Use a lowercase field key beginning with a letter; underscores and digits are allowed.',
  )

const BaseField = z
  .object({
    key: FieldKey,
    label: z.string().trim().min(1).max(COLLECTION_LIMITS.fieldLabel),
    required: z.boolean(),
    help: z.string().trim().max(COLLECTION_LIMITS.fieldHelp).optional(),
  })
  .strict()

const PlainField = BaseField.extend({
  type: z.enum(['text', 'richtext', 'number', 'date', 'url', 'image', 'boolean']),
}).strict()

const SelectField = BaseField.extend({
  type: z.literal('select'),
  options: z
    .array(z.string().trim().min(1).max(COLLECTION_LIMITS.selectOption))
    .min(1)
    .max(COLLECTION_LIMITS.selectOptions),
})
  .strict()
  .superRefine((field, context) => {
    if (new Set(field.options).size !== field.options.length) {
      context.addIssue({ code: 'custom', message: 'Select options must be unique.' })
    }
  })

export const CollectionField = z.discriminatedUnion('type', [PlainField, SelectField])
export type CollectionField = z.infer<typeof CollectionField>

export const CollectionFields = z
  .array(CollectionField)
  .min(1)
  .max(COLLECTION_LIMITS.fields)
  .superRefine((fields, context) => {
    const keys = new Set<string>()
    for (const field of fields) {
      if (keys.has(field.key)) {
        context.addIssue({ code: 'custom', message: `Field key ${field.key} is used more than once.` })
      }
      keys.add(field.key)
    }
  })
export type CollectionFields = z.infer<typeof CollectionFields>

export const CollectionPresentation = z
  .object({
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    titleField: FieldKey,
    subtitleField: FieldKey.nullable(),
    imageField: FieldKey.nullable(),
    groupField: FieldKey.nullable(),
    stories: StoriesSettings.optional(),
  })
  .strict()
export type CollectionPresentation = z.infer<typeof CollectionPresentation>

export const CollectionModel = z
  .object({
    fields: CollectionFields,
    presentation: CollectionPresentation,
  })
  .strict()
  .superRefine((model, context) => {
    const byKey = new Map(model.fields.map(field => [field.key, field]))
    const requireField = (key: string | null, role: string, allowed?: CollectionFieldType[]) => {
      if (key === null) return
      const field = byKey.get(key)
      if (!field) {
        context.addIssue({ code: 'custom', message: `${role} names the missing field ${key}.` })
      } else if (allowed && !allowed.includes(field.type)) {
        context.addIssue({ code: 'custom', message: `${role} cannot use a ${field.type} field.` })
      }
    }
    requireField(model.presentation.titleField, 'Title field', ['text', 'richtext', 'date', 'select'])
    requireField(model.presentation.subtitleField, 'Subtitle field', ['text', 'richtext', 'date', 'select'])
    requireField(model.presentation.imageField, 'Image field', ['image'])
    requireField(model.presentation.groupField, 'Group field', ['text', 'date', 'select'])
  })
export type CollectionModel = z.infer<typeof CollectionModel>

export const CollectionStableKey = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase stable key made of words separated by hyphens.')
  .max(COLLECTION_LIMITS.stableKey)

export type CollectionEntryValues = Record<string, unknown>

function usableUrl(value: string): boolean {
  if (/\s|\\/.test(value)) return false
  if (value.startsWith('/')) return !value.startsWith('//')
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
  } catch {
    return false
  }
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

/**
 * Parse one entry using its stored model. Unknown keys are refused rather than
 * silently dropped, because a typo that saves but never renders is data loss.
 */
export function parseCollectionEntryValues(
  fields: readonly CollectionField[],
  input: unknown,
): { ok: true; values: CollectionEntryValues } | { ok: false; problems: string[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, problems: ['An entry must be an object of field values.'] }
  }
  const record = input as Record<string, unknown>
  const known = new Set(fields.map(field => field.key))
  const problems: string[] = []
  for (const key of Object.keys(record)) {
    if (!known.has(key)) problems.push(`Unknown field ${key}.`)
  }
  const values: CollectionEntryValues = {}
  for (const field of fields) {
    const value = record[field.key]
    const absent = value === undefined || value === null || value === ''
    if (absent) {
      if (field.required) problems.push(`${field.label} is required.`)
      values[field.key] = field.type === 'boolean' ? false : ''
      continue
    }
    switch (field.type) {
      case 'text':
      case 'richtext':
        const limit =
          field.type === 'richtext' && field.key === 'body' ? COLLECTION_LIMITS.storyBody : COLLECTION_LIMITS.valueText
        if (typeof value !== 'string' || value.length > limit) {
          problems.push(`${field.label} must be text no longer than ${limit} characters.`)
        } else values[field.key] = value
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${field.label} must be a number.`)
        else values[field.key] = value
        break
      case 'boolean':
        if (typeof value !== 'boolean') problems.push(`${field.label} must be yes or no.`)
        else values[field.key] = value
        break
      case 'date':
        if (typeof value !== 'string' || !isCalendarDate(value))
          problems.push(`${field.label} must be a calendar date.`)
        else values[field.key] = value
        break
      case 'url':
        if (typeof value !== 'string' || !usableUrl(value))
          problems.push(`${field.label} must be an internal path or an https URL.`)
        else values[field.key] = value
        break
      case 'select':
        if (typeof value !== 'string' || !field.options.includes(value))
          problems.push(`${field.label} must use one of its configured choices.`)
        else values[field.key] = value
        break
      case 'image': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          problems.push(`${field.label} must be an image.`)
          break
        }
        const image = value as Record<string, unknown>
        const allowed = new Set(['src', 'alt', 'decorative', 'focal'])
        if (
          Object.keys(image).some(key => !allowed.has(key)) ||
          typeof image.src !== 'string' ||
          !usableUrl(image.src) ||
          typeof image.alt !== 'string' ||
          typeof image.decorative !== 'boolean' ||
          (image.alt.trim() === '' && image.decorative !== true) ||
          (image.focal !== undefined &&
            image.focal !== null &&
            (!imageFocus(image.focal) || Object.keys(image.focal as object).some(key => key !== 'x' && key !== 'y')))
        ) {
          problems.push(
            `${field.label} needs a safe source and either alternative text or an explicit decorative choice.`,
          )
        } else
          values[field.key] = {
            src: image.src,
            alt: image.alt,
            decorative: image.decorative,
            ...(imageFocus(image.focal) ? { focal: imageFocus(image.focal) } : {}),
          }
        break
      }
    }
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values }
}

export const CollectionEntryDraft = z
  .object({
    id: z.uuid().nullable(),
    stableKey: CollectionStableKey,
    values: z.record(z.string(), z.unknown()),
  })
  .strict()
export type CollectionEntryDraft = z.infer<typeof CollectionEntryDraft>

export const CollectionDraftBatch = z
  .array(CollectionEntryDraft)
  .max(COLLECTION_LIMITS.entries)
  .superRefine((entries, context) => {
    const keys = new Set<string>()
    const ids = new Set<string>()
    for (const entry of entries) {
      if (keys.has(entry.stableKey))
        context.addIssue({ code: 'custom', message: `Stable key ${entry.stableKey} is used more than once.` })
      keys.add(entry.stableKey)
      if (entry.id !== null) {
        if (ids.has(entry.id))
          context.addIssue({ code: 'custom', message: `Entry ${entry.id} is used more than once.` })
        ids.add(entry.id)
      }
    }
  })
export type CollectionDraftBatch = z.infer<typeof CollectionDraftBatch>

const FORMULA_PREFIX = /^[=+\-@\t\r]/

/**
 * A spreadsheet-safe text cell with a reversible convention. Leading formula
 * characters get the conventional apostrophe; a real leading apostrophe is
 * doubled so import can distinguish authored text from the guard.
 */
export function protectCsvCell(value: string): string {
  if (value.startsWith("'")) return `'${value}`
  return FORMULA_PREFIX.test(value) ? `'${value}` : value
}

export function unprotectCsvCell(value: string): string {
  if (value.startsWith("''")) return value.slice(1)
  if (value.startsWith("'") && FORMULA_PREFIX.test(value.slice(1))) return value.slice(1)
  return value
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** RFC 4180-style rows, including quoted commas, quotes and line breaks. */
export function parseCsvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && cell === '') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''))
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (quoted) throw new Error('The CSV ends inside a quoted value.')
  if (cell !== '' || row.length > 0) {
    row.push(cell.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter(current => current.some(value => value !== ''))
}

function csvValue(field: CollectionField, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (field.type === 'image') return JSON.stringify(value)
  if (field.type === 'boolean') return value === true ? 'true' : 'false'
  return protectCsvCell(String(value))
}

/** Stable field-key headers make export → import independent of display labels. */
export function collectionEntriesToCsv(
  fields: readonly CollectionField[],
  entries: readonly CollectionEntryValues[],
): string {
  const lines = [fields.map(field => quoteCsv(field.key)).join(',')]
  for (const entry of entries) {
    lines.push(fields.map(field => quoteCsv(csvValue(field, entry[field.key]))).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

function cellValue(field: CollectionField, raw: string): unknown {
  if (raw === '') return field.type === 'boolean' ? false : ''
  if (field.type === 'number') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : raw
  }
  if (field.type === 'boolean') {
    if (raw.toLowerCase() === 'true') return true
    if (raw.toLowerCase() === 'false') return false
    return raw
  }
  if (field.type === 'image') {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  }
  return unprotectCsvCell(raw)
}

export type CollectionCsvPreview = {
  rows: CollectionEntryValues[]
  problems: { row: number; messages: string[] }[]
}

/**
 * A dry-run parser: it never mutates anything, reports every bad row, refuses
 * unknown/missing headers, and returns normalized values only for valid rows.
 */
export function previewCollectionCsv(fields: readonly CollectionField[], source: string): CollectionCsvPreview {
  let table: string[][]
  try {
    table = parseCsvRows(source.replace(/^\uFEFF/, ''))
  } catch (error) {
    return {
      rows: [],
      problems: [{ row: 1, messages: [error instanceof Error ? error.message : 'The CSV could not be read.'] }],
    }
  }
  const header = table[0]
  if (!header) return { rows: [], problems: [{ row: 1, messages: ['The CSV is empty.'] }] }
  const expected = fields.map(field => field.key)
  const duplicate = header.find((key, index) => header.indexOf(key) !== index)
  const unknown = header.filter(key => !expected.includes(key))
  const missing = expected.filter(key => !header.includes(key))
  if (duplicate || unknown.length > 0 || missing.length > 0) {
    const messages = [
      ...(duplicate ? [`Header ${duplicate} appears more than once.`] : []),
      ...(unknown.length ? [`Unknown headers: ${unknown.join(', ')}.`] : []),
      ...(missing.length ? [`Missing headers: ${missing.join(', ')}.`] : []),
    ]
    return { rows: [], problems: [{ row: 1, messages }] }
  }
  const byKey = new Map(fields.map(field => [field.key, field]))
  const rows: CollectionEntryValues[] = []
  const problems: CollectionCsvPreview['problems'] = []
  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index]!
    if (cells.length !== header.length) {
      problems.push({ row: index + 1, messages: [`Expected ${header.length} cells but found ${cells.length}.`] })
      continue
    }
    const raw: CollectionEntryValues = {}
    for (let column = 0; column < header.length; column += 1) {
      const key = header[column]!
      raw[key] = cellValue(byKey.get(key)!, cells[column]!)
    }
    const parsed = parseCollectionEntryValues(fields, raw)
    if (parsed.ok) rows.push(parsed.values)
    else problems.push({ row: index + 1, messages: parsed.problems })
  }
  return { rows, problems }
}
